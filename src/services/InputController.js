const { spawn } = require('child_process');
const path = require('path');

let pythonProcess = null;

function startPythonBridge() {
    if (pythonProcess) return;

    const scriptPath = path.join(__dirname, 'input_bridge.py');
    pythonProcess = spawn('python', [scriptPath]); // Assumes 'python' is in PATH

    pythonProcess.stdout.on('data', (data) => {
        // console.log('Python Input Bridge:', data.toString());
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error('Python Bridge Error:', data.toString());
    });

    pythonProcess.on('close', (code) => {
        console.log(`Python bridge process exited with code ${code}`);
        pythonProcess = null;
        // Auto-restart if it crashed?
    });
}

function sendCommand(command) {
    if (!pythonProcess) startPythonBridge();
    if (pythonProcess) {
        pythonProcess.stdin.write(JSON.stringify(command) + '\n');
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
