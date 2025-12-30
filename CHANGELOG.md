# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2025-12-30

### Added
- **Smart Model Selection**: Automatically detects and selects the best available Gemini model (Flash, Pro, or Preview) based on your API key permissions.
- **Enhanced Settings**: Added "Show/Hide" toggle for API keys and pre-fills existing keys for easier editing.

### Fixed
- **API Quota Errors**: Resolved 404/429 errors by dynamically switching to compatible models (e.g., `gemini-3-flash-preview`).
- **Error Visibility**: Cleaned up the UI so the character only says "Error Detected", while full technical logs are sent to the terminal.
- **Dev/Prod Isolation**: Fixed "Auto-Login" issues by separating development storage (`-dev`) from production storage.

## [1.0.1] - 2025-12-30

### Fixed
- **Windows Build**: Streamlined build process for Windows-only releases.

## [1.0.0] - 2025-12-30

### Added
- **Core AI**: Integrated Google Gemini 2.0 Flash for high-speed conversational intelligence.
- **Voice**: Integrated ElevenLabs TTS for realistic voice synthesis.
- **Vision**: Added screen capture and analysis capabilities.
- **Automation**: Implemented hybrid desktop automation (mouse, keyboard, shell execution).
- **Project Scaffolding**: Added voice-controlled generation of React, Node, and Python projects.
- **UI/UX**: Created interactive "floating" desktop interface with PixiJS character.
- **Browser Control**: Integrated Playwright for web automation tasks.

### Fixed
- Stabilized voice interruption handling.
- Optimized Gemini token usage with history pruning.
- Fixed microphone button responsiveness issues.

### Security
- Implemented .env configuration for secure API key management.
