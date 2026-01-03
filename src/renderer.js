const { ipcRenderer } = require('electron');
// [REMOVED] Duplicate start logic. Combined into DOMContentLoaded below.
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Configuration ---
// [DYNAMIC] Model will be selected based on API key permissions
let GEMINI_MODEL = "gemini-3-flash-preview";
const ELEVEN_MODEL = "eleven_turbo_v2_5";
const MEOW_SOUNDS = ["meow1.mp3", "meow2.mp3", "meow3.mp3"];

// --- State ---
let isListening = false;
let isGameMode = false; // [NEW] Track game mode state
let mediaRecorder = null;
let audioChunks = [];
let geminiKey = null;
let elevenKey = null;
let voiceId = null; // [NEW] Declare global voiceId
let roamMode = 'FULL'; // FULL, BOTTOM, NONE
let currentRequestId = 0; // [NEW] Track requests for interruption
let isVisionActive = false; // [NEW] Manual vision toggle
let isDebugActive = true; // [NEW] Manual debug toggle (default ON)
// [NEW] Character State
let companionType = 'CAT'; // CAT, DOG, UFO
let avatarType = 'MALE'; // MALE, FEMALE, ALIEN
let isModalOpen = false; // [FIX] Track settings modal state explicitly


// Helper to log to screen
// --- Dynamic Model Selection ---
async function selectBestGeminiModel(apiKey) {
    try {
        logToScreen("🔍 Checking available models for this key...");
        // Fetch models using REST because the SDK doesn't always expose listModels easily in browser env
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (!data.models) throw new Error("No models returned");

        const available = data.models.map(m => m.name.replace('models/', ''));

        // Priority List (Best to Worst)
        const priorities = [
            "gemini-1.5-flash",
            "gemini-1.5-flash-001",
            "gemini-1.5-pro",
            "gemini-pro",
            "gemini-1.0-pro"
        ];

        // Also check if user has access to cool preview models and prioritize them
        const previews = available.filter(m => m.includes('gemini-3') || m.includes('gemini-2.5'));
        if (previews.length > 0) {
            // [FIX] Priority Sort: Prefer "Flash" over "Pro" to avoid 429 Quota limits
            // Flash usually has free tier, Pro often has 0 limit for previews
            previews.sort((a, b) => {
                const aFlash = a.includes('flash');
                const bFlash = b.includes('flash');
                if (aFlash && !bFlash) return -1;
                if (!aFlash && bFlash) return 1;
                return b.localeCompare(a); // Default to newer version
            });

            const bestPreview = previews[0];
            logToScreen(`✨ Wow! You have preview access: ${previews.join(', ')}`);
            priorities.unshift(bestPreview);
        }

        for (const preferred of priorities) {
            if (available.includes(preferred)) {
                logToScreen(`✅ Selected Model: ${preferred}`);
                return preferred;
            }
        }

        // Fallback: Just pick the first 'generateContent' capable gemini model
        const fallback = available.find(m => m.includes('gemini') && !m.includes('vision'));
        if (fallback) {
            logToScreen(`⚠️ Priority models missing. Using fallback: ${fallback}`);
            return fallback;
        }

        throw new Error("No compatible Gemini model found.");

    } catch (e) {
        logToScreen(`❌ Model Discovery Failed: ${e.message}. Defaulting to gemini-1.5-flash`);
        return "gemini-1.5-flash";
    }
}

// Helper to log to screen
function logToScreen(msg) {
    // [FIX] Forward logs to Main Process so they appear in VS Code Terminal
    ipcRenderer.send('log-to-console', msg);

    // Also try to show critical errors in the speech bubble if possible
    if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
        showBubble(`⚠️ ${msg}`);
    }

    const overlay = document.getElementById('debug-overlay');
    if (overlay) {
        overlay.style.display = 'block'; // Ensure visible logic
        const div = document.createElement('div');
        div.textContent = `> ${msg}`;
        div.style.background = "rgba(0,0,0,0.7)"; // background only on text line
        div.style.marginBottom = "2px";
        div.style.padding = "2px 5px";
        div.style.borderRadius = "4px";
        overlay.prepend(div);

        // Auto-cleanup logging
        if (overlay.children.length > 10) overlay.lastElementChild.remove();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    logToScreen('✨ Phase 3: Desktop Overlay Active');

    const micBtn = document.getElementById('btn-mic');
    const header = document.querySelector('header');

    // 1. Initialize Pixi Application
    try { initPixi(); } catch (e) { logToScreen("❌ Pixi Failed: " + e.message); }

    // 2. Load Keys
    try {
        geminiKey = await ipcRenderer.invoke('get-env', 'GEMINI_API_KEY');
        elevenKey = await ipcRenderer.invoke('get-env', 'ELEVENLABS_API_KEY');
        voiceId = await ipcRenderer.invoke('get-env', 'ELEVENLABS_VOICE_ID');
        logToScreen(`✅ Keys Loaded.`);

        // [NEW] Select Best Model Dynamically
        if (geminiKey) {
            logToScreen(`🔑 Using Key (ends in ...${geminiKey.slice(-4)})`);
            GEMINI_MODEL = await selectBestGeminiModel(geminiKey);
            logToScreen(`🤖 Active Model: ${GEMINI_MODEL}`);
        }

    } catch (e) {
        logToScreen("❌ Key Load Failed: " + e.message);
    }

    // 3. Setup Voice
    await setupAudioRecording();

    // 4. Setup Controls & Interactivity
    if (micBtn) {
        micBtn.addEventListener('click', () => toggleListening());
        // Hover: Capture Mouse
        micBtn.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
        micBtn.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));

        // [NEW] Setup Roam Toggle
        const roamBtn = document.getElementById('btn-roam');
        if (roamBtn) {
            roamBtn.addEventListener('click', () => cycleRoamMode(roamBtn));
            roamBtn.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
            roamBtn.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));
        }

        // [NEW] Setup Vision Toggle
        const visionBtn = document.getElementById('btn-vision');
        if (visionBtn) {
            visionBtn.addEventListener('click', () => toggleVision(visionBtn));
            visionBtn.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
            visionBtn.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));
        }

        // [NEW] Setup Debug Toggle
        const debugBtn = document.getElementById('btn-debug');
        if (debugBtn) {
            debugBtn.addEventListener('click', () => toggleDebug(debugBtn));
            debugBtn.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
            debugBtn.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));
        }

        // [NEW] Setup Game Mode Toggle
        const gameModeBtn = document.getElementById('btn-game-mode');
        const agentPanel = document.getElementById('agent-panel');
        const agentInput = document.getElementById('agent-input');
        const btnStart = document.getElementById('btn-start-agent');
        const btnStop = document.getElementById('btn-stop-agent');
        const statusDiv = document.getElementById('agent-status');

        if (gameModeBtn && agentPanel) {
            gameModeBtn.addEventListener('click', () => {
                const isVisible = agentPanel.style.display === 'block';
                agentPanel.style.display = isVisible ? 'none' : 'block';
                if (!isVisible && agentInput) agentInput.focus();
                showBubble(isVisible ? "Agent Panel OFF 🤫" : "Agent Panel ON 🤖");
            });
            gameModeBtn.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
            gameModeBtn.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));

            // Hover effects for the Panel itself so we can click inside it
            agentPanel.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
            agentPanel.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));

            // Start/Stop Logic
            if (btnStart) {
                btnStart.addEventListener('click', async () => {
                    const instruction = agentInput.value.trim();
                    if (!instruction) {
                        statusDiv.textContent = "Enter instruction!";
                        statusDiv.style.color = "yellow";
                        return;
                    }
                    statusDiv.textContent = "Agent Active 🟢";
                    statusDiv.style.color = "#4ade80";
                    isGameMode = true;
                    gameModeBtn.style.background = '#4ade80';
                    document.body.classList.add('agent-active');
                    await ipcRenderer.invoke('start-game-agent', instruction);
                });
            }
            if (btnStop) {
                btnStop.addEventListener('click', async () => {
                    isGameMode = false;
                    gameModeBtn.style.background = '#cd5c5c';
                    document.body.classList.remove('agent-active');
                    statusDiv.textContent = "Stopped 🔴";
                    await ipcRenderer.invoke('stop-game-agent');
                });
            }
        }
    }

    // [NEW] Setup Settings Modal Logic
    const settingsBtn = document.getElementById('btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('btn-close-settings');

    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            console.log("⚙️ Settings Clicked");
            isModalOpen = true;
            settingsModal.style.display = 'block';
            showBubble("Settings Open ⚙️");
            setIgnoreMouseEvents(false); // Force interactive
        });

        settingsBtn.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
        settingsBtn.addEventListener('mouseleave', () => {
            // [FIX] safeguard: Only ignore if modal is NOT open
            if (!isModalOpen) setIgnoreMouseEvents(true);
        });

        // [FIX] Add Modal Safeguard
        settingsModal.addEventListener('mouseenter', () => {
            isModalOpen = true; // Reinforce
            setIgnoreMouseEvents(false);
        });
        settingsModal.addEventListener('mousemove', () => setIgnoreMouseEvents(false));
    }

    // [NEW] Setup Quit Button (Restored)
    const quitBtn = document.getElementById('btn-quit');
    if (quitBtn) {
        quitBtn.addEventListener('click', async () => {
            showBubble("Goodbye! 👋");
            setTimeout(() => ipcRenderer.invoke('quit-app'), 1000);
        });
        quitBtn.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
        quitBtn.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            isModalOpen = false; // [FIX] Clear flag
            settingsModal.style.display = 'none';
            setIgnoreMouseEvents(true); // Return to default
        });
    }

    // ... (rest of listeners)
    // ...






    // [NEW] View Mode Buttons
    const viewBtns = document.querySelectorAll('.view-btn');
    viewBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // UI Update
            viewBtns.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = '#cbd5e1';
            });
            e.target.classList.add('active');
            e.target.style.background = '#334155';
            e.target.style.color = 'white';

            // Logic Update
            const mode = e.target.getAttribute('data-mode');
            setRoamMode(mode);
        });
    });

    // [NEW] Apply Look Button
    const btnApply = document.getElementById('btn-apply-look');
    if (btnApply) {
        btnApply.addEventListener('click', () => {
            const compSelect = document.getElementById('select-companion');
            const avSelect = document.getElementById('select-avatar');

            companionType = compSelect.value;
            avatarType = avSelect.value;

            generatePixelSprites();

            // Sound effect
            if (companionType === 'DOG') playSynthBark();
            else if (companionType === 'UFO') playSynthUFO();
            else if (companionType === 'GHOST') playSynthGhost();
            else if (companionType === 'ROBOT') playSynthRobot();
            else if (companionType === 'RABBIT') playSynthRabbit();
            else playRealMeow();

            showBubble("Look Updated! ✨");
        });
    }

    // [NEW] API Config Button
    const btnConfigApi = document.getElementById('btn-config-api');
    if (btnConfigApi) {
        btnConfigApi.addEventListener('click', async () => {
            await ipcRenderer.invoke('open-settings');
        });
    }


}); // End DOMContentLoaded

