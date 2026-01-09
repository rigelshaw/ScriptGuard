# ScriptGuard - Chrome Extension

A Manifest V3 extension that guards against unwanted scripts by controlling network, storage, cookies, and DOM modifications.

## Features
- Per-domain policies for network, storage, cookies, and DOM
- Real-time monitoring and logging
- Temporary "Allow once" functionality
- Clean popup UI and full options dashboard
- Working demo with local server

## Quick Start

### 1. Install the extension
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `scriptguard/` folder

### 2. Run the demo server
```bash
python3 demo/server.py