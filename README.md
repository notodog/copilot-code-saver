# Copilot Code Saver

A Chrome/Chromium browser extension that saves code blocks from AI assistants (like Microsoft Copilot Studio) directly to your project files — no more copy-paste hell.

## 🎯 Problem Solved

When using web-based AI coding assistants without API access, developers face a tedious workflow:
1. Copy code from browser
2. Switch to terminal/editor
3. Paste and save to file
4. Repeat dozens of times per session

**Copilot Code Saver** adds a "Save" button to every code block, letting you save directly to your project directory with smart filename detection.

## ✨ Features

- **One-click save** — Save button on every code block
- **Smart filename detection** — Automatically detects filenames from context, comments, and code structure
- **Multi-project support** — Configure projects in the extension popup
- **Direct filesystem writes** — Files go straight to your project (not Downloads)
- **Language detection** — Auto-detects file extension from code highlighting
- **Path memory** — Remembers last used directory per project
- **Confidence indicators** — Shows how confident the detection is (high/medium/low)
- **Export/Import config** — Backup and restore your project configuration
- **Cross-device sync** — Projects stored in Chrome sync storage

## 🧠 Smart Filename Detection

The extension uses multiple strategies to detect the correct filename, in priority order:

| Priority | Strategy | Example |
|----------|----------|---------|
| 1 | **Code block header** | UI elements showing filename above code |
| 2 | **Conversation context** | "save this as `utils.rs`", "update your `config.toml`" |
| 3 | **First-line comment** | `// src/utils.rs` or `# filename: app.py` |
| 4 | **Code structure** | `fn main()` → `main.rs`, `[package]` → `Cargo.toml` |
| 5 | **Markdown headers** | `### utils.rs` or `**config.toml**` |
| 6 | **Smart extraction** | Extracts function/class names from code |
| 7 | **Fallback** | `snippet-{timestamp}.{ext}` |

### Code Structure Recognition

| Pattern | Detected Filename |
|---------|-------------------|
| `fn main()` (Rust) | `main.rs` |
| `if __name__ == "__main__"` (Python) | `main.py` |
| `package main` (Go) | `main.go` |
| `[package]` (TOML) | `Cargo.toml` |
| `{"name":..., "version":...}` (JSON) | `package.json` |
| `{"compilerOptions":...}` (JSON) | `tsconfig.json` |
| `<!DOCTYPE html>` | `index.html` |
| `FROM ...` (Dockerfile) | `Dockerfile` |
| `export default function Button` | `Button.jsx` |
| `class UserController` | `user_controller.py` |
| `pub struct MyStruct` | `my_struct.rs` |

### Path Memory

The extension remembers your last used directory for each project. If you save a file to `src/components/Button.jsx`, the next save will default to `src/components/`.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER EXTENSION                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ content.js  │  │background.js│  │ popup.html/js           │  │
│  │             │  │             │  │ (Project Management)    │  │
│  │ - Injects   │  │ - Bridges   │  │                         │  │
│  │   save btn  │  │   content ↔ │  │ - Add/Edit/Delete       │  │
│  │ - Smart     │  │   native    │  │   projects              │  │
│  │   filename  │  │   host      │  │ - Set default project   │  │
│  │   detection │  │             │  │ - Export/Import config  │  │
│  │ - Shows     │  │             │  │                         │  │
│  │   modal     │  │             │  │                         │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘  │
│         │                │                                      │
│         │ chrome.storage │                                      │
│         │ (projects +    │                                      │
│         │  recent paths) │                                      │
└─────────┼────────────────┼──────────────────────────────────────┘
          │                │
          │   Chrome       │  Native Messaging
          │   Runtime      │  (stdio)
          │   Messages     │
          │                ▼
          │  ┌─────────────────────────────────────────────────────┐
          │  │              NATIVE HOST (Rust)                     │
          │  │  - Stateless file writer                            │
          │  │  - Receives { path, content }                       │
          │  │  - Writes file to filesystem                        │
          │  │  - Returns success/error                            │
          │  └─────────────────────────────────────────────────────┘
          │                │
          │                ▼
          │  ┌─────────────────────────────────────────────────────┐
          │  │              FILESYSTEM                             │
          │  │  ~/prj/my-app/src/utils.rs                          │
          │  │  ~/.dotfiles/config.toml                            │
          │  │  ~/bin/script.sh                                    │
          │  └─────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Aspect | Description |