// [REFACTORED] Direct Set Mode
function setRoamMode(mode) {
    roamMode = mode;

    if (roamMode === 'FULL') showBubble("Full Screen 🌍");
    else if (roamMode === 'BOTTOM') showBubble("Bottom Only ⬇️");
    else showBubble("Hidden Mode 👻");



    // Apply immediate visibility fix
    const catEl = document.getElementById('character');
    const humEl = document.getElementById('human-actor');

    // Teleport to valid positions to prevent 'getting stuck'
    if (roamMode === 'BOTTOM') {
        const floor = window.innerHeight - 50;
        if (actors.cat) actors.cat.y = floor;
        if (actors.human) actors.human.y = floor;
    }

    if (roamMode === 'NONE') {
        if (catEl) catEl.style.display = 'none';
        if (humEl) humEl.style.display = 'none';
    } else {
        if (catEl) catEl.style.display = 'block';
        if (humEl) humEl.style.display = 'block';
    }
}

function toggleVision(btn) {
    isVisionActive = !isVisionActive;
    if (isVisionActive) {
        btn.style.background = "#4ade80";
        btn.innerHTML = '<i class="fas fa-eye"></i>';
        btn.title = "Screen Vision (ON)";
        showBubble("Vision ON 👁️");
    } else {
        btn.style.background = "#666";
        btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
        btn.title = "Screen Vision (OFF)";
        showBubble("Vision OFF 👻");
    }
}

function toggleDebug(btn) {
    isDebugActive = !isDebugActive;
    const overlay = document.getElementById('debug-overlay');
    if (isDebugActive) {
        if (overlay) overlay.style.display = 'flex';
        btn.style.background = "#f59e0b";
        btn.title = "Debug Logs (ON)";
        showBubble("Logs ON 🐞");
    } else {
        if (overlay) overlay.style.display = 'none';
        btn.style.background = "#666";
        btn.title = "Debug Logs (OFF)";
        showBubble("Logs OFF 🤫");
    }
}

// [REMOVED] cycleCharacters - replaced by modal logic
// [NEW] Audio Synthesizers for new characters
function playSynthGhost() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Theremin wobble
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.5);
    osc.frequency.linearRampToValueAtTime(300, ctx.currentTime + 1.5);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.5);
}

function playSynthRobot() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    // R2D2 beeps
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
}

function playSynthRabbit() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    // Squeak
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
}

// --- Window Transparency Logic ---
function setIgnoreMouseEvents(ignore) {
    // [FIX] Priority Overrides
    if (isModalOpen) {
        ignore = false; // ALWAYS active if modal is open
    }

    // Debug spam prevention: only log if you want to trace
    // console.log(`IgnoreMouse: ${ignore}, ModalOpen: ${isModalOpen}`);

    if (ignore) {
        // [CRITICAL] forward: true allows mousemove events to still fire so we can detect hovers!
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    } else {
        ipcRenderer.send('set-ignore-mouse-events', false);
    }
}


// --- Character Engine (Human & Cat) ---

let charContainer;
let charCanvas;
let charCtx;
let lastTime = 0;
let catSpriteSheet;
let humanSpriteSheet;

// Actors State
let actors = {
    cat: {
        x: window.innerWidth / 2 + 50,
        y: window.innerHeight / 2,
        vx: 0, vy: 0,
        targetX: window.innerWidth / 2,
        targetY: window.innerHeight / 2,
        state: 'IDLE',
        frame: 0, timer: 0, facingRight: true, idleTime: 0, scale: 1.5,
        sleepTime: 0, sleepDuration: 10000,
        decisionTimer: 0 // [NEW] Stability Timer
    },
    human: {
        x: window.innerWidth / 2 - 50,
        y: window.innerHeight / 2,
        vx: 0, vy: 0,
        targetX: window.innerWidth / 2,
        targetY: window.innerHeight / 2,
        state: 'IDLE',
        frame: 0, timer: 0, facingRight: true,
        scale: 2.5, isTalking: false,
        lastFaceChange: 0,
        decisionTimer: 0 // [NEW] Stability Timer
    }
};

// Global Timers
let thoughtTimer = 0;
let nextThoughtTime = 2000;
let meowTimer = 0;
let nextMeowTime = 30000; // [REDUCED] Initial meow delay
let humanTextTimer = 0;
let activeHumanThought = null;
let floatingEmojis = []; // Track active emojis for following

function initPixi() {
    charContainer = document.getElementById('character');
    charCanvas = document.getElementById('sprite-canvas');
    if (!charContainer || !charCanvas) return;

    charCtx = charCanvas.getContext('2d');
    generatePixelSprites();
    setupInteraction();

    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
    logToScreen("🧑‍🤝‍🐈 Duo Loaded: Kitty & Owner");
}

function setupInteraction() {
    let isDragging = false;
    let dragOffsetX = 0, dragOffsetY = 0, lastDragSound = 0;

    charContainer.addEventListener('mousedown', (e) => {
        const dx = e.clientX - actors.cat.x;
        const dy = e.clientY - actors.cat.y;
        if (Math.abs(dx) < 60 && Math.abs(dy) < 60) {
            isDragging = true;
            dragOffsetX = e.clientX - actors.cat.x;
            dragOffsetY = e.clientY - actors.cat.y;
            actors.cat.state = 'DRAGGED';
            playDragSound();
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        actors.cat.x = e.clientX - dragOffsetX;
        actors.cat.y = e.clientY - dragOffsetY;
        if (Date.now() - lastDragSound > 600) { playDragSound(); lastDragSound = Date.now(); }
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) { isDragging = false; actors.cat.state = 'IDLE'; actors.cat.vy = 5; }
    });

    charContainer.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
    charContainer.addEventListener('mouseleave', () => { if (!isDragging) setIgnoreMouseEvents(true); });
}

