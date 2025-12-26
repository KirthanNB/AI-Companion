const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require('node-fetch'); // Ensure node-fetch is used
const { captureScreen } = require('../services/ScreenObserver');
const InputController = require('../services/InputController');

class GameAgent {
    constructor(apiKey, logger = console.log) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        // List of models to try in order of preference/speed
        // Added gemini-pro-vision (legacy v1.0) as final fallback
        this.models = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-pro", "gemini-pro-vision"];
        this.currentModelIndex = 0;
        this.model = this.genAI.getGenerativeModel({ model: this.models[0] });

        this.isActive = false;
        this.isActive = false;
        this.log = logger;

        // Rate Limiting for Free Tier strategies
        // Gemini Free is ~15 RPM => 60s/15 = 4s per request
        this.baseDelay = 4000;
        this.adaptiveDelay = 0;
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

    async runLoop(instruction) {
        while (this.isActive) {
            const startTime = Date.now();
            try {
                // 1. See
                const base64Image = await captureScreen({ base64: true });

                // 2. Think
                // this.log("🧠 Thinking...");
                const result = await this.analyzeScreen(base64Image, instruction);

                // 3. Act
                if (result) {
                    if (result.action) {
                        this.log(`⚡ Action: ${result.action.type} ${JSON.stringify(result.action)}`);
                        await this.executeAction(result.action);
                    } else if (result.type) {
                        // Handle case where AI returns flat object
                        this.log(`⚡ Action: ${result.type} ${result.key || ''} `);
                        await this.executeAction(result);
                    } else {
                        this.log("🤔 AI decided to Wait/Idle"); // Explicitly log passing
                    }
                }
            } catch (error) {
                this.log("⚠️ Loop Error: " + error.message);
            }

            // Rate Limit handling:
            // If we got a 429, adaptiveDelay might be high.
            // Decay it slightly if things are going well, or rely on the catch block.
            const totalDelay = Math.max(this.baseDelay + this.adaptiveDelay, 1000);

            // this.log(`⏳ Waiting ${Math.round(totalDelay/1000)}s...`);
            await new Promise(r => setTimeout(r, totalDelay));

            // Slowly recover speed if we were penalized
            if (this.adaptiveDelay > 0) this.adaptiveDelay -= 500;
        }
    }

    async analyzeScreen(base64Image, instruction) {
        const prompt = `
      You are an AI Agent playing a computer game.
    Instruction: ${instruction}
      
      Analyze the screenshot. Provide a brief 'reasoning' for your decision, then the 'action'.
      
      Output JSON:
      {
        "reasoning": "I see a button at the bottom center. I need to click it to start.",
        "action": { "type": "click", "x": 500, "y": 500 }
      }
      
      Available actions:
      - { "type": "click", "x": 100, "y": 200 }
      - { "type": "press", "key": "space" }
      - { "type": "wait" }
      
      IMPORTANT: Return ONLY raw JSON. No markdown.
`;

        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: "image/png",
            },
        };

        try {
            const result = await this.model.generateContent([prompt, imagePart]);
            const response = result.response;
            const text = response.text();

            // Clean markdown if present
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            // this.log("🧠 Raw AI Output: " + jsonStr); // Debug log
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
        // console.log("⚡ Executing:", action);
        switch (action.type) {
            case 'click':
                if (action.x && action.y) {
                    this.log(`🖱️ Clicking at (${action.x}, ${action.y})`);
                    InputController.moveMouse(action.x, action.y);
                    // Small delay for hover effect
                    await new Promise(r => setTimeout(r, 100));
                }
                InputController.click('left');
                break;
            case 'press':
                this.log(`⌨️ Pressing '${action.key}'`);
                InputController.pressKey(action.key);
                break;
            case 'type':
                InputController.type(action.text);
                break;
        }
    }
}

module.exports = GameAgent;
