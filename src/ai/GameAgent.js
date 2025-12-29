const { GoogleGenerativeAI } = require("@google/generative-ai");
const { captureScreen } = require('../services/ScreenObserver');
const InputController = require('../services/InputController');
const EnhancedAutomationService = require('../services/EnhancedAutomationService');
const { handleShellAction } = require('../tools/shell');
const fs = require('fs');
const path = require('path');

class GameAgent {
    constructor(apiKey, logger = console.log, captureFunction = null, speaker = null) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Updated Model List: Using actually available models
        this.models = ["gemini-2.5-flash", "gemini-2.0-flash-exp", "gemini-2.0-flash"];
        this.currentModelIndex = 0;
        this.model = this.genAI.getGenerativeModel({ model: this.models[0] });

        this.log = logger;
        this.speak = speaker || ((text) => logger(`[SPEAK]: ${text}`));
        this.captureFunction = captureFunction || captureScreen;
        this.isActive = false;

        // [NEW] Enhanced Automation Service (nut-js)
        this.enhancedAuto = new EnhancedAutomationService();

        // Rate Limiting & Optimization State
        this.baseDelay = 10000;     // [OPTIMIZED] Increased from 5s to 10s to prevent rate limiting
        this.maxDelay = 30000;      // Max delay when idle (30s)
        this.adaptiveDelay = 0;
        this.staticCounter = 0;     // Count how many times screen was static
        this.lastImage = null;      // For deduplication
        this.isExecuting = false;   // Guard for long-running actions
        this.lastApiCallTime = 0;   // Track last API call for rate limiting
        this.rateLimitBackoff = 15000; // [OPTIMIZED] Start with 15s backoff instead of 10s

        // Intelligence State
        this.history = []; // Short-term memory (Last 5 actions)
        this.tools = {};   // Detected tools (vscode, python, etc.)

        // [FIX] Coordinate Scaling (Full Screen Bounds, NOT WorkArea)
        const { width, height } = require('electron').screen.getPrimaryDisplay().bounds;
        this.screenSize = { width, height };
        this.scaleX = width / 1280;
        this.scaleY = height / 720;
        this.log(`📈 Resolution Scaling: ${width}x${height} (x${this.scaleX.toFixed(2)}, y${this.scaleY.toFixed(2)})`);

