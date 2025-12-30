// src/main.js - Electron Main Process
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

let mainWindow;

function createWindow() {
  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false, // Fixed size for overlay
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      backgroundThrottling: false
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  // Default: Ignore mouse events (pass through)
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // Mouse event forwarding handler
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.setIgnoreMouseEvents(ignore, { forward: true });
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('🚀 AI Companion Started!');
  console.log('📍 Environment loaded:', {
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY
  });

  // Grant permissions for voice/mic
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'audioCapture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });
}

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const Automation = require('./automation');
const GameAgent = require('./ai/GameAgent');

let gameAgentInstance = null;

// [NEW] Clean Capture Logic for the Agent
async function cleanCapture(options) {
  if (!mainWindow) return null;

  // Hide overlay to prevent AI from clicking its own UI
  mainWindow.setOpacity(0);
  await new Promise(r => setTimeout(r, 60)); // Wait for redraw

  const { captureScreen } = require('./services/ScreenObserver');
  const img = await captureScreen(options);

  mainWindow.setOpacity(1);
  return img;
}

function getGameAgent() {
  if (!gameAgentInstance) {
    try {
      console.log('🎯 Creating GameAgent instance...');
      gameAgentInstance = new GameAgent(
        process.env.GEMINI_API_KEY,
        (msg) => {
          // Logger: Send to all windows for log display
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('agent-log', msg);
          });
          console.log(msg);
        },
        cleanCapture,
        (text) => {
          // Speaker: Send to all windows for TTS
          BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('agent-speak', text);
          });
        }
      );
      console.log('✅ GameAgent created successfully');
    } catch (error) {
      console.error('❌ Failed to create GameAgent:', error.message);
      console.error('Stack:', error.stack);
      throw error;
    }
  }
  return gameAgentInstance;
}

// IPC handlers
ipcMain.handle('get-env', (event, key) => {
  return process.env[key];
});

// Screen Capture Handler
ipcMain.handle('take-screenshot', async () => {
  const { captureScreen } = require('./services/ScreenObserver');
  return await captureScreen();
});

// [NEW] Clean Capture: Hide overlay briefly, capture, then show
ipcMain.handle('capture-clean', async (event, options = { width: 1024, height: 576, saveToVision: false }) => {
  const { captureScreen } = require('./services/ScreenObserver');
  const win = BrowserWindow.fromWebContents(event.sender);

  if (win) {
    win.setOpacity(0); // Faster than hide()
    // Give OS a tiny bit of time to redraw (60ms is usually enough)
    await new Promise(r => setTimeout(r, 60));
    const img = await captureScreen(options);
    win.setOpacity(1);

    // [NEW] Logging for voice-vision if requested
    if (options.saveToVision && img) {
      try {
        const visionDir = path.join(__dirname, '..', 'vision');
        if (!fs.existsSync(visionDir)) fs.mkdirSync(visionDir, { recursive: true });
        const fileName = `voice-vision-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        fs.writeFileSync(path.join(visionDir, fileName), Buffer.from(img, 'base64'));
        console.log(`📸 Voice Vision saved: ${fileName}`);
      } catch (err) {
        console.error("Failed to save voice vision:", err);
      }
    }

    return img;
  }
  return null;
});

// Browser Automation Handler
ipcMain.handle('perform-action', async (event, action) => {
  try {
    console.log('🤖 Performing action:', action);

    if (action.type === 'open') {
      await Automation.navigate(action.url);
      return "Opened " + action.url;
    }

    if (action.type === 'search') {
      await Automation.search(action.query);
      return "Searched for " + action.query;
    }

    // Phase 7: Desktop Control
    if (action.type === 'app') {
      const { exec } = require('child_process');
      const appName = action.app.toLowerCase();
      let command = `start ${action.app}`;

      const appMap = {
        'calculator': 'calc',
        'notepad': 'notepad',
        'vscode': 'code',
        'vs code': 'code',
        'visual studio code': 'code',
        'terminal': 'cmd',
        'explorer': 'explorer',
        'chrome': 'chrome'
      };

      if (appMap[appName]) {
        command = `start ${appMap[appName]}`;
      } else {
        // Handle names with spaces by quoting
        command = `start "" "${action.app}"`;
      }

      exec(command, (err) => {
        if (err) console.error("Failed to launch app:", err);
      });
      return "Launching " + action.app;
    }

    // Phase 7: Typing (Keyboard Simulation)
    if (action.type === 'type') {
      const InputController = require('./services/InputController');
      InputController.type(action.text);
      return "Typing: " + action.text;
    }

    // Phase 8: Real-time Input
    if (action.type === 'pressKey') {
      const InputController = require('./services/InputController');
      InputController.pressKey(action.key);
      return "Pressed " + action.key;
    }

    if (action.type === 'click') {
      const InputController = require('./services/InputController');
      InputController.click();
      return "Clicked mouse";
    }

    // --- BEAST MODE: Files & Shell ---
    if (action.type === 'file') {
      const { handleFileAction } = require('./tools/files');
      return await handleFileAction(action);
    }

    if (action.type === 'shell') {
      const { handleShellAction } = require('./tools/shell');
      return await handleShellAction(action);
    }

    return "Unknown action";
  } catch (error) {
    console.error('Automation failed:', error);
    return "Failed: " + error.message;
  }
});

// Project Creation Handler
ipcMain.handle('create-project', async (event, { name, description, projectType }) => {
  try {
    console.log('🚀 Creating project:', name, projectType);

    const ProjectScaffoldService = require('./services/ProjectScaffoldService');
    const scaffoldService = new ProjectScaffoldService();

    // Auto-detect project type if not provided
    const detectedType = projectType || scaffoldService.detectProjectType(description || name);

    // Create the project
    const result = scaffoldService.createProject(name, detectedType, description);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log('✅ Project created at:', result.projectPath);

    // Open in VS Code and trigger AI
    const EnhancedAutomation = require('./services/EnhancedAutomationService');
    const automation = new EnhancedAutomation();

    console.log('📂 Opening in VS Code...');
    const vscodeResult = await automation.openProjectInVSCode(result.projectPath);

    return {
      success: true,
      projectPath: result.projectPath,
      projectType: detectedType,
      message: `Project "${name}" created and opened in VS Code with AI assistant ready!`,
      vscodeResult
    };
  } catch (error) {
    console.error('Project creation failed:', error);
    return { success: false, error: error.message };
  }
});

// Game Agent IPC
ipcMain.handle('start-game-agent', async (event, instruction) => {
  const agent = getGameAgent();
  agent.start(instruction);
  return "Game Agent Started";
});

ipcMain.handle('stop-game-agent', async () => {
  const agent = getGameAgent();
  agent.stop();
  return "Game Agent Stopped";
});

console.log('✅ Electron app initialized');