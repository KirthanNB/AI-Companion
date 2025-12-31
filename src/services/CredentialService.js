const Store = require('electron-store');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class CredentialService {
    constructor() {
        this.store = new Store({
            encryptionKey: 'ai-companion-secure-storage', // Basic obfuscation
            name: 'user-credentials'
        });
    }

    /**
     * Initialize credentials from .env if available (migration/dev mode)
     */
    async loadCredentials() {
        // 1. Try to load from Store first
        let geminiKey = this.store.get('google_api_key');
        let elevenKey = this.store.get('eleven_api_key');
        let elevenVoice = this.store.get('eleven_voice_id');

        // 2. Fallback to process.env (legacy/dev)
        // 2. Fallback to process.env (legacy/dev) - Check BOTH possible keys
        const envGemini = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        // [FIX] Do NOT auto-migrate .env keys to store. Keep them separate.

        let usingDefaultGemini = false;
        if (!geminiKey && envGemini) {
            geminiKey = envGemini;
            usingDefaultGemini = true;
        }

        let usingDefaultEleven = false;
        if (!elevenKey && process.env.ELEVEN_API_KEY) {
            elevenKey = process.env.ELEVEN_API_KEY;
            usingDefaultEleven = true;
        }

        if (!elevenVoice && process.env.ELEVEN_VOICE_ID) {
            elevenVoice = process.env.ELEVEN_VOICE_ID;
        }

        // 3. Inject back into process.env so the rest of the app works seamlessly
        // [FIX] Populate BOTH variations to ensure compatibility across renderer/main
        if (geminiKey) {
            process.env.GOOGLE_API_KEY = geminiKey;
            process.env.GEMINI_API_KEY = geminiKey;
        }
        if (elevenKey) {
            process.env.ELEVEN_API_KEY = elevenKey;
            process.env.ELEVENLABS_API_KEY = elevenKey;
        }
        if (elevenVoice) process.env.ELEVEN_VOICE_ID = elevenVoice;

        return {
            geminiKey,
            elevenKey,
            elevenVoice,
            usingDefaultGemini, // [NEW] Flag for UI
            usingDefaultEleven, // [NEW] Flag for UI
            isComplete: !!(geminiKey && elevenKey)
        };
    }

    saveCredentials({ geminiKey, elevenKey, elevenVoice }) {
        if (geminiKey) this.store.set('google_api_key', geminiKey);
        else if (geminiKey === '') this.store.delete('google_api_key'); // [NEW] Allow clearing

        if (elevenKey) this.store.set('eleven_api_key', elevenKey);
        else if (elevenKey === '') this.store.delete('eleven_api_key'); // [NEW] Allow clearing

        if (elevenVoice) this.store.set('eleven_voice_id', elevenVoice);

        // Update current session
        // [FIX] Update BOTH variations
        if (geminiKey) {
            process.env.GOOGLE_API_KEY = geminiKey;
            process.env.GEMINI_API_KEY = geminiKey;
        }
        if (elevenKey) {
            process.env.ELEVEN_API_KEY = elevenKey;
            process.env.ELEVENLABS_API_KEY = elevenKey;
        }
        if (elevenVoice) process.env.ELEVEN_VOICE_ID = elevenVoice;
    }

    clearCredentials() {
        this.store.delete('google_api_key');
        this.store.delete('eleven_api_key');
        this.store.delete('eleven_voice_id');
    }
}

module.exports = new CredentialService();
