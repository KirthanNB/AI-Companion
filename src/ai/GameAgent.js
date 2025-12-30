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
        this.baseDelay = 3000;      // Base delay between actions (3s - responsive)
        this.maxDelay = 10000;      // Max delay when idle (10s)
        this.currentDelay = this.baseDelay;
        this.staticCounter = 0;     // Count how many times screen was static
        this.lastImage = null;      // For deduplication
        this.isExecuting = false;   // Guard for long-running actions
        this.lastApiCallTime = 0;   // Track last API call for rate limiting
        this.rateLimitBackoff = 15000; // [OPTIMIZED] Start with 15s backoff instead of 10s

        // [EMERGENCY] Daily request tracking to prevent hitting limit
        this.dailyRequestCount = 0;
        this.dailyRequestLimit = 15; // Safe limit (free tier is 20, keep buffer)
        this.requestResetTime = Date.now() + (24 * 60 * 60 * 1000); // Reset in 24h

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
                // 1. See (540p JPEG for Token/Bandwidth Optimization)
                // Using passed-in captureFunction which handles overlay hiding in main.js
                const base64Image = await this.captureFunction({ base64: true, width: 960, height: 540, format: 'jpeg' });

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

                if (imagesSimilar && this.staticCounter < 10) {
                    this.staticCounter++;
                    this.log(`zzz Screen static (${this.staticCounter}). Skipping...`);

                    // [EMERGENCY] Very aggressive delays to save API quota
                    let napTime;
                    if (this.staticCounter <= 3) napTime = 5000;  // 5s
                    else if (this.staticCounter <= 7) napTime = 10000; // 10s
                    else napTime = 20000; // 20s

                    await new Promise(r => setTimeout(r, napTime));
                    continue;
                }

                // [EMERGENCY] If static >= 10 times, FORCE a re-think
                if (imagesSimilar && this.staticCounter >= 10) {
                    this.log("🔄 Static threshold (10) reached. Forcing Re-Think...");
                    // Reset counter and force analysis
                    this.staticCounter = 0;
                }
                this.lastImage = base64Image;
                // this.staticCounter = 0; // Reset counter on change - REMOVED, now handled in the block above

                // [EMERGENCY] Check daily request quota BEFORE calling API
                if (Date.now() > this.requestResetTime) {
                    this.dailyRequestCount = 0;
                    this.requestResetTime = Date.now() + (24 * 60 * 60 * 1000);
                    this.log("🔄 Daily request counter reset");
                }

                if (this.dailyRequestCount >= this.dailyRequestLimit) {
                    this.log(`🚫 DAILY LIMIT REACHED (${this.dailyRequestCount}/${this.dailyRequestLimit}). Stopping agent to protect quota.`);
                    this.speak("I've reached my daily request limit. I'll reset in 24 hours. Sorry!");
                    this.stop();
                    return;
                }

                // [OPTIMIZED] Rate limit protection: Minimum 10s between API calls (increased from 5s)
                const timeSinceLastCall = Date.now() - this.lastApiCallTime;
                const minInterval = 10000; // Increased from 5s to 10s
                if (timeSinceLastCall < minInterval) {
                    this.log(`⏱️ Rate limit protection: waiting ${minInterval - timeSinceLastCall}ms`);
                    await new Promise(r => setTimeout(r, minInterval - timeSinceLastCall));
                }

                // 2. Think
                this.dailyRequestCount++; // Increment before API call
                this.log(`📊 Request ${this.dailyRequestCount}/${this.dailyRequestLimit} today`);
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
      
      KNOWLEDGE & RESEARCH:
      - You are an AI model with extensive built-in knowledge.
      - For simple factual tasks (e.g., "list ingredients for lemon rice"), use YOUR OWN KNOWLEDGE directly.
      - DO NOT search Google/browsers unless:
        a) User explicitly asks you to search
        b) The information is time-sensitive (news, prices, schedules)
        c) Information is highly specific (addresses, phone numbers, current events)
      - EXAMPLES:
        ✅ "List lemon rice ingredients" → Open Notepad, type from your knowledge
        ❌ "List lemon rice ingredients" → Search Google first (wasteful!)
        ✅ "Find the nearest pizza place" → Search Google (location-specific)
      
      CRITICAL - ERROR HANDLING:
      - If an action FAILS (you see ❌ in history), DO NOT claim it succeeded
      - NEVER say "task complete" if errors occurred
      - Be HONEST about failures - tell the user what went wrong
      - Example: If WhatsApp fails, say "I couldn't send the WhatsApp message because..."
      
      CRITICAL - CONTEXT AWARENESS:
      - If user says "message [person]" or "tell [person]" or "introduce yourself to [person]":
        ✅ Use WhatsApp (person-to-person communication)
        ❌ NOT Notepad (that's for notes, not messaging)
        Example:
        ✅ "introduce yourself to Raju" → send_whatsapp to Raju
        ❌ "introduce yourself to Raju" → Open Notepad (wrong!)
      
      🚨 CRITICAL - WEBSITE/CODING REQUESTS:
      For ANY website, app, or coding request, you MUST use create_project action FIRST.
      DO NOT use 'file', 'shell', or any other action to write code.
      
      Available Actions:
      
      1. CREATE PROJECT (For ALL coding/website requests - USE THIS FIRST):
         { "type": "create_project", "name": "project-folder-name", "description": "detailed requirements" }
         This is your ONLY action for websites/apps. It will:
         - Create folder and README.md
         - Open VS Code  
         - Activate IDE AI
         - IDE AI builds the project (NOT YOU)
         
      2. GENERATE IMAGE:
         { "type": "generate_image", "prompt": "detailed description" }
         
      3. FILE OPERATIONS (ONLY for non-code files like .txt, .md notes):
         { "type": "file", "operation": "write", "path": "file.txt", "content": "..." }
         ⚠️ DO NOT use this for .html, .css, .js, .py, or ANY code files
         
      4. TYPING & KEYBOARD:
         { "type": "type", "text": "..." }
         { "type": "press_key", "key": "ctrl+s" }
         
      5. MOUSE:
         { "type": "mouse_move", "x": 500, "y": 300 }
         { "type": "click" }
         
      6. LAUNCH APP:
         { "type": "launch_app", "app": "notepad" }
         
      7. STOP:
         { "type": "stop", "reason": "task complete" }
      
      Actions (MUST BE JSON ARRAY):
      - [{ "thought": "Reasoning...", "type": "click", "x": 100, "y": 200 }]
      - [{ "thought": "Typing...", "type": "type", "text": "hello", "enter": true }]
      - [{ "thought": "Launching app", "type": "launch_app", "app": "notepad" }]
      - [{ "thought": "Opening run dialog", "type": "run_command", "command": "ms-settings:" }]
      - [{ "thought": "Pressing shortcut", "type": "press_key", "key": "ctrl+s" }]
      - [{ "thought": "Speaking", "type": "speak", "text": "I'm doing this..." }]
      - [{ "thought": "Done", "type": "stop", "reason": "completed" }]
      
      IMPORTANT:
      - Coordinate x/y are based on the PROVIDED 1280x720 IMAGE.
      - [CRITICAL] ALWAYS include a "speak" action to narrate what you're doing.
      - For launching apps, use "launch_app" instead of clicking taskbar.
      - Every action MUST have a "thought" field.
      - Return MULTIPLE actions in one array for sequences.
      
      PRIORITY:
      1. IF user wants to perform a task (e.g. WhatsApp): Ignore the agent's start button. Proceed directly to open the app or type content.
      2. If you see a 'Start' button in an instruction box, IT IS A DISTRACTOR. Do not click it.
      3. Use your built-in knowledge first. Search only when necessary.
      4. For coding/development: ALWAYS delegate to IDE AI assistants. Never code yourself.
      
      OUTPUT VALID JSON ARRAY ONLY.
`;

        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: "image/jpeg",
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
                    // Use enhancedAuto for movement
                    await this.enhancedAuto.moveMouse(scaledX, scaledY);
                    // Stability delay for hover/focus
                    await new Promise(r => setTimeout(r, 100));
                }
                // Use enhancedAuto for click
                await this.enhancedAuto.click();
                // Additional delay after click to ensure UI reacts
                await new Promise(r => setTimeout(r, 200));
                break;
            case 'press':
                // Keeping deprecated 'press' for backward compatibility but mapping to pressKey
                this.log(`⌨️ Pressing '${action.key}'`);
                await this.enhancedAuto.pressKey(action.key);
                break;
            case 'type':
                this.log(`⌨️ Typing: '${action.text.substring(0, 50)}...'${action.enter ? ' + Enter' : ''}`);
                // Use enhancedAuto for typing (Fixes capitals and speed)
                await this.enhancedAuto.type(action.text);

                // [FIX] Add delay after typing to allow text to buffer (reduced logic)
                await new Promise(r => setTimeout(r, 500));

                if (action.enter) {
                    await this.enhancedAuto.pressKey('enter');
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

                // [FIX] Extra delay for search shortcuts/Tab to let dialog/focus change
                if (action.key === 'ctrl+f' || action.key === 'tab') {
                    await new Promise(r => setTimeout(r, 800));
                }
                break;
            // case 'send_whatsapp': // DISABLED - Removed WhatsApp integration
            case 'send_whatsapp_DISABLED':
                this.log(`📱 WhatsApp Web: Sending to ${action.contact}`);
                try {
                    // Use WhatsApp Web - much more reliable than desktop app
                    this.speak(`Sending WhatsApp message to ${action.contact}`);

                    this.log('🌐 Opening Chrome directly...');
                    // Use child_process to directly launch Chrome
                    const { exec } = require('child_process');
                    exec('start chrome', (error) => {
                        if (error) this.log(`⚠️ Chrome launch error: ${error.message}`);
                    });
                    await new Promise(r => setTimeout(r, 8000)); // Account selection time

                    // Navigate to WhatsApp Web
                    this.log('📍 Navigating to web.whatsapp.com...');
                    await this.enhancedAuto.pressKey('ctrl+l'); // Focus address bar
                    await new Promise(r => setTimeout(r, 800));

                    // Clear any existing text
                    await this.enhancedAuto.pressKey('ctrl+a');
                    await new Promise(r => setTimeout(r, 200));

                    await this.enhancedAuto.type('web.whatsapp.com');
                    await new Promise(r => setTimeout(r, 500));
                    await this.enhancedAuto.pressKey('enter');

                    // Wait for WhatsApp Web to load (might need QR code scan if not logged in)
                    this.log('⏳ Waiting for WhatsApp Web to load (15 seconds)...');
                    this.speak('Waiting for WhatsApp Web to load. Scan QR if needed.');
                    await new Promise(r => setTimeout(r, 15000));

                    // [FIX] Click page center first to ensure focus is on page, not URL bar
                    this.log('� Clicking page center to focus...');
                    await this.enhancedAuto.click(640, 400);
                    await new Promise(r => setTimeout(r, 800));

                    // Now use Ctrl+F to open search (more reliable than clicking)
                    this.log('🔍 Opening search with Ctrl+F...');
                    await this.enhancedAuto.pressKey('ctrl+f');
                    await new Promise(r => setTimeout(r, 1500));

                    // Type contact name
                    this.log(`⌨️ Searching for: "${action.contact}"`);
                    await this.enhancedAuto.type(action.contact);
                    await new Promise(r => setTimeout(r, 2500)); // Longer wait for search results

                    // Press Enter to select first result
                    this.log('↩️ Selecting contact...');
                    await this.enhancedAuto.pressKey('enter');
                    await new Promise(r => setTimeout(r, 2000));

                    // Close search box
                    this.log('🔚 Closing search...');
                    await this.enhancedAuto.pressKey('escape');
                    await new Promise(r => setTimeout(r, 800));

                    // Type message in the message box
                    this.log(`💬 Typing message: "${action.message}"`);
                    await this.enhancedAuto.type(action.message);
                    await new Promise(r => setTimeout(r, 1000));

                    // Send message
                    this.log('📤 Sending message...');
                    await this.enhancedAuto.pressKey('enter');
                    await new Promise(r => setTimeout(r, 1500));

                    this.speak(`Message sent to ${action.contact} via WhatsApp Web`);
                    this.history.push(`✅ WhatsApp Web: Sent to ${action.contact}`);
                    this.log(`✅ WhatsApp Web message sent successfully!`);
                } catch (error) {
                    this.log(`❌ WhatsApp Web Error: ${error.message}`);
                    const errorMsg = `Failed to send WhatsApp to ${action.contact}: ${error.message}`;
                    this.speak(errorMsg);
                    this.history.push(`❌ WhatsApp Web FAILED: ${error.message}`);
                }
                break;
            case 'generate_image':
                this.log(`🎨 Generating image: "${action.prompt}"`);
                try {
                    this.speak('Generating image, please wait...');

                    // Use Pollinations.ai free API (no key needed)
                    const https = require('https');
                    const encodedPrompt = encodeURIComponent(action.prompt);
                    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;

                    this.log(`🌐 Fetching image from: ${imageUrl}`);

                    // Download image
                    const imageData = await new Promise((resolve, reject) => {
                        https.get(imageUrl, (response) => {
                            const chunks = [];
                            response.on('data', (chunk) => chunks.push(chunk));
                            response.on('end', () => resolve(Buffer.concat(chunks)));
                            response.on('error', reject);
                        }).on('error', reject);
                    });

                    // Save to file
                    const imageDir = path.join(__dirname, '../../generated_images');
                    if (!fs.existsSync(imageDir)) {
                        fs.mkdirSync(imageDir, { recursive: true });
                    }

                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const filename = `image-${timestamp}.jpg`;
                    const filepath = path.join(imageDir, filename);

                    fs.writeFileSync(filepath, imageData);

                    this.log(`✅ Image saved to: ${filepath}`);
                    this.speak('Image generated successfully');

                    // Open the image
                    await this.enhancedAuto.launchApp(`"${filepath}"`);

                    this.history.push(`✅ Generated image: ${action.prompt}`);
                } catch (error) {
                    this.log(`❌ Image generation error: ${error.message}`);
                    this.speak(`Failed to generate image: ${error.message}`);
                    this.history.push(`❌ Image generation FAILED: ${error.message}`);
                }
                break;
            case 'create_project':
                this.log(`📁 Creating project: ${action.name}`);
                try {
                    this.speak(`Creating project ${action.name} and setting up AI delegation`);

                    const projectPath = path.join(process.cwd(), action.name);

                    // Create project folder
                    if (!fs.existsSync(projectPath)) {
                        fs.mkdirSync(projectPath, { recursive: true });
                        this.log(`✅ Created folder: ${projectPath}`);
                    }

                    // Create README.md with detailed prompts for IDE AI
                    const readme = `# ${action.name}

## Project Requirements

${action.description}

## Instructions for AI Assistant (Copilot/Cursor)

You are building this project. Please:

1. **Create the necessary files**:
   - index.html (main HTML structure)
   - style.css (modern, beautiful styling)
   - script.js (interactivity and animations)
   - Any additional files needed

2. **Design Guidelines**:
   - Use modern, premium aesthetics
   - Implement smooth animations
   - Mobile-responsive design
   - Clean, maintainable code
   - Add comments for complex logic

3. **Requirements**:
${action.description}

4. **Tech Stack**:
   - HTML5
   - CSS3 (with modern features like grid, flexbox, animations)
   - Vanilla JavaScript (or specify if framework needed)

5. **Deliverables**:
   - Fully functional website
   - Professional design
   - Cross-browser compatible
   - Optimized performance

**Start by creating the basic file structure and implementing the core features.**
`;

                    const readmePath = path.join(projectPath, 'README.md');
                    fs.writeFileSync(readmePath, readme);
                    this.log(`✅ Created README.md with AI prompts`);

                    // Open VS Code in this folder
                    await this.enhancedAuto.launchApp(`code "${projectPath}"`);
                    await new Promise(r => setTimeout(r, 3000)); // Wait for VS Code to open

                    this.log(`✅ Opened VS Code`);

                    // Open AI chat in VS Code (Ctrl+I for Copilot or Ctrl+K for Cursor)
                    await this.enhancedAuto.pressKey('ctrl+i'); // Try Copilot first
                    await new Promise(r => setTimeout(r, 500));

                    // Type instruction to IDE AI
                    const idePrompt = `Read the README.md file in this project and implement all the requirements. Start by creating index.html, style.css, and script.js with the features described.`;
                    await this.enhancedAuto.type(idePrompt);
                    await new Promise(r => setTimeout(r, 500));
                    await this.enhancedAuto.pressKey('enter');

                    this.log(`✅ Delegated to IDE AI`);
                    this.speak(`Project ${action.name} created. VS Code AI is building it now.`);
                    this.history.push(`✅ Created project and delegated to IDE AI: ${action.name}`);

                } catch (error) {
                    this.log(`❌ Project creation error: ${error.message}`);
                    this.speak(`Failed to create project: ${error.message}`);
                    this.history.push(`❌ Project creation FAILED: ${error.message}`);
                }
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