function generatePixelSprites() {
    const rect = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };

    // --- COMPANION SPRITE GENERATION ---
    const cs = document.createElement('canvas'); cs.width = 128; cs.height = 160;
    const ctxC = cs.getContext('2d');

    if (companionType === 'DOG') {
        // DOG SPRITES
        // Row 0: IDLE
        for (let f = 0; f < 4; f++) {
            let ox = f * 32;
            // Body
            rect(ctxC, ox + 8, 14, 14, 10, '#d35400'); // Brown body
            rect(ctxC, ox + 6, 10, 8, 8, '#d35400'); // Head
            rect(ctxC, ox + 6, 12, 2, 4, '#a04000'); // Ear L
            rect(ctxC, ox + 14, 12, 2, 4, '#a04000'); // Ear R
            // Tail wag
            if (f % 2 === 0) rect(ctxC, ox + 22, 14, 4, 2, '#d35400');
            else rect(ctxC, ox + 22, 12, 4, 2, '#d35400');
            // Eyes
            if (f !== 3) { rect(ctxC, ox + 8, 13, 2, 2, 'black'); rect(ctxC, ox + 12, 13, 2, 2, 'black'); }
        }
        // Row 1: WALK
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 32; let bob = (f % 2 === 0) ? -1 : 0;
            rect(ctxC, ox + 8, oy + 16 + bob, 16, 9, '#d35400');
            rect(ctxC, ox + 20, oy + 12 + bob, 8, 8, '#d35400'); // Head
            // Legs
            let l1 = (f === 0 || f === 3) ? 3 : 0;
            rect(ctxC, ox + 10 + l1, oy + 25 + bob, 3, 5, '#a04000');
            rect(ctxC, ox + 18 - l1, oy + 25 + bob, 3, 5, '#a04000');
        }
        // Row 2: SLEEP
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 64;
            rect(ctxC, ox + 8, oy + 18, 16, 8, '#d35400');
            rect(ctxC, ox + 16, oy + 16, 6, 6, '#d35400'); // Head tucked
            if (f % 2 === 0) { ctxC.fillStyle = '#f1c40f'; ctxC.fillText("z", ox + 24, oy + 10); }
        }
        // Row 3: SURPRISE -> BARKING
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 96;
            rect(ctxC, ox + 8, oy + 14, 14, 10, '#d35400');
            rect(ctxC, ox + 6, oy + 8, 8, 8, '#d35400');
            rect(ctxC, ox + 14, oy + 14, 4, 4, 'pink'); // Tongue
        }

    } else if (companionType === 'UFO') {
        // UFO SPRITES
        // Row 0: IDLE
        for (let f = 0; f < 4; f++) {
            let ox = f * 32;
            let float = Math.sin(f) * 2;
            rect(ctxC, ox + 4, 10 + float, 24, 8, '#95a5a6'); // Disc
            rect(ctxC, ox + 10, 6 + float, 12, 6, '#3498db'); // Dome
            // Lights
            if (f % 2 === 0) rect(ctxC, ox + 6, 14 + float, 3, 2, 'red');
            else rect(ctxC, ox + 22, 14 + float, 3, 2, 'green');
        }
        // Row 1: WALK (Fly)
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 32;
            rect(ctxC, ox + 4, oy + 10, 24, 8, '#95a5a6');
            rect(ctxC, ox + 10, oy + 6, 12, 6, '#3498db');
            // Trail
            rect(ctxC, ox + 2, oy + 14, 4, 2, '#f1c40f');
        }
        // Row 2: SLEEP (Landed)
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 64;
            rect(ctxC, ox + 4, oy + 20, 24, 8, '#7f8c8d'); // Darker
            rect(ctxC, ox + 10, oy + 16, 12, 6, '#2980b9'); // Off
        }
        // Row 3: SURPRISE (Beam)
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 96;
            rect(ctxC, ox + 4, oy + 10, 24, 8, '#95a5a6');
            rect(ctxC, ox + 10, oy + 6, 12, 6, '#3498db');
            // Beam
            ctxC.globalAlpha = 0.5;
            rect(ctxC, ox + 10, oy + 18, 12, 14, '#f1c40f');
            ctxC.globalAlpha = 1.0;
        }

    } else if (companionType === 'GHOST') {
        // GHOST SPRITES (White/Alpha)
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let float = Math.sin(f) * 2;

            // IDLE
            ctxC.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctxC.fillRect(ox + 8, 10 + float, 16, 16);
            ctxC.fillStyle = 'black';
            if (f !== 3) { ctxC.fillRect(ox + 12, 14 + float, 2, 4); ctxC.fillRect(ox + 18, 14 + float, 2, 4); }

            // WALK (Bob)
            ctxC.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctxC.fillRect(ox + 8, 32 + 10 + float, 16, 16);

            // SLEEP (Faded)
            ctxC.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctxC.fillRect(ox + 8, 64 + 14, 16, 12);

            // SURPRISE (Big eyes)
            ctxC.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctxC.fillRect(ox + 8, 96 + 10, 16, 16);
            ctxC.fillStyle = 'black';
            ctxC.fillRect(ox + 10, 96 + 12, 4, 6); ctxC.fillRect(ox + 18, 96 + 12, 4, 6);
        }

    } else if (companionType === 'RABBIT') {
        // RABBIT SPRITES
        // Row 0: IDLE
        for (let f = 0; f < 4; f++) {
            let ox = f * 32;
            rect(ctxC, ox + 10, 16, 12, 10, '#ffffff'); // Body
            rect(ctxC, ox + 10, 6, 2, 10, '#ffffff'); // Ear L
            rect(ctxC, ox + 18, 6, 2, 10, '#ffffff'); // Ear R
            if (f !== 3) { rect(ctxC, ox + 12, 18, 2, 2, 'pink'); } // Nose
        }
        // Row 1: WALK (Hop)
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 32; let hop = (f % 2 === 0) ? -5 : 0;
            rect(ctxC, ox + 10, oy + 16 + hop, 12, 10, '#ffffff');
            rect(ctxC, ox + 10, oy + 6 + hop, 2, 10, '#ffffff');
            rect(ctxC, ox + 18, oy + 6 + hop, 2, 10, '#ffffff');
        }
        // Row 2: SLEEP
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 64;
            rect(ctxC, ox + 10, oy + 20, 12, 8, '#ffffff');
            rect(ctxC, ox + 8, oy + 22, 2, 6, '#ffffff'); // Ear down
        }
        // Row 3: SUPRISE
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 96;
            rect(ctxC, ox + 10, oy + 16, 12, 10, '#ffffff');
            rect(ctxC, ox + 8, oy + 4, 2, 12, '#ffffff'); // Ear Up
            rect(ctxC, ox + 20, oy + 4, 2, 12, '#ffffff');
        }

    } else if (companionType === 'ROBOT') {
        // ROBOT SPRITES
        const metal = '#bdc3c7'; const dark = '#7f8c8d';
        for (let f = 0; f < 4; f++) {
            let ox = f * 32;
            // IDLE
            rect(ctxC, ox + 8, 10, 16, 16, metal);
            rect(ctxC, ox + 10, 14, 4, 4, '#3498db'); rect(ctxC, ox + 18, 14, 4, 4, '#3498db');
            rect(ctxC, ox + 15, 6, 2, 4, dark); // Antenna

            // WALK (Roll)
            let roll = (f % 2 === 0) ? 1 : -1;
            rect(ctxC, ox + 8, 32 + 10, 16, 16, metal);
            rect(ctxC, ox + 8, 32 + 26, 4, 4, dark); rect(ctxC, ox + 20, 32 + 26, 4, 4, dark); // Wheels

            // SLEEP (Off)
            rect(ctxC, ox + 8, 64 + 14, 16, 16, dark);

            // SURPRISE (Alert)
            rect(ctxC, ox + 8, 96 + 10, 16, 16, metal);
            rect(ctxC, ox + 10, 96 + 14, 12, 4, 'red'); // Visor
        }
    } else {
        // DEFAULT CAT
        // Row 0: IDLE
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; rect(ctxC, ox + 10, 14, 12, 12, '#ecf0f1'); rect(ctxC, ox + 9, 8, 14, 10, '#ecf0f1'); rect(ctxC, ox + 9, 5, 3, 3, '#bdc3c7'); rect(ctxC, ox + 19, 5, 3, 3, '#bdc3c7');
            if (f !== 3) { rect(ctxC, ox + 11, 11, 2, 2, '#2c3e50'); rect(ctxC, ox + 18, 11, 2, 2, '#2c3e50'); } else { rect(ctxC, ox + 11, 12, 2, 1, '#2c3e50'); rect(ctxC, ox + 18, 12, 2, 1, '#2c3e50'); }
            let tx = (f % 2) * 2; rect(ctxC, ox + 22, 20, 2 + tx, 3, '#95a5a6');
        }
        // Row 1: WALK
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 32; let bob = (f % 2 === 0) ? -1 : 0; rect(ctxC, ox + 8, oy + 16 + bob, 16, 9, '#ecf0f1'); rect(ctxC, ox + 20, oy + 10 + bob, 10, 8, '#ecf0f1');
            rect(ctxC, ox + 21, oy + 7 + bob, 2, 3, '#bdc3c7'); rect(ctxC, ox + 27, oy + 7 + bob, 2, 3, '#bdc3c7'); let l1 = (f === 0 || f === 3) ? 3 : 0; rect(ctxC, ox + 10 + l1, oy + 25 + bob, 3, 4, '#bdc3c7'); rect(ctxC, ox + 18 - l1, oy + 25 + bob, 3, 4, '#bdc3c7');
        }
        // Row 2: SLEEP
        for (let f = 0; f < 4; f++) { let ox = f * 32; let oy = 64; rect(ctxC, ox + 8, oy + 18, 16, 10, '#ecf0f1'); rect(ctxC, ox + 10, oy + 16, 12, 4, '#bdc3c7'); if (f % 2 === 0) { ctxC.fillStyle = '#3498db'; ctxC.fillText("z", ox + 24, oy + 10); } }
        // Row 3: SURPRISE
        for (let f = 0; f < 4; f++) { let ox = f * 32; let oy = 96; rect(ctxC, ox + 10, oy + 10, 12, 18, '#ecf0f1'); rect(ctxC, ox + 11, oy + 12, 3, 3, '#2c3e50'); rect(ctxC, ox + 17, oy + 12, 3, 3, '#2c3e50'); rect(ctxC, ox + 14, oy + 6, 2, 4, '#bdc3c7'); }
        // Row 4: DRAGGED
        for (let f = 0; f < 4; f++) {
            let ox = f * 32; let oy = 128; rect(ctxC, ox + 10, oy + 10, 12, 16, '#ecf0f1'); rect(ctxC, ox + 9, oy + 4, 14, 10, '#ecf0f1'); rect(ctxC, ox + 11, oy + 7, 2, 2, '#2c3e50'); rect(ctxC, ox + 18, oy + 7, 2, 2, '#2c3e50');
            rect(ctxC, ox + 6, oy + 12, 4, 8, '#bdc3c7'); rect(ctxC, ox + 22, oy + 12, 4, 8, '#bdc3c7'); let k = (f % 2 === 0) ? -2 : 2; rect(ctxC, ox + 10, oy + 26 + k, 3, 5, '#bdc3c7'); rect(ctxC, ox + 19, oy + 26 - k, 3, 5, '#bdc3c7');
        }
    }
    catSpriteSheet = cs;

    // --- AVATAR SPRITE GENERATION ---
    const hs = document.createElement('canvas'); hs.width = 128; hs.height = 128;
    const ctxH = hs.getContext('2d');

    // Colors based on type
    let skin = '#ffccaa';
    let hair = '#6d4c41';
    let shirt = '#3498db';
    let pants = '#2c3e50';

    if (avatarType === 'FEMALE') {
        hair = '#e67e22'; // Ginger
        shirt = '#9b59b6'; // Purple
    } else if (avatarType === 'ALIEN') {
        skin = '#2ecc71'; // Green
        hair = '#16a085'; // Dark Green
        shirt = '#bdc3c7'; // Silver
    } else if (avatarType === 'ZOMBIE') {
        skin = '#8bc34a'; // Zombie Green
        hair = '#333';
        shirt = '#555'; // Grey rags
    } else if (avatarType === 'WIZARD') {
        skin = '#ffe0b2';
        hair = '#eee'; // White beard
        shirt = '#3f51b5'; // Blue robe
    } else if (avatarType === 'CYBORG') {
        skin = '#bdc3c7';
        hair = '#000';
        shirt = '#2c3e50';
    }

    // Row 0: IDLE
    for (let f = 0; f < 4; f++) {
        let ox = f * 32;
        // Head
        rect(ctxH, ox + 12, 6, 8, 8, skin);
        // Hair
        if (avatarType === 'FEMALE') rect(ctxH, ox + 11, 4, 10, 6, hair); // Long hair
        else if (avatarType === 'WIZARD') { rect(ctxH, ox + 11, 2, 10, 4, '#3f51b5'); rect(ctxH, ox + 12, 14, 8, 4, '#eee'); } // Hat + Beard
        else rect(ctxH, ox + 12, 4, 8, 3, hair);

        if (f !== 3) {
            rect(ctxH, ox + 14, 9, 1, 1, '#000');
            if (avatarType === 'CYBORG') rect(ctxH, ox + 17, 9, 2, 2, 'red'); // Red Eye
            else rect(ctxH, ox + 17, 9, 1, 1, '#000');
        }
        // Body
        rect(ctxH, ox + 11, 14, 10, 10, shirt);
        rect(ctxH, ox + 9, 14, 2, 8, skin); rect(ctxH, ox + 21, 14, 2, 8, skin);
        rect(ctxH, ox + 11, 24, 4, 8, pants); rect(ctxH, ox + 17, 24, 4, 8, pants);
    }
    // Row 1: WALK/RUN
    for (let f = 0; f < 4; f++) {
        let ox = f * 32; let oy = 32; let bob = (f % 2 !== 0) ? -2 : 0;
        rect(ctxH, ox + 12, oy + 6 + bob, 8, 8, skin);
        if (avatarType === 'FEMALE') rect(ctxH, ox + 11, oy + 4 + bob, 10, 6, hair);
        else if (avatarType === 'WIZARD') { rect(ctxH, ox + 11, oy + 2 + bob, 10, 4, '#3f51b5'); rect(ctxH, ox + 12, oy + 14 + bob, 8, 4, '#eee'); }
        else rect(ctxH, ox + 12, oy + 4 + bob, 8, 3, hair);

        rect(ctxH, ox + 18, oy + 8 + bob, 2, 2, '#000'); rect(ctxH, ox + 13, oy + 14 + bob, 6, 10, shirt);
        if (f === 1) { rect(ctxH, ox + 16, oy + 16 + bob, 4, 3, skin); }
        else if (f === 3) { rect(ctxH, ox + 10, oy + 16 + bob, 4, 3, skin); }
        else { rect(ctxH, ox + 15, oy + 14 + bob, 2, 8, skin); }
        if (f === 0 || f === 2) { rect(ctxH, ox + 14, oy + 24 + bob, 4, 8, pants); }
        else if (f === 1) { rect(ctxH, ox + 10, oy + 24 + bob, 3, 6, pants); rect(ctxH, ox + 19, oy + 24 + bob, 3, 6, pants); }
        else if (f === 3) { rect(ctxH, ox + 12, oy + 24 + bob, 3, 6, pants); rect(ctxH, ox + 17, oy + 24 + bob, 3, 6, pants); }
    }
    // Row 2: TALK
    for (let f = 0; f < 4; f++) {
        let ox = f * 32; let oy = 64;
        rect(ctxH, ox + 12, oy + 6, 8, 8, skin);
        // ... (Simplified copy of IDLE with mouth animation) ...
        if (avatarType === 'FEMALE') rect(ctxH, ox + 11, oy + 4, 10, 6, hair);
        else rect(ctxH, ox + 12, oy + 4, 8, 3, hair);

        rect(ctxH, ox + 11, oy + 14, 10, 10, shirt); rect(ctxH, ox + 11, oy + 24, 4, 8, pants); rect(ctxH, ox + 17, oy + 24, 4, 8, pants);
        if (f % 2 === 0) rect(ctxH, ox + 15, oy + 12, 2, 1, '#d35400'); else rect(ctxH, ox + 15, oy + 11, 2, 3, '#a04000');
    }
    humanSpriteSheet = hs;
}


