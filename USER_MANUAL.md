# 🤖 AI Desktop Companion - User Manual

Congratulations! You have successfully built a fully functional AI Desktop Companion. Here is everything you need to know about using it.

## 🚀 How to Run
1. Open your terminal in `D:\AI-Companion`.
2. Run the start command:
   ```bash
   npm start
   ```
3. The companion will appear as a floating overlay on your desktop.

## 🎮 Controls & Modes
There are two main ways to use the AI, depending on what you want:

| Mode | Button | Best For... | Capabilities |
| :--- | :---: | :--- | :--- |
| **Voice Assistant** | 🎤 (Mic) | **Chatting** | Q&A, Jokes, Google Search, General Help. (Passive) |
| **Desktop Agent** | 🤖 (Robot) | **Doing** | Moving Mouse, Typing Code, Opening Apps, Complex Workflows. (Active) |

### 🎤 Voice Conversation
- **Click the Microphone Button** (bottom center) to start listening.
- **Speak naturally**. The listening indicator will wave 🌊.
- The companion will think 🤔 and then reply with **Voice** and a **Text Bubble**.

### 🖱️ Mouse Interaction
- **Click Through**: You can click on your desktop icons/wallpaper *through* the empty parts of the window.
- **Click Character**: Click the robot 🤖 to make it jump/interact.
- **Hover UI**: Hover over the bottom controls or top header to make them clickable.

## 🧠 Capabilities

### 1. Chat (Gemini 2.5 Flash)
Ask general questions, tell jokes, or just chat. The personality is set to be "witty and helpful".
> "Tell me a joke."
> "Who are you?"

### 2. Vision (Screen Capture) 👁️
Ask the companion to look at your screen.
> "What is on my screen?"
> "Do you see this image?"
> "Help me with this code on my screen."

### 3. Browser Automation 🌐
Ask the companion to open websites or search the web.
> "Open YouTube."
> "Search for weather in Tokyo."
> "Open Google."
*(A separate browser window will open to perform these tasks)*

### 4. Hybrid Desktop Agent (Visual + Shell) 🤖
The **Robot Icon** activates the autonomous desktop agent.

**Capabilities:**
- **Launch Apps**: "Open Notepad", "Start Calculator" (Uses standard system commands).
- **Type Text**: "Type 'Hello World'", "Write a python script".
- **Visual Interaction**: "Click the search bar", "Click the 'Send' button" (Uses AI Vision).

**Example Test Scenarios:**

**Scenario A: The Writer**
1. Click **Robot Icon**.
2. Type: `Open Notepad and type "This is an AI test".`
3. Click **Start**.
   *(Expectation: Notepad opens instantly, then text appears)*

**Scenario B: The Surfer**
1. Click **Robot Icon**.
2. Type: `Open Chrome and go to google.com`
   *(Expectation: Chrome launches to Google)*

**Scenario C: Visual Click**
1. Open Calculator manually.
2. Click **Robot Icon**.
3. Type: `Click the number 7`
   *(Expectation: AI sees the '7' button and moves mouse to click it)*

### 5. Advanced Real-World Scenarios 🌟
These scenarios combine multiple skills (launching, seeing, typing) to solve complex tasks.

**Scenario D: The Automated Coder 👨‍💻**
*   **Instruction:** `Open VS Code and write a python script to calculate fibonacci numbers.`
*   **What happens:**
    1.  **Hybrid**: AI runs `code` (or `start code`) to launch VS Code.
    2.  **Visual**: AI sees the "New File" or editor area.
    3.  **Hybrid**: AI generates the Python code internally and types it out at high speed.
    4.  **Result**: You have a working script written before your eyes.

**Scenario E: The DJ 🎵**
*   **Instruction:** `Open Spotify and search for 'lofi beats'.`
*   **What happens:**
    1.  **Hybrid**: AI runs `start spotify` (if installed).
    2.  **Visual**: AI waits for load, identifies the Search bar.
    3.  **Action**: AI clicks search, types "lofi beats", and presses Enter.
    4.  **Visual**: AI sees the "Play" button on the first result and clicks it.

**Scenario F: The Knowledge Keeper 📚**
*   **Instruction:** `Open Notepad and write a summary of the history of the internet.`
*   **What happens:**
    1.  **Hybrid**: launches Notepad.
    2.  **Thinking**: AI uses its internal LLM knowledge to write the essay.
    3.  **Action**: AI types the entire summary into the document for you.

### 6. Efficiency & Logic 🧠
The agent is designed to be smart about its resources:
- **Auto-Stop**: When a task is finished (e.g., "Notepad is open"), the AI will automatically stop itself to save API credits.
- **Hybrid Speed**: It prefers "System Commands" (instant) over "Visual Searching" (slow) whenever possible.
- **Safety**: You can always click the **Red Stop Button** visually or voice-command it to stop.

## 🛠️ Customization
- **Character**: Edit `initPixi()` in `src/renderer.js` to change the robot's colors or shape.
- **Voice**: Change `ELEVEN_MODEL` or `voiceId` in `src/renderer.js`.
- **System Prompt**: Edit the `systemPrompt` variable in `processUserMessage` in `src/renderer.js` to change its personality.

## ⚠️ Troubleshooting
- **Mic not working?** Ensure your default system microphone is set.
- **Vision not working?** Sometimes screen capture requires system permissions (on Mac specifically, but on Windows usually fine).
- **Browser error?** Ensure you ran `npm install playwright`.

Enjoy your new AI friend! 🤖✨