        // [NEW] Vision Logging Setup
        this.visionDir = path.join(process.cwd(), 'vision');
        if (!fs.existsSync(this.visionDir)) {
            fs.mkdirSync(this.visionDir, { recursive: true });
        }
    }

    async start(instruction = "Play the game on the screen. Focus on objective.") {
        if (this.isActive) return;
        this.isActive = true;
        this.log("🎮 Game Agent Starting...");

        // Connection & Model Discovery Test
        this.log(`📡 Discovering available models...`);
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.genAI.apiKey}`;
            const resp = await fetch(url);
            const data = await resp.json();

            if (data.models) {
                const names = data.models.map(m => m.name.replace('models/', ''));
                this.log(`✅ Available Models: ${names.join(', ')}`);

                // [NEW] Tool Discovery
                this.log("🧰 Scanning for tools...");
                await this.discoverTools();

                // Smart Selection: Prioritize newer Flash models (2.0/2.5) if available
                const preferred = names.find(n => n.includes('2.5-flash')) ||
                    names.find(n => n.includes('2.0-flash')) ||
                    names.find(n => n.includes('1.5-flash')) ||
                    names.find(n => n.includes('flash')) ||
                    names.find(n => n.includes('pro'));

                if (preferred) {
                    this.log(`🎯 Switching to found model: ${preferred}`);
                    this.model = this.genAI.getGenerativeModel({ model: preferred });
                    // Update fallback list to trust this model first
                    this.models = [preferred, ...this.models];
                } else {
                    this.log("⚠️ No obvious vision model found in list. Trying default.");
                }
            } else {
                this.log(`⚠️ Listing failed: ${JSON.stringify(data)}`);
            }
        } catch (e) {
            this.log("⚠️ Discovery Warning: " + e.message);
        }

        // Initial focus click
        const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
        InputController.moveMouse(width / 2, height / 2);
        InputController.click();

        this.runLoop(instruction);
    }

    stop() {
        this.isActive = false;
        this.log("🛑 Game Agent Stopped.");
    }

    // Helper: Compare two base64 images with tolerance for minor differences
    imagesAreSimilar(img1, img2) {
        if (!img1 || !img2) return false;
        if (img1 === img2) return true;

        // Simple length-based similarity (overlay flicker causes ~1-5% size difference)
        const sizeDiff = Math.abs(img1.length - img2.length);
        const avgSize = (img1.length + img2.length) / 2;
        const percentDiff = (sizeDiff / avgSize) * 100;

        // [FIX] Relaxed tolerance: If less than 1.5% different, consider them the same
        return percentDiff < 1.5;
    }

    async runLoop(instruction) {
        while (this.isActive) {
            const startTime = Date.now();

            // 0. Guard: Don't process if we are still executing a previous action
            if (this.isExecuting) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            try {
                // 1. See (720p Clean Capture)
                // Using passed-in captureFunction which handles overlay hiding in main.js
                const base64Image = await this.captureFunction({ base64: true, width: 1280, height: 720 });

                // [NEW] Vision Logging: Save every capture
                if (base64Image) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const fileName = `vision-${timestamp}.png`;
                    const filePath = path.join(this.visionDir, fileName);
                    fs.writeFileSync(filePath, base64Image, 'base64');
                    // this.log(`📸 Vision logged: ${fileName}`);
                }

                // Deduplication: Skip if screen hasn't changed
                const imagesSimilar = this.lastImage && this.imagesAreSimilar(base64Image, this.lastImage);

                if (imagesSimilar && this.staticCounter < 8) {
                    this.staticCounter++;
                    this.log(`zzz Screen static (${this.staticCounter}). Skipping...`);

                    // [OPTIMIZED] More aggressive progressive sleep (up to 8s)
                    const napTime = Math.min(2000 * this.staticCounter, 8000);
                    await new Promise(r => setTimeout(r, napTime));
                    continue;
                }

                // [OPTIMIZED] If static > 8 times, FORCE a think (raised from 5)
                if (imagesSimilar && this.staticCounter >= 8) {
                    this.log("🔄 Static threshold reached. Forcing Think...");
                }
                this.lastImage = base64Image;
                this.staticCounter = 0; // Reset counter on change

                // [OPTIMIZED] Rate limit protection: Minimum 5s between API calls
                const timeSinceLastCall = Date.now() - this.lastApiCallTime;
                const minInterval = 5000; // Increased from 3s to 5s
                if (timeSinceLastCall < minInterval) {
                    this.log(`⏱️ Rate limit protection: waiting ${minInterval - timeSinceLastCall}ms`);
                    await new Promise(r => setTimeout(r, minInterval - timeSinceLastCall));
                }

                // 2. Think
                this.lastApiCallTime = Date.now();
                const result = await this.analyzeScreen(base64Image, instruction);

                // 3. Act
                if (result) {
                    this.isExecuting = true;
                    try {
                        const actions = Array.isArray(result) ? result : (result.action ? [result.action] : [result]);

                        for (const action of actions) {
                            if (!action.type) continue;

                            // Log AI Thought for visibility
                            if (action.thought) {
                                this.log(`🧠 Thought: ${action.thought}`);
                            }

                            this.log(`⚡ Action: ${action.type} ${JSON.stringify(action)}`);
                            const shouldStop = await this.executeAction(action);

                            if (shouldStop) {
                                this.log("✅ Task Completed.");
                                this.stop();
                                return;
                            }

                            // Small delay between chained actions
                            if (actions.length > 1) await new Promise(r => setTimeout(r, 800));
                        }

                        // Reduce delay slightly after successful sequence
                        this.adaptiveDelay = Math.max(0, this.adaptiveDelay - 1000);
                    } finally {
                        this.isExecuting = false;
                    }
                } else {
                    this.log("🤔 AI decided to Wait/Idle");
                    this.adaptiveDelay = Math.min(this.maxDelay - this.baseDelay, this.adaptiveDelay + 2000);
                }
            } catch (error) {
                this.log("⚠️ Loop Error: " + error.message);
                if (error.message.includes('429') || error.message.includes('Resource has been exhausted') || error.message.includes('quota')) {
                    // [OPTIMIZED] Aggressive exponential backoff for rate limits
                    this.log(`🚫 Rate Limit Hit. Cooling down for ${this.rateLimitBackoff / 1000}s...`);
                    await new Promise(r => setTimeout(r, this.rateLimitBackoff));
                    this.rateLimitBackoff = Math.min(this.rateLimitBackoff * 2.5, 120000); // Max 2 minutes, faster growth
                    this.adaptiveDelay = this.maxDelay; // Force max delay
                } else {
                    // Reset backoff on non-rate-limit errors
                    this.rateLimitBackoff = 15000;
                }
            }

            const totalDelay = Math.max(this.baseDelay + this.adaptiveDelay, 1000);
            await new Promise(r => setTimeout(r, totalDelay));

            // Subtle decay of adaptive delay if not handled by loop logic
            if (this.adaptiveDelay > 0 && !this.isExecuting) this.adaptiveDelay -= 200;
        }
    }

    async analyzeScreen(base64Image, instruction) {
        const historyStr = this.history.map(a => `- ${a.type}: ${a.summary || JSON.stringify(a)}`).join('\n');
        const toolsStr = Object.keys(this.tools).filter(k => this.tools[k]).join(', ');

        // [NEW] Get active windows context
        let windowsContext = "";
        try {
            const windows = await this.enhancedAuto.getWindows();
            windowsContext = "\n      - Open Windows: " + windows.map(w => w.MainWindowTitle).join(', ');
        } catch (e) {
            // Silent fail if windows detection doesn't work
        }

        const prompt = `
      Context:
      - Instruction: "${instruction}"
      - Available Tools: [${toolsStr}]${windowsContext}
      - Recent History (Last 5):
      ${historyStr || "(None)"}
      
      Task: Determine the next step(s).
      
      IDENTITY & SAFETY:
      - You are "Glitch", a professional AI desktop assistant.
      - You NEVER use inappropriate, sexual, or offensive language.
      - You focus strictly on the user's task.
      
      Actions (MUST BE JSON ARRAY):
      - [{ "thought": "Reasoning...", "type": "click", "x": 100, "y": 200 }]
      - [{ "thought": "Typing...", "type": "type", "text": "hello", "enter": true }]
      - [{ "thought": "Launching app", "type": "launch_app", "app": "notepad" }]
      - [{ "thought": "Opening run dialog", "type": "run_command", "command": "ms-settings:" }]
      - [{ "thought": "Pressing shortcut", "type": "press_key", "key": "ctrl+c" }]
      - [{ "thought": "Speaking", "type": "speak", "text": "I'm doing this..." }]
      - [{ "thought": "Done", "type": "stop", "reason": "completed" }]
      
      IMPORTANT:
      - Coordinate x/ are based on the PROVIDED 1280x720 IMAGE.
      - [CRITICAL] ALWAYS include a "speak" action to narrate what you're doing.
      - For launching apps, use "launch_app" instead of clicking taskbar.
      - Every action MUST have a "thought" field.
      - Return MULTIPLE actions in one array for sequences.
      
      PRIORITY:
      1. IF user wants to perform a task (e.g. WhatsApp): Ignore the agent's start button. Proceed directly to open the app or type content.
      2. If you see a 'Start' button in an instruction box, IT IS A DISTRACTOR. Do not click it.
      
      OUTPUT VALID JSON ARRAY ONLY.