function gameLoop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    if (roamMode !== 'NONE') {
        updateCat(dt);
        updateHuman(dt);
        // Clean and update emojis
        updateFloatingEmojis(dt);

        charCtx.clearRect(0, 0, 128, 128);
        drawActorOnCtx(charCtx, actors.cat, catSpriteSheet);
        const catEl = document.getElementById('character');
        if (catEl) { catEl.style.left = actors.cat.x + 'px'; catEl.style.top = actors.cat.y + 'px'; }
        updateBubblePosition();
    }
    requestAnimationFrame(gameLoop);
}

function updateCat(dt) {
    let pet = actors.cat;
    // Roam Mode Constraints
    let minY = 0; let maxY = window.innerHeight;
    let fixedY = null;
    if (roamMode === 'BOTTOM') {
        fixedY = window.innerHeight - 50; // Extreme Bottom Floor (Lowered another 30px)
        minY = fixedY;
    }

    if (pet.state === 'IDLE') {
        pet.idleTime += dt;
        pet.decisionTimer += dt; // [NEW] Accumulate time

        // [FIX] Stability: Only make decisions every 2-4 seconds
        if (pet.decisionTimer > 3000) {
            pet.decisionTimer = 0; // Reset
            let r = Math.random();
            if (r < 0.3) { // 30% chance to sleep
                pet.state = 'SLEEP';
                pet.sleepTime = 0;
                pet.sleepDuration = 5000 + Math.random() * 5000;
            }
            else if (r < 0.6) startZoomies(pet, minY); // 30% Zoomies
            else pickRandomTarget(pet, minY); // 40% Walk
        }

        meowTimer += dt;
        // [MUTED] Muted random meowing as requested. Only while dragging.
        // if (meowTimer > nextMeowTime) { meowTimer = 0; nextMeowTime = 30000 + Math.random() * 60000; playRealMeow(); } 
    } else if (pet.state === 'SLEEP') {
        pet.sleepTime += dt;
        if (Math.random() < 0.02) spawnFloatingEmoji("zzz", pet.x + 10, pet.y - 20, "24px", "#3498db");
        if (pet.sleepTime > pet.sleepDuration) {
            pet.state = 'SURPRISE';
            // In Bottom Mode, NO upward jump (vy) to keep linear
            if (roamMode !== 'BOTTOM') pet.vy = -3;
            // [MUTED] Muted random meowing after sleep as requested.
            // playRealMeow();
            setTimeout(() => pickRandomTarget(pet, minY), 1000);
        }
    } else if (pet.state === 'WALK' || pet.state === 'RUN') {
        pet.idleTime = 0;
        const dx = pet.targetX - pet.x; const dy = pet.targetY - pet.y; const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 20) { pet.state = 'IDLE'; }
        else {
            let speed = (pet.state === 'RUN') ? 8 : 3;
            pet.vx = (dx / dist) * speed; pet.vy = (dy / dist) * speed;
            pet.x += pet.vx; pet.y += pet.vy; pet.facingRight = pet.vx > 0;
            if (pet.state === 'RUN' && Math.random() < 0.05) pickRandomTarget(pet, minY);
        }
    } else if (pet.state === 'DRAGGED') { pet.idleTime = 0; }

    // Bounds / Physics
    if (pet.state === 'SURPRISE') {
        if (roamMode !== 'BOTTOM') { pet.vy += 0.2; pet.y += pet.vy; }
    }

    // Force Floor in Bottom Mode
    if (roamMode === 'BOTTOM') {
        const targetY = (companionType === 'UFO') ? fixedY - 40 : fixedY; // UFO hovers higher

        // Linear interpolation to floor if not there
        if (Math.abs(pet.y - targetY) > 5) pet.y += (targetY - pet.y) * 0.1;
        else pet.y = targetY;
    } else {
        if (pet.y < minY) pet.y += 5; if (pet.y > maxY - 50) pet.y = maxY - 50;
    }
    if (pet.x < 0) pet.x = 0; if (pet.x > window.innerWidth - 50) pet.x = window.innerWidth - 50;

    pet.timer += dt;
    let speed = (pet.state === 'SLEEP') ? 500 : (pet.state === 'RUN' ? 30 : (pet.state === 'WALK' ? 80 : 200));
    if (pet.timer > speed) { pet.timer = 0; pet.frame = (pet.frame + 1) % 4; }

    // Thoughts
    if (pet.state !== 'SLEEP') {
        thoughtTimer += dt;
        if (thoughtTimer > nextThoughtTime) { thoughtTimer = 0; nextThoughtTime = 4000 + Math.random() * 4000; showRandomCuteThought(); }
    }
}

