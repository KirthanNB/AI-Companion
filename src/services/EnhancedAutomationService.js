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
        // Configure mouse for smooth human-like movement
        mouse.config.autoDelayMs = 100; // Slight delay for stability
        mouse.config.mouseSpeed = 1500; // Pixels per second
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
    async type(text, delayMs = 50) {
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
            await keyboard.type(mainKey);
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
     * Launch an application
     */
    async launchApp(appName) {
        // Try Windows search approach
        await this.pressKey('win');
        await new Promise(r => setTimeout(r, 500));
        await this.type(appName);
        await new Promise(r => setTimeout(r, 500));
        await this.pressKey('enter');
        await new Promise(r => setTimeout(r, 1500)); // Wait for app to launch
    }

    /**
     * Open Windows Run dialog and execute command
     */
    async runCommand(command) {
        await this.pressKey('win+r');
        await new Promise(r => setTimeout(r, 400));
        await this.type(command);
        await new Promise(r => setTimeout(r, 200));
        await this.pressKey('enter');
    }
}

module.exports = EnhancedAutomationService;