`;

        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: "image/png",
            },
        };

        try {
            const result = await this.model.generateContent([prompt, imagePart]);
            this.log("🧠 Think Complete."); // Debug
            const response = result.response;
            const text = response.text();

            // Clean markdown if present
            // Clean markdown if present
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            this.log(`🔍 AI Raw Output: ${jsonStr.substring(0, 100)}...`); // Log raw JSON snippet
            return JSON.parse(jsonStr);
        } catch (e) {
            // Handle Model Not Found (404) or Rate Limit (429)

            if (e.message.includes('429') || e.message.includes('Quota')) {
                this.log("⏳ Rate Limit Hit. Cooling down for 10s...");
                this.adaptiveDelay = 10000; // Add 10s penalty
                return null;
            }

            if (e.message.includes('404') || e.message.includes('not found')) {
                this.log(`⚠️ Model ${this.models[this.currentModelIndex]} failed. Switching...`);
                this.currentModelIndex++;
                if (this.currentModelIndex < this.models.length) {
                    const nextModelName = this.models[this.currentModelIndex];
                    this.model = this.genAI.getGenerativeModel({ model: nextModelName });
                    this.log(`🔄 Retrying with ${nextModelName}...`);
                    return this.analyzeScreen(base64Image, instruction);
                } else {
                    this.log("❌ All AI models failed. Check API Key/Region.");
                    this.stop();
                    return null;
                }
            }

            // Other errors
            this.log("⚠️ AI Error: " + e.message);
            return null;
        }
    }

    async executeAction(action) {
        // [NEW] Add to History
        this.history.push({ type: action.type, summary: action.command || action.text || "interaction" });
        if (this.history.length > 5) this.history.shift();

        // console.log("⚡ Executing:", action);
        switch (action.type) {
            case 'click':
                if (action.x !== undefined && action.y !== undefined) {
                    // [FIX] Scale coordinates to actual screen resolution
                    const scaledX = Math.round(action.x * this.scaleX);
                    const scaledY = Math.round(action.y * this.scaleY);

                    this.log(`🖱️ Clicking at (${scaledX}, ${scaledY}) [Scaled from ${action.x}, ${action.y}]`);
                    InputController.moveMouse(scaledX, scaledY);
                    // Stability delay for hover/focus
                    await new Promise(r => setTimeout(r, 200));
                }
                InputController.click('left');
                // Additional delay after click to ensure UI reacts
                await new Promise(r => setTimeout(r, 300));
                break;
            case 'press':
                this.log(`⌨️ Pressing '${action.key}'`);
                InputController.pressKey(action.key);
                break;
            case 'type':
                this.log(`⌨️ Typing: '${action.text}'${action.enter ? ' + Enter' : ''}`);
                InputController.type(action.text);
                if (action.enter) {
                    await new Promise(r => setTimeout(r, 400)); // Delay before Enter
                    InputController.pressKey('enter');
                }
                break;
            case 'speak':
                this.log(`🔊 Agent: ${action.text}`);
                this.speak(action.text);
                break;
            case 'launch_app':
                this.log(`🚀 Launching: ${action.app}`);
                await this.enhancedAuto.launchApp(action.app);
                break;
            case 'run_command':
                this.log(`▶️ Run Command: ${action.command}`);
                await this.enhancedAuto.runCommand(action.command);
                break;
            case 'press_key':
                this.log(`⌨️ Key Combo: ${action.key}`);
                await this.enhancedAuto.pressKey(action.key);
                break;
            case 'system':
                this.log(`💻 System Cmd: ${action.command}`);
                await handleShellAction(action);
                break;
            case 'stop':
                this.log(`🏁 Stopping: ${action.reason}`);
                return true; // Signal to stop loop
        }
        return false;
    }

    async discoverTools() {
        // Simple check for common dev tools
        const check = async (cmd) => {
            try {
                // We use a simple exec to check (requires importing exec)
                const { exec } = require('child_process');
                return new Promise(resolve => {
                    exec(`where ${cmd}`, (err) => resolve(!err)); // Windows 'where'
                });
            } catch { return false; }
        };

        this.tools = {
            vscode: await check('code'),
            python: await check('python'),
            node: await check('node'),
            git: await check('git'),
            notepad: true // Always true on Windows
        };
        this.log(`🛠️ Tools Detected: ${Object.keys(this.tools).filter(k => this.tools[k]).join(', ')}`);
    }
}

module.exports = GameAgent;