function updateHuman(dt) {
    let hum = actors.human;
    let cat = actors.cat;

    let floorY = null;
    if (roamMode === 'BOTTOM') floorY = window.innerHeight - 130;

    // 1. Chase logic
    let dist = Math.sqrt(Math.pow(cat.x - hum.x, 2) + Math.pow(cat.y - hum.y, 2));

    // [FIX] SYNC: If cat is running, Human should react IMMEDIATELY
    // Bypass the "decision timer" completely for Chase Logic
    if (cat.state === 'RUN') {
        hum.state = 'CHASE';
        let angle = Math.atan2(cat.y - hum.y, cat.x - hum.x);
        hum.x += Math.cos(angle) * 5;

        // Locked Y in Bottom Mode
        if (roamMode === 'BOTTOM') {
            // No vertical movement
        } else {
            hum.y += Math.sin(angle) * 5;
        }

        let cosA = Math.cos(angle);
        // STABILIZER: Strict Turn Locking
        // 1. Must be moving fast enough to justify turn
        // 2. Must exceed hysteresis timer
        // 3. Must not be "on top" of target
        if (dist > 60 && Date.now() - hum.lastFaceChange > 1500) {
            if (cosA > 0.6 && !hum.facingRight) { hum.facingRight = true; hum.lastFaceChange = Date.now(); }
            else if (cosA < -0.6 && hum.facingRight) { hum.facingRight = false; hum.lastFaceChange = Date.now(); }
        }

        humanTextTimer += dt;
        if (humanTextTimer > 3000) {
            humanTextTimer = 0;
            // [NEW] Dynamic Shouts
            let shouts = ["Stop!", "Wait!", "Hey!!", "Zoomies!"];
            if (companionType === 'DOG') shouts = ["Down boy!", "Sit!", "No bark!", "Bad dog!"];
            else if (companionType === 'UFO') shouts = ["Too fast!", "Slow down!", "Earth logic!", "Wait!"];
            else if (companionType === 'GHOST') shouts = ["Too spooky!", "Boo!", "Come back!", "Eek!"];
            else if (companionType === 'ROBOT') shouts = ["Halt!", "Error 404!", "Slow down!", "Rebooting..."];
            else if (companionType === 'RABBIT') shouts = ["Hop!", "Catching you!", "Bunny!", "Wait!"];

            showHumanThought(shouts[Math.floor(Math.random() * shouts.length)]);
        }
    } else if (dist > 200) {
        hum.state = 'WALK';
        let angle = Math.atan2(cat.y - hum.y, cat.x - hum.x);
        hum.x += Math.cos(angle) * 2;
        if (roamMode !== 'BOTTOM') hum.y += Math.sin(angle) * 2;

        let cosA = Math.cos(angle);
        if (Date.now() - hum.lastFaceChange > 1500) {
            if (cosA > 0.6 && !hum.facingRight) { hum.facingRight = true; hum.lastFaceChange = Date.now(); }
            else if (cosA < -0.6 && hum.facingRight) { hum.facingRight = false; hum.lastFaceChange = Date.now(); }
        }
    } else {
        // [FIX] Human Stability: Use decision timer
        hum.decisionTimer += dt;

        // [FIX] FREQUENCY: Decreased decision timer to 2.5s (was 4s) so he acts more often
        if (hum.decisionTimer > 2500) {
            hum.decisionTimer = 0;
            if (Math.random() < 0.4) {
                hum.state = 'WALK';
                hum.targetX = hum.x + (Math.random() * 200 - 100);
                if (roamMode === 'BOTTOM') hum.targetY = floorY;
                else hum.targetY = hum.y + (Math.random() * 100 - 50);
            } else {
                hum.state = hum.isTalking ? 'TALK' : 'IDLE';
                // [FIX] FREQUENCY: Increased chance to 40% (was 20%)
                if (Math.random() < 0.4) {
                    let musings = ["Hmm...", "Where is Kitty?", "Kitty?", "Work time."];

                    // [NEW] Dynamic Musings
                    const pName = (companionType === 'DOG') ? "Doggy" : (companionType === 'UFO') ? "Probe" : "Kitty";
                    musings = ["Hmm...", `Where is ${pName}?`, `${pName}?`, "Work time."];

                    if (avatarType === 'ALIEN') {
                        musings = ["Analyzing...", "Human logic?", "Zorp?", "Stars..."];
                    }

                    showHumanThought(musings[Math.floor(Math.random() * musings.length)]);
                }
            }
        }
    }

    // [FIX] FREQUENCY: Decoupled thought logic from state machine
    // Matches Cat logic. Runs independently of walking/idle.
    // Except when talking or chasing (distracting states)
    if (hum.state !== 'TALK' && hum.state !== 'CHASE') {
        // [FIX] Check if message bubble is visible (during talk or just after)
        // accessing DOM in loop is slightly expensive but fine for single element
        const bubble = document.getElementById('speech-bubble');
        if (bubble && bubble.style.display !== 'none') {
            // Skip thinking if message box is visible
            // Do nothing
        } else {
            // Add property if missing
            if (typeof hum.thoughtTimer === 'undefined') { hum.thoughtTimer = 0; hum.nextThoughtTime = 4000; }

            hum.thoughtTimer += dt;
            if (hum.thoughtTimer > hum.nextThoughtTime) {
                hum.thoughtTimer = 0;
                // [FIX] User requested "delay a bit a min of 4 sec gap"
                hum.nextThoughtTime = 4000 + Math.random() * 4000; // 4s - 8s gap
                if (Math.random() < 0.6) { // 60% chance to actually think
                    let musings = ["Hmm...", "Where is Kitty?", "Kitty?", "Work time.", "Need coffee.", "What was that?"];

                    // [NEW] Dynamic Musings
                    const pName = (companionType === 'DOG') ? "Doggy" : (companionType === 'UFO') ? "Probe" : (companionType === 'GHOST') ? "Spirit" : (companionType === 'ROBOT') ? "Unit" : (companionType === 'RABBIT') ? "Bun" : "Kitty";
                    musings = ["Hmm...", `Where is ${pName}?`, `${pName}?`, "Work time.", "Need coffee."];

                    if (avatarType === 'ALIEN') {
                        musings = ["Analyzing...", `Where is ${pName}?`, "Human customs...", "Zorp?", "Mothership?"];
                    } else if (avatarType === 'ZOMBIE') {
                        musings = ["Brains...", "Hungry...", "Ughhh...", `${pName} tasty?`, "Itchy..."];
                    } else if (avatarType === 'WIZARD') {
                        musings = ["Pondering...", "Mana low.", "Magic...", "Where is my staff?", "Hocus Pocus."];
                    } else if (avatarType === 'CYBORG') {
                        musings = ["Scanning...", "System optimal.", "Battery 90%.", "Logic check.", "Target acquired."];
                    }

                    showHumanThought(musings[Math.floor(Math.random() * musings.length)]);
                }
            }
        }
    }

    // Bounds / Roam
    let minY = 0; let maxY = window.innerHeight;

    if (roamMode === 'BOTTOM') {
        // Force Floor
        if (Math.abs(hum.y - floorY) > 5) hum.y += (floorY - hum.y) * 0.1;
        else hum.y = floorY;
    } else {
        if (hum.y < minY) hum.y += 5; if (hum.y > maxY - 50) hum.y = maxY - 50;
    }

    if (hum.x < 0) hum.x = 0; if (hum.x > window.innerWidth - 50) hum.x = window.innerWidth - 50;

    // DOM Update
    let el = document.getElementById('human-actor');
    if (!el) {
        el = document.createElement('div'); el.id = 'human-actor';
        el.style.position = 'absolute'; el.style.width = '128px'; el.style.height = '128px';
        el.style.pointerEvents = 'auto'; el.style.zIndex = '45';
        const c = document.createElement('canvas'); c.width = 128; c.height = 128; el.appendChild(c);
        document.body.appendChild(el);
        el.addEventListener('mouseenter', () => setIgnoreMouseEvents(false));
        el.addEventListener('mouseleave', () => setIgnoreMouseEvents(true));
        // CLICK INTERACTION
        el.addEventListener('click', () => {
            speak("Hi there! Here's my playful kitty!");
            hum.isTalking = true; setTimeout(() => hum.isTalking = false, 3000);
        });

        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            cycleRoamMode();
        });
    }
    el.style.left = hum.x + 'px'; el.style.top = hum.y + 'px';

    const ctx = el.querySelector('canvas').getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    drawActorOnCtx(ctx, hum, humanSpriteSheet);

    hum.timer += dt;
    let speed = (hum.state === 'CHASE') ? 60 : 150;
    if (hum.timer > speed) { hum.timer = 0; hum.frame = (hum.frame + 1) % 4; }
}

