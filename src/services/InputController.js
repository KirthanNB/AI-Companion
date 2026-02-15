const { spawn } = require('child_process');
const path = require('path');

let pythonProcess = null;
let bridgeReady = false;
let isRestarting = false;

function cleanupPythonProcess() {
    if (pythonProcess) {
        try {
            pythonProcess.stdin.removeAllListeners();
            pythonProcess.stdout.removeAllListeners();
            pythonProcess.stderr.removeAllListeners();
            pythonProcess.removeAllListeners();
            if (!pythonProcess.killed) {
                pythonProcess.kill();
            }
        } catch (e) {
            // Ignore cleanup errors
        }
        pythonProcess = null;
    }
    bridgeReady = false;
}

function startPythonBridge() {
    if (pythonProcess || isRestarting) return;

    isRestarting = true;
    const scriptPath = path.join(__dirname, 'input_bridge.py');

    // Try multiple Python commands (Windows compatibility)
    const pythonCommands = ['python', 'python3', 'py'];
    let attemptIndex = 0;

    function tryNextPython() {
        if (attemptIndex >= pythonCommands.length) {
            console.error('❌ Failed to start Python bridge. Install Python and pydirectinput.');
            isRestarting = false;
            return;
        }

        const cmd = pythonCommands[attemptIndex];
        console.log(`🐍 Attempting to start Python bridge with: ${cmd}`);

        try {
            pythonProcess = spawn(cmd, [scriptPath]);

            // Handle stdin errors to prevent EPIPE crashes
            pythonProcess.stdin.on('error', (err) => {
                console.error('Python bridge stdin error:', err.message);
                cleanupPythonProcess();
            });

            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();
                if (output.includes('success') || output.includes('ready')) {
                    bridgeReady = true;
                }
                console.log('Python Bridge:', output);
            });

            pythonProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.error('Python Bridge Error:', error);

                // If it's a "not found" error, try next command
                if (error.includes('not found') || error.includes('No module')) {
                    cleanupPythonProcess();
                    attemptIndex++;
                    setTimeout(tryNextPython, 100);
                }
            });

            pythonProcess.on('close', (code) => {
                console.log(`Python bridge exited with code ${code}`);
                cleanupPythonProcess();
            });

            pythonProcess.on('error', (err) => {
                console.error(`Failed to start ${cmd}:`, err.message);
                cleanupPythonProcess();
                attemptIndex++;
                setTimeout(tryNextPython, 100);
            });

            // Give it a moment to fail or succeed
            setTimeout(() => {
                if (pythonProcess && !pythonProcess.killed) {
                    console.log(`✅ Python bridge started successfully with ${cmd}`);
                    isRestarting = false;
                }
            }, 500);

        } catch (err) {
            console.error(`Error spawning ${cmd}:`, err);
            cleanupPythonProcess();
            attemptIndex++;
            setTimeout(tryNextPython, 100);
        }
    }

    tryNextPython();
}

function sendCommand(command) {
    if (!pythonProcess || !pythonProcess.stdin || pythonProcess.killed) {
        console.warn('⚠️ Python bridge not running. Attempting to start...');
        startPythonBridge();
        return;
    }

    // Check if stdin is writable
    if (!pythonProcess.stdin.writable) {
        console.warn('⚠️ Python bridge stdin not writable. Restarting...');
        cleanupPythonProcess();
        startPythonBridge();
        return;
    }

    try {
        pythonProcess.stdin.write(JSON.stringify(command) + '\n');
        console.log('📤 Sent to Python:', command.type);
    } catch (err) {
        console.error('Failed to send command:', err.message);
        cleanupPythonProcess();
        // Don't restart immediately to avoid spam
    }
}

const InputController = {
    isEnabled: () => true, // Assuming python works

    moveMouse: (x, y) => {
        sendCommand({ type: 'mouseMove', x, y });
    },

    click: (button = "left") => {
        sendCommand({ type: 'click', button });
    },

    type: (text) => {
        sendCommand({ type: 'type', text });
    },

    // [NEW] Paste function for bulk text
    paste: (text) => {
        // We will send a special 'paste' command
        sendCommand({ type: 'paste', text });
    },

    pressKey: (key) => {
        sendCommand({ type: 'press', key });
    },

    keyDown: (key) => {
        sendCommand({ type: 'keyDown', key });
    },

    keyUp: (key) => {
        sendCommand({ type: 'keyUp', key });
    }
};

// Start immediately
startPythonBridge();

module.exports = InputController;
