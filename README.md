# 🤖 AI Desktop Companion

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)
![Status](https://img.shields.io/badge/status-Stable-success.svg)

**Your intelligent, proactive, and charming desktop assistant.**

AI Desktop Companion is not just a chatbot; it's a fully autonomous agent that lives on your desktop. Powered by **Google Gemini** and **ElevenLabs**, it can see your screen, control your mouse, write code, automate workflows, and chat with a distinct personality.

---

## ✨ Features

### 🧠 Advanced Intelligence
- **Natural Conversation**: Chat naturally with a witty, helpful personality using Gemini 2.0 Flash.
- **Voice Interaction**: High-quality, low-latency text-to-speech via ElevenLabs.
- **Context Awareness**: Remembers your recent interactions and context.

### 👁️ Computer Vision
- **Screen Understanding**: "See" what's on your screen and ask questions about it.
- **Visual Automation**: Click buttons, find icons, and interact with UI elements visually.

### 🤖 Autonomous Agent
- **Desktop Control**: Move mouse, click, type, and launch applications.
- **Project Scaffolding**: Create entire coding projects (React, Python, Node) with a single voice command.
- **Browser Automation**: Open websites, search the web, and extract information.

### 🎨 Customizable & Fun
- **Interactive Character**: A charming robot avatar that reacts to clicks and events.
- **Voice Customization**: Choose from different ElevenLabs voices.
- **Personality Tuning**: Adjust the system prompt to change how the AI behaves.

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- **Google Gemini API Key** ([Get it here](https://aistudio.google.com/app/apikey))
- **ElevenLabs API Key** ([Get it here](https://elevenlabs.io/))

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/KirthanNB/AI-Companion.git
    cd AI-Companion
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Create a `.env` file in the root directory (copy `.env.example`):
    ```env
    GOOGLE_API_KEY=your_gemini_key
    ELEVEN_API_KEY=your_elevenlabs_key
    ELEVEN_VOICE_ID=your_voice_id
    ```

4.  **Run the application**
    ```bash
    npm start
    ```

---

## 📖 User Manual

### 🎮 Controls
| Icon | Name | Description |
| :---: | :--- | :--- |
| 🎤 | **Mic** | Click to speak to the AI. |
| 🤖 | **Agent Mode** | Toggle autonomous mode for complex tasks. |
| 🛑 | **Stop** | Emergency stop for any active automation. |

### 🗣️ Voice Commands
- **"Create a portfolio website"** -> Generates a project folder and opens VS Code.
- **"What is on my screen?"** -> Analyzes the current window content.
- **"Open YouTube and search for lofi beats"** -> Automates the browser.
- **"Type a python script to calculate fibonacci"** -> Tyupes code into your active editor.

---

## 🛠️ Development

### Project Structure
```
ai-companion/
├── src/
│   ├── ai/                 # AI logic & GameAgent
│   ├── services/           # Automation & helper services
│   ├── renderer.js         # Frontend logic (PixiJS)
│   └── main.js             # Electron main process
├── assets/                 # Images & sounds
└── package.json            # Dependencies & scripts
```

### Building for Production
To create an installer for your OS:

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started.

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Made with ❤️ by [Your Name]
</p>