function startZoomies(p, minY = 0) {
    p.state = 'RUN';
    p.targetX = Math.random() * window.innerWidth;

    if (roamMode === 'BOTTOM') {
        p.targetY = window.innerHeight - 50; // Fixed Floor (Cat)
    } else {
        p.targetY = minY + Math.random() * (window.innerHeight - minY);
    }
}

function drawActorOnCtx(ctx, actor, sheet) {
    if (!sheet) return;
    ctx.save();
    ctx.translate(64, 64);
    // Corrected Flipping: Positive Scale = Right (Default), Negative = Left
    ctx.scale(actor.facingRight ? actor.scale : -actor.scale, actor.scale);
    let row = 0;
    if (actor.state === 'WALK' || actor.state === 'RUN' || actor.state === 'CHASE') row = 1;
    if (actor.state === 'SLEEP' || actor.state === 'TALK') row = 2;
    if (actor.state === 'SURPRISE') row = 3;
    if (actor.state === 'DRAGGED') row = 4;
    ctx.drawImage(sheet, actor.frame * 32, row * 32, 32, 32, -16, -16, 32, 32);
    ctx.restore();
}

function pickRandomTarget(p, minY = 0) {
    p.targetX = Math.random() * window.innerWidth;

    if (roamMode === 'BOTTOM') {
        p.targetY = window.innerHeight - 50;  // Fixed Floor (Cat)
    } else {
        p.targetY = minY + Math.random() * (window.innerHeight - minY);
    }

    if (p.targetX < 20) p.targetX = 20; if (p.targetX > window.innerWidth - 50) p.targetX = window.innerWidth - 50;
    if (p.targetY < 20) p.targetY = 20; if (p.targetY > window.innerHeight - 50) p.targetY = window.innerHeight - 50;
    p.state = 'WALK';
}

// Single Bubble Logic
function showHumanThought(text) {
    if (activeHumanThought) activeHumanThought.remove();
    // Offset closer to head: y - 10 (Directly above sprite top)
    // Locked tracking
    // [FIX] User requested "reduce the size of the tex tof the human's text"
    // Reducing from 14px to 12px (Aggressive Small)
    activeHumanThought = spawnFloatingEmoji(text, actors.human.x, actors.human.y, "12px", "#FFF", actors.human);
}

function spawnFloatingEmoji(text, x, y, size = "24px", color = "#FFF", attachTo = null) {
    const h = document.createElement('div');
    h.textContent = text;
    h.style.position = "absolute";
    h.style.left = x + "px";
    h.style.top = y + "px";
    h.style.fontSize = size; h.style.color = color; h.style.pointerEvents = "none";
    h.style.zIndex = "9999"; h.style.fontWeight = "bold";
    h.style.textShadow = "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000";
    h.style.fontFamily = "Arial, sans-serif";
    h.style.transition = "opacity 0.5s"; // Only fade opacity
    document.body.appendChild(h);

    // Add to tracking array
    const bubble = {
        el: h,
        life: 2000,
        offsetY: 0,
        attachActor: attachTo,
        baseX: 0, // Relative offset if attached
        baseY: -50
    };

    if (attachTo) {
        // Calculate initial relative offset
        bubble.baseX = 20; // Slightly right of center

        // [FIX] User requested "8px" (much lower) for the cat
        // Cat is smaller object, Human is taller
        if (attachTo === actors.cat) {
            bubble.baseY = -20; // ~ 8px visual gap above small sprite
        } else {
            // [FIX] User said "too high" -> wants it "near the head"
            // Previous -20 was mathematically above the 128px box top-edge? 
            // Let's bring it DOWN significantly into the box area where the sprite head actually is.
            // +30 should be roughly forehead level of the sprite within the 128px container.
            bubble.baseY = 30;
        }
    }

    floatingEmojis.push(bubble);
    return h;
}

function updateFloatingEmojis(dt) {
    for (let i = floatingEmojis.length - 1; i >= 0; i--) {
        const b = floatingEmojis[i];
        b.life -= dt;
        // Float Upward Animation (Faster = "Grow Upwards")
        // [FIX] Restored speed as requested (was 0.01, back to 0.05)
        // Travel distance is now capped in the position logic
        b.offsetY += dt * 0.05;

        if (b.life <= 0) {
            if (b.el.parentElement) b.el.remove();
            floatingEmojis.splice(i, 1);
            continue;
        }

        if (b.attachActor) {
            // Follow behavior with vertical growth
            b.el.style.left = (b.attachActor.x + b.baseX) + "px";

            // [FIX] User Request: "Increase speed... but reduce height"
            // Restore speed to 0.05 (fast)
            // But CAP the max height (offsetY) to 30px (short travel)
            let maxTravel = 30;
            if (b.offsetY > maxTravel) b.offsetY = maxTravel;

            // Combine strict tracking position with animating vertical offset
            b.el.style.top = (b.attachActor.y + b.baseY - b.offsetY) + "px";
        } else {
            // Static float
            let currentTop = parseFloat(b.el.style.top);
            b.el.style.top = (currentTop - 1.0) + "px"; // Faster static rise
        }

        // Fade out logic matching "faded right" (fading out at end)
        if (b.life < 1000) {
            b.el.style.opacity = b.life / 1000;
        }
    }
}

function spawnHeart() { spawnFloatingEmoji("💖", actors.cat.x, actors.cat.y); }

