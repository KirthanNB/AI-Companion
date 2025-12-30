// src/services/EnhancedAutomationService.js
const { mouse, keyboard, screen, straightTo, Point, Region, Button } = require('@nut-tree-fork/nut-js');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Enhanced Automation Service using nut-js
 * Provides OCR, image matching, window management, and precise control
 */
class EnhancedAutomationService {
    constructor() {
        // Configure mouse for smooth but fast movement
        mouse.config.autoDelayMs = 2; // Minimal delay for speed
        mouse.config.mouseSpeed = 2000; // Faster mouse

        // Configure keyboard
        keyboard.config.autoDelayMs = 2;
    }

    /**
     * Get list of all open windows
     */
    async getWindows() {
        try {
            // Use PowerShell to get window titles
            const { stdout } = await execPromise(
                `powershell "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object MainWindowTitle, Id | ConvertTo-Json"`
            );
            const windows = JSON.parse(stdout);
            return Array.isArray(windows) ? windows : [windows];
        } catch (error) {
            console.error('Failed to get windows:', error);
            return [];
        }
    }

    /**
     * Find a window by title (partial match)
     */
    async findWindow(titlePattern) {
        const windows = await this.getWindows();
        return windows.find(w =>
            w.MainWindowTitle && w.MainWindowTitle.toLowerCase().includes(titlePattern.toLowerCase())
        );
    }

    /**
     * Focus a window by title
     */
    async focusWindow(titlePattern) {
        const window = await this.findWindow(titlePattern);
        if (!window) {
            throw new Error(`Window not found: ${titlePattern}`);
        }

        // Use PowerShell to bring window to foreground
        await execPromise(
            `powershell "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'; [Win32]::SetForegroundWindow((Get-Process -Id ${window.Id}).MainWindowHandle)"`
        );

        // Wait for window to be ready
        await new Promise(r => setTimeout(r, 300));
        return window;
    }

    /**
     * Move mouse to coordinates (absolute screen position)
     */
    async moveMouse(x, y) {
        await mouse.setPosition(new Point(x, y));
    }

    /**
     * Click at current position or specified coordinates
     */
    async click(x = null, y = null, button = Button.LEFT) {
        if (x !== null && y !== null) {
            await this.moveMouse(x, y);
            await new Promise(r => setTimeout(r, 200)); // Hover delay
        }
        await mouse.click(button);
    }

    /**
     * Double-click at current position or specified coordinates
     */
    async doubleClick(x = null, y = null) {
        if (x !== null && y !== null) {
            await this.moveMouse(x, y);
            await new Promise(r => setTimeout(r, 200));
        }
        await mouse.doubleClick(Button.LEFT);
    }

    /**
     * Type text (supports special characters and Unicode)
     */
    /**
     * Type text with controlled speed
     */
    async type(text, delayMs = 10) {
        // Use clipboard for long text to ensure accuracy and speed
        // Only use typing for short text or when clipboard might fail requirements
        if (text.length > 50) {
            // TODO: Implement clipboard paste if needed, for now just type fast
        }

        // Type character by character with minimal delay
        for (const char of text) {
            await keyboard.type(char);
            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        }
    }

    /**
     * Press a key or key combination
     * Examples: 'enter', 'escape', 'ctrl+c', 'win+r'
     */
    async pressKey(keyCombo) {
        const parts = keyCombo.toLowerCase().split('+');
        const { Key } = require('@nut-tree-fork/nut-js');

        if (parts.length === 1) {
            // Single key
            const key = this.mapKey(parts[0]);
            await keyboard.type(key);
        } else {
            // Key combination - use keyboard.type with array
            const keys = parts.map(k => this.mapKey(k));
            // For combinations, hold modifiers and press the final key
            const modifiers = keys.slice(0, -1);
            const mainKey = keys[keys.length - 1];

            // Press all keys together
            for (const mod of modifiers) {
                await keyboard.pressKey(mod);
            }

            // Explicitly press and release main key using pressKey/releaseKey
            // to ensure it registers while modifiers are held
            await keyboard.pressKey(mainKey);
            await keyboard.releaseKey(mainKey);

            // Release modifiers (in reverse order)
            for (const mod of modifiers.reverse()) {
                await keyboard.releaseKey(mod);
            }
        }
    }