|--------|-------------|
| **Project config in extension** | Stored in `chrome.storage.sync`, not filesystem. Works regardless of sandbox restrictions. |
| **Stateless native host** | Only handles file I/O. Receives absolute paths, no config parsing needed. |
| **Path resolution in extension** | Extension joins project root + relative path before sending to native host. |
| **Smart detection** | Multiple strategies with confidence scoring to minimize manual input. |

## 📁 Project Structure

```
copilot-code-saver/
├── extension/
│   ├── manifest.json      # Extension manifest (Manifest V3)
│   ├── content.js         # Injected into Copilot pages (smart detection)
│   ├── background.js      # Service worker for native messaging
│   ├── popup.html         # Project management UI
│   ├── popup.js           # Project CRUD logic
│   └── styles.css         # Modal styles
│
├── native-host/
│   ├── Cargo.toml         # Rust dependencies
│   ├── src/
│   │   └── main.rs        # Native messaging host (file writer)
│   └── install.sh         # Installation script
│
└── README.md
```

## 🚀 Installation

### Prerequisites

- **Rust** (for building native host): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Google Chrome** or **Chromium** (non-snap version — see [Known Issues](#-known-issues))

### Step 1: Clone Repository

```bash
git clone https://github.com/yourusername/copilot-code-saver.git
cd copilot-code-saver
```

### Step 2: Build Native Host

```bash
cd native-host

# Build release binary
cargo build --release

# Install binary
mkdir -p ~/bin
cp target/release/ccs-host ~/bin/
chmod +x ~/bin/ccs-host
```

### Step 3: Register Native Messaging Host

```bash
# Create manifest directory
mkdir -p ~/.config/google-chrome/NativeMessagingHosts
# Or for Chromium:
# mkdir -p ~/.config/chromium/NativeMessagingHosts

# Create manifest file
cat > ~/.config/google-chrome/NativeMessagingHosts/com.ccs.host.json << EOF
{
  "name": "com.ccs.host",
  "description": "Copilot Code Saver native host",
  "path": "$HOME/bin/ccs-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
EOF
```

> **Note:** Replace `YOUR_EXTENSION_ID` with the actual extension ID after loading (Step 4).

### Step 4: Load Extension

1. Open Chrome/Chromium
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `extension/` folder
6. **Copy the Extension ID** and update the native messaging manifest (Step 3)

### Step 5: Configure Projects

1. Click the extension icon in the toolbar
2. Click "+ Add" to add a project
3. Enter project name and absolute root path
4. Click "Save Project"

## 📖 Usage

1. Go to [Microsoft Copilot Studio](https://copilotstudio.microsoft.com/)
2. Chat with your AI assistant to generate code
3. Hover over any code block — a save button (↓) appears in the bottom-right
4. Click the save button
5. The filename is auto-detected — edit if needed, then click Save
6. File is written directly to your project!

### Tips for Better Detection

To help the extension detect filenames more accurately:

1. **Ask the AI to include the filename** — "Create a file called `utils.rs`"
2. **Use backticks around filenames** — The extension looks for `` `filename.ext` ``
3. **Add a comment at the top** — `// src/utils.rs` or `# filename: app.py`
4. **Use standard patterns** — `fn main()` will auto-detect as `main.rs`

## 🔧 Configuration

### Project Management

All project configuration is done through the extension popup:

| Action | How |
|--------|-----|
| Add project | Click "+ Add", fill form, click "Save Project" |
| Edit project | Click ✏️ on any project |
| Delete project | Click 🗑️ on any project |
| Set default | Click ⭐ on any project |
| Export config | Click "Export" in footer — downloads JSON |
| Import config | Click "Import" in footer — select JSON file |

### Supported AI Chat Sites

Edit `extension/manifest.json` to add more sites:

```json
"content_scripts": [
  {
    "matches": [
      "https://copilotstudio.microsoft.com/*",
      "https://*.powerva.microsoft.com/*",
      "https://chat.openai.com/*",
      "https://claude.ai/*"
    ],
    ...
  }
]
```

After editing, reload the extension in `chrome://extensions/`.

## ⚠️ Known Issues

### Snap Chromium Does Not Support Native Messaging

**Problem:** Native messaging doesn't work in browsers installed as snap packages (Ubuntu's default Chromium). The snap sandbox prevents execution of external binaries.

**Error:** `"Specified native messaging host not found"`

**Solution:** Install Google Chrome or Chromium from a non-snap source:

```bash
# Option 1: Google Chrome .deb
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt --fix-broken install

# Option 2: Chromium from PPA
sudo add-apt-repository ppa:saiarcot895/chromium-dev
sudo apt update
sudo apt install chromium-browser
```

| Browser Install Method | Native Messaging |
|------------------------|------------------|
| Chromium snap          | ❌ Blocked       |
| Google Chrome .deb     | ✅ Works         |
| Chromium PPA           | ✅ Works         |
| Firefox snap           | ❌ Blocked       |
| Firefox .deb           | ✅ Works         |

## 🧪 Testing

### Test Native Host Directly

```bash
# Test ping
echo '{"action":"ping"}' | ~/bin/ccs-host

# Test save (manual)
cat > /tmp/test-save.py << 'EOF'
import subprocess
import struct
import json

msg = {"action": "save", "path": "/tmp/test-ccs.txt", "content": "Hello from CCS!"}
encoded = json.dumps(msg).encode('utf-8')

proc = subprocess.Popen(
    ['ccs-host'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE
)

# Write length + message
proc.stdin.write(struct.pack('I', len(encoded)))
proc.stdin.write(encoded)
proc.stdin.flush()

# Read response
length = struct.unpack('I', proc.stdout.read(4))[0]
response = json.loads(proc.stdout.read(length))
print(response)
EOF

python3 /tmp/test-save.py
cat /tmp/test-ccs.txt
```

### Test Extension

1. Open DevTools on a Copilot Studio page (F12)
2. Check Console for `[Copilot Code Saver] Loaded v0.4.0`
3. Check extension popup for "Native host connected" status
4. Try saving a code block — verify filename detection works

## 🔄 Migration from v0.3.x

If you're upgrading from v0.3.x (which used `projects.toml`):

1. **Rebuild native host** — The new version is simpler and has fewer dependencies
2. **Add projects via popup** — Projects are now stored in Chrome, not a config file
3. **Optional: Import old config** — Manually recreate projects in the popup, or create a JSON file:

```json
{
  "version": "0.4.0",
  "defaultProject": "my-app",
  "projects": [
    { "id": "my-app", "name": "My Application", "root": "/home/user/prj/my-app" },
    { "id": "dotfiles", "name": "Dotfiles", "root": "/home/user/.dotfiles" }
  ]
}
```

Then use "Import" in the extension popup.

## 🚧 Future Enhancements

- [ ] Keyboard shortcuts (Ctrl+Shift+S)
- [ ] "Open in editor" after save (configurable command)
- [ ] File tree browser in modal
- [ ] Git integration (branch awareness)
- [ ] Support more AI chat platforms
- [ ] Publish to Chrome Web Store
- [ ] Learn from user corrections (ML-based filename prediction)

## 📄 License

MIT

## 🙏 Credits

Built during a pair-programming session with AI assistance, solving the real problem of "copy-paste hell" when using web-based AI coding assistants without API access.