function updateBubblePosition() {
    const bubble = document.getElementById('speech-bubble');
    if (bubble && actors.human) {
        // [FIX] Move to RIGHT of human
        // human.x is center-leftish. 
        // We want bubble to start AFTER the sprite (x + 40)
        bubble.style.left = (actors.human.x + 40) + 'px';
        bubble.style.top = (actors.human.y - 10) + 'px';


        // Ensure visibility if it has content
        if (bubble.textContent && bubble.textContent.length > 0 && bubble.style.display === 'none') {
            // If we missed a display toggle, ensure it's visible if it has text
            // But we rely on showBubble() to set display block usually
        }
    }
}

function showRandomCuteThought() {
    let thoughts = ["🐟", "🧶", "🥛", "🐭", "❤️", "🐾", "✨", "🦋"];

    if (companionType === 'DOG') {
        thoughts = ["🦴", "🥩", "🎾", "🐿️", "💩", "🐾", "🐕", "🌭"];
    } else if (companionType === 'UFO') {
        thoughts = ["📡", "👽", "🪐", "⚡", "🔋", "💿", "🌌", "🐄"];
    }

    spawnFloatingEmoji(thoughts[Math.floor(Math.random() * thoughts.length)], actors.cat.x, actors.cat.y, "24px", "#FFF", actors.cat);
}

// --- Audio Logic ---
let currentAudio = null;
function playRealMeow() {
    if (companionType === 'DOG') {
        playSynthBark();
        return;
    } else if (companionType === 'UFO') {
        playSynthUFO();
        return;
    }

    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    const file = MEOW_SOUNDS[Math.floor(Math.random() * MEOW_SOUNDS.length)];
    const audio = new Audio(`assets/${file}`);
    audio.playbackRate = 0.9 + Math.random() * 0.3; audio.volume = 0.5;
    audio.play().catch(e => { console.warn("Audio failed", e); playSynthMeow(0.1); });
    currentAudio = audio;
}

function playSynthBark() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const os = audioCtx.createOscillator(); const g = audioCtx.createGain();
    os.connect(g); g.connect(audioCtx.destination);
    os.type = 'sawtooth';
    os.frequency.setValueAtTime(300, audioCtx.currentTime);
    os.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
    g.gain.setValueAtTime(0.2, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    os.start(); os.stop(audioCtx.currentTime + 0.1);
}

function playSynthUFO() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const os = audioCtx.createOscillator(); const g = audioCtx.createGain();
    os.connect(g); g.connect(audioCtx.destination);
    os.type = 'sine';
    os.frequency.setValueAtTime(400, audioCtx.currentTime);
    os.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.3);
    g.gain.setValueAtTime(0.1, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
    os.start(); os.stop(audioCtx.currentTime + 0.3);
}

function playDragSound() {
    if (currentAudio) currentAudio.pause();
    const audio = new Audio(`assets/meow1.mp3`);
    audio.playbackRate = 1.3 + Math.random() * 0.2; audio.volume = 0.4;
    audio.play().catch(e => playSynthMeow(0.15));
    currentAudio = audio;
}

function playSynthMeow(duration = 0.3) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const os = audioCtx.createOscillator(); const g = audioCtx.createGain();
    os.connect(g); g.connect(audioCtx.destination);
    os.type = 'triangle'; os.frequency.setValueAtTime(900, audioCtx.currentTime);
    os.frequency.exponentialRampToValueAtTime(500, audioCtx.currentTime + duration);
    g.gain.setValueAtTime(0.1, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    os.start(); os.stop(audioCtx.currentTime + duration);
}

async function setupAudioRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunks.push(event.data); };
        mediaRecorder.onstop = async () => {
            logToScreen("🎤 Sending...");
            document.getElementById('btn-mic').classList.remove('listening');
            showBubble("Thinking... 🧠");
            setIgnoreMouseEvents(true);
            const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
            audioChunks = [];
            const base64Audio = await blobToBase64(audioBlob);
            processAudioMessage(base64Audio);
        };
        logToScreen("✅ Mic Ready");
    } catch (err) { logToScreen("❌ Mic Failure: " + err.message); }
}

function toggleListening() {
    // [INTERRUPT] Stop speaking immediately when button is clicked
    stopSpeaking();
    currentRequestId++; // Increment ID to ignore previous in-flight requests

    if (actors.human) {
        actors.human.isTalking = false;
        actors.human.state = 'IDLE';
    }

    if (!mediaRecorder) { logToScreen("⚠️ Mic not ready"); return; }
    if (mediaRecorder.state === "inactive") {
        audioChunks = []; mediaRecorder.start();
        document.getElementById('btn-mic').classList.add('listening');
        showBubble("Listening... 👂"); logToScreen("🔴 Recording...");
    } else { mediaRecorder.stop(); logToScreen("🛑 Processing..."); }
}

function blobToBase64(blob) {
    return new Promise((resolve, _) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
    });
}

function stopSpeaking() {
    const audio = document.getElementById('audio-player');
    if (audio) { audio.pause(); audio.currentTime = 0; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel(); // Also stop system voice
}

async function processAudioMessage(base64Audio) {
    const requestId = ++currentRequestId; // Store local copy of current ID
    try {
        const genAI = new GoogleGenerativeAI(geminiKey);

        // --- REFINED SYSTEM PROMPT ---
        const systemPrompt = `You are "Glitch", a helpful, professional, and slightly sarcastic Desktop AI Companion.
        
        IDENTITY:
        - You are supportive and efficient.
        - You NEVER use inappropriate, sexual, or offensive language.
        - You are a companion, not a distractor. Use humor tastefully.
        
        CAPABILITIES:
        1. [FILE SYSTEM] Write/Read code, create projects.
        2. [SHELL] Run terminal commands (npm, git, code).
        3. [BROWSER] Navigate & Search.
        4. [VISION] See screen (ONLY if an image is provided in the message).
        5. [PROJECT CREATION] Create developer projects with scaffolding, README, and auto-open in VS Code with AI assistant.

        VISION RULES:
        - If an image IS provided, you can describe the screen or apps.
        - If NO image is provided, do NOT hallucinate what you see. Inform the user you need to see the screen first if they ask.
        
        PROJECT CREATION RULES:
        - When user asks to build/create websites, apps, APIs, or any developer project, use the "project" action.
        - This will: 1) Create project folder with structure, 2) Generate comprehensive README.md, 3) Open in VS Code, 4) Trigger Ctrl+I for AI assistance.
        - Supported project types: website, nextjs, api, python, vue, electron, mobile, generic.
        - Examples of project requests: "build a portfolio website", "create a React app", "make an API for users", "python web scraper"
        
        BEHAVIOR:
        - If the user asks for a complex task (e.g., "Build a website"), start an AGENT LOOP.
        - You can Execute MULTIPLE steps by returning a JSON ARRAY of objects.
        - [CRITICAL] ALWAYS include a "speak" action in your array so the user hears what you are doing.
        - Output valid JSON only for actions.
        
        TOOLS (JSON FORMAT):
        - { "type": "open", "url": "..." }
        - { "type": "file", "operation": "write", "path": "...", "content": "..." }
        - { "type": "shell", "command": "...", "cwd": "..." }
        - { "type": "speak", "text": "..." }
        - { "type": "project", "name": "...", "description": "...", "projectType": "website|nextjs|api|python|..." }
        `;

        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: systemPrompt });

        if (!window.chatSession) {
            window.chatSession = model.startChat({
                history: [
                    { role: "user", parts: [{ text: "System Boot." }] },
                    { role: "model", parts: [{ text: "Glitch OS Online. Awaiting complex directives." }] },
                ],
            });
        }

        // [OPTIMIZATION] History Pruning
        // Keep only last 10 messages (5 user-model turns) to save tokens and reduce request size
        if (window.chatSession.history && window.chatSession.history.length > 10) {
            // Remove oldest, keep first 2 (Context) + last 8
            const keep = window.chatSession.history.slice(window.chatSession.history.length - 8);
            const context = window.chatSession.history.slice(0, 2);
            window.chatSession.history = [...context, ...keep];
            logToScreen("🧹 History Pruned (max 10 msgs).");
        }

        // [VISION] Capture screen ONLY if vision is active toggle is on
        const userMsgParts = [{ inlineData: { data: base64Audio, mimeType: "audio/mp3" } }];

        if (isVisionActive) {
            logToScreen("📸 Vision Active: Capturing Clean Screen...");
            const screenshot = await ipcRenderer.invoke('capture-clean', {
                width: 1024,
                height: 576,
                saveToVision: true
            });

            if (screenshot) {
                userMsgParts.unshift({
                    inlineData: { data: screenshot, mimeType: "image/png" }
                });
            }
        }

        const result = await window.chatSession.sendMessage(userMsgParts);

        // CHECK: If request was interrupted during API call, STOP HERE
        if (requestId !== currentRequestId) {
            logToScreen("⏹️ Request Interrupted. Silent.");
            return;
        }

        const responseText = result.response.text();
        logToScreen("🤖 " + responseText);

        // --- AGENT LOOP HANDLING ---
        // Enhanced parser for Arrays or Single JSON
        // Regex to find either [...] or {...}
        if (responseText.trim().includes('{') || responseText.trim().includes('[')) {
            try {
                let actions = [];
                // 1. Try to find Array First
                const arrayMatch = responseText.match(/\[([\s\S]*)\]/);
                if (arrayMatch) {
                    actions = JSON.parse(arrayMatch[0]);
                } else {
                    // 2. Try Single Object
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) actions = [JSON.parse(jsonMatch[0])];
                }

                if (actions.length > 0) {
                    for (const action of actions) {
                        if (action.type === 'speak') {
                            showBubble(action.text);
                            speak(action.text);
                            // Do not return, continue to next action (e.g., Speak then Do)
                            continue;
                        }

                        // [PROJECT CREATION] Handle project creation
                        if (action.type === 'project') {
                            logToScreen(`🚀 Creating project: ${action.name}`);
                            showBubble(`Creating ${action.name}...`);

                            const projectResult = await ipcRenderer.invoke('create-project', {
                                name: action.name,
                                description: action.description || '',
                                projectType: action.projectType || null
                            });

                            if (projectResult.success) {
                                logToScreen(`✅ ${projectResult.message}`);
                                showBubble(`Project ready! Opening in VS Code...`);
                            } else {
                                logToScreen(`❌ Project creation failed: ${projectResult.error}`);
                                showBubble(`Failed to create project: ${projectResult.error}`);
                            }

                            // Wait a bit before continuing
                            await new Promise(r => setTimeout(r, 2000));
                            continue;
                        }

                        logToScreen(`⚡ EXECUTING: ${action.type}`);
                        showBubble("Running: " + action.type);

                        // Execute Action
                        let output = "";
                        if (['open', 'search', 'app', 'type', 'file', 'shell'].includes(action.type)) {
                            output = await ipcRenderer.invoke('perform-action', action);
                        }

                        // [Beast Mode] Log output
                        if (output) logToScreen(`✅ Result: ${output.substring(0, 30)}...`);

                        // Optional: Small delay between steps
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    return;
                }
            } catch (e) {
                console.error("JSON Parse Error", e);
            }
        }

        // Fallback: Just talk
        showBubble(responseText);
        speak(responseText);
    } catch (e) {
        logToScreen("❌ Error: " + e.message);
        showBubble(e.message);
    }
}