    /**
     * Map key names to nut-js Key enum
     */
    mapKey(keyName) {
        const { Key } = require('@nut-tree-fork/nut-js');
        const keyMap = {
            'enter': Key.Enter,
            'return': Key.Enter,
            'escape': Key.Escape,
            'esc': Key.Escape,
            'tab': Key.Tab,
            'space': Key.Space,
            'backspace': Key.Backspace,
            'delete': Key.Delete,
            'ctrl': Key.LeftControl,
            'control': Key.LeftControl,
            'alt': Key.LeftAlt,
            'shift': Key.LeftShift,
            'win': Key.LeftSuper,
            'windows': Key.LeftSuper,
            'cmd': Key.LeftSuper,
            'up': Key.Up,
            'down': Key.Down,
            'left': Key.Left,
            'right': Key.Right,
            'home': Key.Home,
            'end': Key.End,
            'pageup': Key.PageUp,
            'pagedown': Key.PageDown,
        };

        return keyMap[keyName] || keyName;
    }

    /**
     * Get screenshot of entire screen
     */
    async captureScreen() {
        const img = await screen.grab();
        return img;
    }

    /**
     * Get screenshot of a region
     */
    async captureRegion(x, y, width, height) {
        const region = new Region(x, y, width, height);
        const img = await screen.grabRegion(region);
        return img;
    }

    /**
     * Paste text using Clipboard and Ctrl+V (Best for long text/URLs)
     */
    async paste(text) {
        // Use PowerShell to set clipboard (reliable on Windows)
        // Check for special characters that might break PowerShell arguments
        const safeText = text.replace(/"/g, '\\"');
        const setClipCmd = `powershell -command "Set-Clipboard -Value \\"${safeText}\\""`;

        try {
            await execPromise(setClipCmd);
            await new Promise(r => setTimeout(r, 200)); // Wait for clipboard update
            await this.pressKey('ctrl+v');
        } catch (e) {
            console.error("Clipboard Error:", e);
            // Fallback to typing
            await this.type(text);
        }
    }

    /**
     * Launch an application
     */
    async launchApp(appName) {
        // Try Windows search approach
        await this.pressKey('win');
        await new Promise(r => setTimeout(r, 500));
        await this.type(appName);
        await new Promise(r => setTimeout(r, 800)); // Increased search wait
        await this.pressKey('enter');

        // [FIX] Increased to 7s for heavy apps like WhatsApp
        // WhatsApp needs extra time to fully initialize UI
        const isWhatsApp = appName.toLowerCase().includes('whatsapp');
        const delay = isWhatsApp ? 7000 : 5000;
        await new Promise(r => setTimeout(r, delay));
    }

    /**
     * Open Windows Run dialog and execute command
     */
    async runCommand(command) {
        await this.pressKey('win+r');
        await new Promise(r => setTimeout(r, 500));
        await this.type(command);
        await new Promise(r => setTimeout(r, 200));
        await this.pressKey('enter');
        await new Promise(r => setTimeout(r, 2000)); // Wait for command
    }

    /**
     * Open a folder in VS Code
     */
    async openInVSCode(folderPath) {
        try {
            // Use 'code' command to open folder in VS Code
            const command = `code "${folderPath}"`;
            await execPromise(command);

            // Wait for VS Code to open and load the folder
            await new Promise(r => setTimeout(r, 3000));

            return { success: true, message: `Opened ${folderPath} in VS Code` };
        } catch (error) {
            console.error('Failed to open VS Code:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Trigger VS Code AI assistant (Ctrl+I)
     */
    async triggerVSCodeAI() {
        try {
            // Focus VS Code window first
            await this.focusWindow('Visual Studio Code');

            // Wait for focus
            await new Promise(r => setTimeout(r, 500));

            // Send Ctrl+I to trigger AI assistant
            await this.pressKey('ctrl+i');

            return { success: true, message: 'Triggered VS Code AI assistant (Ctrl+I)' };
        } catch (error) {
            console.error('Failed to trigger VS Code AI:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Open folder in VS Code and trigger AI assistant
     */
    async openProjectInVSCode(folderPath) {
        try {
            // Step 1: Open folder in VS Code
            console.log(`Opening ${folderPath} in VS Code...`);
            const openResult = await this.openInVSCode(folderPath);

            if (!openResult.success) {
                return openResult;
            }

            // Step 2: Trigger AI assistant
            console.log('Triggering VS Code AI assistant...');
            const aiResult = await this.triggerVSCodeAI();

            return {
                success: true,
                message: `Opened project in VS Code and triggered AI assistant`
            };
        } catch (error) {
            console.error('Failed to open project in VS Code:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = EnhancedAutomationService;