async function speak(text) {
    try {
        logToScreen("🗣️ Processing Speech...");
        if (!elevenKey) {
            logToScreen("❌ No ElevenLabs Key");
            fallbackSpeak(text);
            return;
        }
        if (!voiceId) {
            logToScreen("⚠️ No Voice ID, using fallback.");
            fallbackSpeak(text);
            return;
        }

        logToScreen("📡 Sending to ElevenLabs...");
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': elevenKey },
            body: JSON.stringify({ text: text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.8 } })
        });

        // [FIX] Better Error Handling
        if (!response.ok) {
            const errText = await response.text();
            logToScreen(`❌ TTS API Error: ${response.status} - ${errText}`);
            logToScreen("⚠️ Switching to Fallback Voice...");
            fallbackSpeak(text); // [NEW] Failover
            return;
        }

        const blob = await response.blob();
        const audio = document.getElementById('audio-player');
        audio.src = URL.createObjectURL(blob);

        if (actors.human) {
            actors.human.isTalking = true;
            actors.human.state = 'TALK';
            audio.onended = () => { actors.human.isTalking = false; actors.human.state = 'IDLE'; };
        }
        logToScreen("🔊 Playing audio...");
        audio.play().catch(e => {
            logToScreen("❌ Play Error: " + e.message);
            fallbackSpeak(text); // [NEW] Failover on play error
        });
    } catch (e) {
        logToScreen("❌ TTS Network Error: " + e.message);
        fallbackSpeak(text); // [NEW] Failover on network error
    }
}

// [NEW] Fallback TTS
function fallbackSpeak(text) {
    try {
        if ('speechSynthesis' in window) {
            logToScreen("🤖 using System Voice");
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            // Try to find a decent voice
            const voices = window.speechSynthesis.getVoices();
            const preferred = voices.find(v => v.name.includes('Google') || v.name.includes('David') || v.name.includes('Zira'));
            if (preferred) utterance.voice = preferred;

            if (actors.human) {
                actors.human.isTalking = true;
                actors.human.state = 'TALK';
                utterance.onend = () => { actors.human.isTalking = false; actors.human.state = 'IDLE'; };
            }

            window.speechSynthesis.speak(utterance);
        } else {
            logToScreen("❌ No System Voice Available");
        }
    } catch (e) {
        logToScreen("❌ Fallback Failed: " + e.message);
    }
}

function showBubble(text) {
    // [FIX] OVERLAP: If bubble shows, existing thoughts MUST vanish
    if (activeHumanThought) activeHumanThought.remove();

    const bubble = document.getElementById('speech-bubble');
    if (bubble) {
        bubble.textContent = text;
        bubble.style.display = 'block';
        setTimeout(() => {
            const audio = document.getElementById('audio-player');
            if (audio.paused) bubble.style.display = 'none';
        }, 5000);
    }
}

// ==========================================
// [RESTORED] Draggable Controls Logic
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const controlsArea = document.querySelector('.controls-area');
    const toggleBtn = document.getElementById('btn-toggle-controls');

    // 1. Toggle Logic
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger drag
            controlsArea.classList.toggle('collapsed');
            const isCollapsed = controlsArea.classList.contains('collapsed');

            // Hide/Show other buttons
            const btns = controlsArea.querySelectorAll('button:not(#btn-toggle-controls)');
            btns.forEach(b => b.style.display = isCollapsed ? 'none' : 'flex');

            // Toggle Icon
            toggleBtn.innerHTML = isCollapsed ? '<i class="fas fa-bars"></i>' : '<i class="fas fa-times"></i>';
        });

        // Ensure transparency works on toggle
        toggleBtn.addEventListener('mouseenter', () => ipcRenderer.send('set-ignore-mouse-events', false));
        toggleBtn.addEventListener('mouseleave', () => {
            // Only ignore if not dragging
            if (!isDraggingControls) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        });
    }

    // 2. Drag Logic
    let isDraggingControls = false;
    let startX, startY, initialLeft, initialTop;

    if (controlsArea) {
        controlsArea.addEventListener('mousedown', (e) => {
            // Allow dragging from buttons too, just NOT the toggle button
            if (e.target.closest('#btn-toggle-controls')) return;

            isDraggingControls = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = controlsArea.getBoundingClientRect();

            // Switch to fixed positioning based on current visual
            controlsArea.style.bottom = 'auto';
            controlsArea.style.left = rect.left + 'px';
            controlsArea.style.top = rect.top + 'px';
            controlsArea.style.transform = 'none';

            initialLeft = rect.left;
            initialTop = rect.top;

            controlsArea.style.cursor = 'grabbing';
            ipcRenderer.send('set-ignore-mouse-events', false); // Lock focus
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDraggingControls) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // Simple Bounds
            const maxX = window.innerWidth - 50;
            const maxY = window.innerHeight - 50;
            if (newLeft < 0) newLeft = 0; if (newLeft > maxX) newLeft = maxX;
            if (newTop < 0) newTop = 0; if (newTop > maxY) newTop = maxY;

            controlsArea.style.left = newLeft + 'px';
            controlsArea.style.top = newTop + 'px';

            // 3. Smart Orientation
            // If near Left/Right edge (< 100px), go Vertical
            const isNearSide = (newLeft < 100) || (newLeft > window.innerWidth - 100);

            if (isNearSide) {
                controlsArea.style.flexDirection = 'column';
                controlsArea.style.width = 'auto';
                controlsArea.style.height = 'auto';
                controlsArea.style.padding = '10px 5px';
            } else {
                controlsArea.style.flexDirection = 'row';
                controlsArea.style.width = 'auto';
                controlsArea.style.height = 'auto';
                controlsArea.style.padding = '5px 10px';
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDraggingControls) {
                isDraggingControls = false;
                controlsArea.style.cursor = 'move';
            }
        });

        // Transparency Logic for Container
        controlsArea.addEventListener('mouseenter', () => ipcRenderer.send('set-ignore-mouse-events', false));
        controlsArea.addEventListener('mouseleave', () => {
            if (!isDraggingControls) ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
        });
    }
});