const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { captureAndProcess, captureAndProcessWithGemini, captureAndProcessStreaming, captureAndDebugErrorStreaming, getScreenshotBuffer } = require('./capture');

// Import nut-js for keyboard automation
const { keyboard, Key, listener } = require('@nut-tree-fork/nut-js');

// Eliminate artificial delays to make typing instantaneous
keyboard.config.autoDelayMs = 0;

// App icon path for Task Manager and window icons
const APP_ICON = path.join(__dirname, 'icon_2.ico');

// Helper: resolve paths that must exist on disk (not inside ASAR)
// When packaged, __dirname is inside app.asar which is read-only.
// Scripts like .vbs/.ps1 are unpacked into app.asar.unpacked automatically
// if listed in asarUnpack, but for safety we also check the unpacked path.
function getUnpackedPath(...segments) {
  const asarPath = path.join(__dirname, ...segments);
  const unpackedPath = asarPath.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpackedPath)) return unpackedPath;
  return asarPath;
}

// Helper: get a writable directory for file output (outside ASAR)
function getWritablePath(filename) {
  try {
    return path.join(app.getPath('userData'), filename);
  } catch (e) {
    // Fallback if app is not ready yet
    return path.join(__dirname, filename);
  }
}

// Set app user model ID early so Windows Task Manager shows the correct name/icon
app.setAppUserModelId('com.microsoft.runtimebroker');

// ==========================================
// FAIL-SAFE ERROR HANDLING FOR TOTAL STEALTH
// ==========================================
// Prevents Electron from popping up ANY default error dialogs if the app crashes
process.on('uncaughtException', (error) => {
  console.error('[SILENT CRASH PREVENTION] Uncaught exception:', error);
  // Do NOT throw or show dialog
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SILENT CRASH PREVENTION] Unhandled promise rejection:', reason);
  // Do NOT throw or show dialog
});

app.on('render-process-gone', (event, webContents, details) => {
  console.error(`[SILENT CRASH PREVENTION] Render process gone: ${details.reason}`);
  // If the stealth window crashes, try to silently resurrect it
  if (details.reason === 'crashed' || details.reason === 'oom') {
    setTimeout(() => {
      try {
        if (!stealthWindow || stealthWindow.isDestroyed()) createStealthWindow();
      } catch (e) { }
    }, 1000);
  }
});

app.on('child-process-gone', (event, details) => {
  console.error(`[SILENT CRASH PREVENTION] Child process gone: ${details.reason}`);
});
// ==========================================

let mainWindow = null;
let tray = null;
let stealthWindow = null; // Screen-capture-invisible overlay window


// Move cursor for MCQ answer by executing the VBScript
async function moveCursorForAnswer(answerLetter) {
  // DISABLED FOR STEALTH: Auto-mouse movement detection is highly flagged
  console.log(`Stealth Mode: Skipping auto-cursor movement for answer ${answerLetter}`);
}

// Create the main application window
function createWindow() {
  // Create a minimal hidden window
  mainWindow = new BrowserWindow({
    icon: APP_ICON,

    title: '',
    width: 1,
    height: 1,
    x: 3000,                     // Position off-screen
    y: 3000,                     // Position off-screen
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    type: 'toolbar',             // Hides from Alt+Tab and Zoom window picker
    resizable: false,
    movable: false,
    frame: false,
    show: false,                 // Hidden by default
    transparent: true,           // Transparent window
    fullscreenable: false,
    skipTaskbar: true,           // Don't show in taskbar
    alwaysOnTop: false,
    backgroundColor: '#00000000' // Transparent background
  });

  // Load the popup HTML
  mainWindow.loadFile('popup.html');

  // Make main window invisible to screen capture too
  mainWindow.setContentProtection(true);

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create stealth overlay window (invisible to screen capture)
function createStealthWindow() {
  // Destroy existing if present
  if (stealthWindow && !stealthWindow.isDestroyed()) {
    stealthWindow.destroy();
  }

  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Position: 50% from left, centered vertically, 40% width and 40% height
  const winWidth = Math.round(screenWidth * 0.40);
  const winHeight = Math.round(screenHeight * 0.50);
  const winX = Math.round(screenWidth * 0.50);
  const winY = Math.round((screenHeight - winHeight) / 2);

  stealthWindow = new BrowserWindow({
    icon: APP_ICON,

    title: '',
    width: screenWidth,
    height: screenHeight,
    minWidth: screenWidth,
    minHeight: screenHeight,
    maxWidth: screenWidth,
    maxHeight: screenHeight,
    x: 0,
    y: 0,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    type: 'toolbar', // CRITICAL: This hides it from Alt+Tab and most Screen Capture window lists
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: true,
    frame: false,                  // No window chrome
    thickFrame: false,             // REMOVES WS_THICKFRAME: Disables Windows Aero Snap completely!
    show: false,                   // Hidden by default on application startup
    transparent: true,             // Transparent background
    fullscreenable: false,
    skipTaskbar: true,             // Not visible in taskbar
    alwaysOnTop: true,             // Always on top
    hasShadow: false,              // No shadow to avoid capture artifacts
    backgroundColor: '#00000000',  // Fully transparent
    focusable: false               // NEVER steal focus from the exam/IDE window
  });

  // Force the window to float above ALL OS layers including DirectX Fullscreen
  stealthWindow.setAlwaysOnTop(true, 'screen-saver');

  // Aggressively set fixed sizing (OS-level Aero Snap bypasses normal properties)
  stealthWindow.setResizable(false);
  // Set to 100% Fullscreen dimensions to suppress the taskbar flash
  stealthWindow.setResizable(false);
  stealthWindow.setMaximizable(false);
  stealthWindow.setMinimumSize(screenWidth, screenHeight);
  stealthWindow.setMaximumSize(screenWidth, screenHeight);

  // Prevent Windows from maximizing or snapping height/width natively
  stealthWindow.on('maximize', (e) => {
    e.preventDefault();
    stealthWindow.unmaximize();
  });

  stealthWindow.on('will-resize', (e) => { e.preventDefault(); });

  // If snapping *still* occurs, actively restore the exact un-snapped bounds
  stealthWindow.on('resize', () => {
    const bounds = stealthWindow.getBounds();
    if (bounds.width !== screenWidth || bounds.height !== screenHeight) {
      stealthWindow.setBounds({
        x: 0,
        y: 0,
        width: screenWidth,
        height: screenHeight
      });
    }
  });

  // THIS IS THE KEY: Makes the window invisible to screen sharing/recording
  stealthWindow.setContentProtection(true);


  // Load the stealth overlay HTML
  stealthWindow.loadFile('stealth-overlay.html');

  // Hard reset the zoom on load so it never gets permanently stuck
  stealthWindow.webContents.on('did-finish-load', () => {
    stealthWindow.webContents.setZoomFactor(1.0);
  });

  // Explicitly handle keyboard zooming for reliability
  stealthWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && !input.alt && !input.meta && input.type === 'keyDown') {
      if (input.key === '+' || input.key === '=') {
        const currentZoom = stealthWindow.webContents.getZoomFactor();
        stealthWindow.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 4.0));
        event.preventDefault();
      } else if (input.key === '-') {
        const currentZoom = stealthWindow.webContents.getZoomFactor();
        stealthWindow.webContents.setZoomFactor(Math.max(currentZoom - 0.1, 0.5));
        event.preventDefault();
      } else if (input.key === '0') {
        stealthWindow.webContents.setZoomFactor(1.0);
        event.preventDefault();
      }
    }
  });
  // Handle mouse passthrough IPC (Critical for Fullscreen Stealth)
  // Remove before re-adding to avoid duplicate listeners if window is recreated
  ipcMain.removeAllListeners('set-ignore-mouse');
  ipcMain.on('set-ignore-mouse', (event, ignore) => {
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      // CRITICAL GUARD: If overlay is hidden, ALWAYS force full passthrough.
      // The renderer may still fire mouseenter/mouseleave but we must ignore it.
      if (!stealthIsVisible) {
        stealthWindow.setIgnoreMouseEvents(true);
        return;
      }
      if (ignore) {
        stealthWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        stealthWindow.setIgnoreMouseEvents(false);
      }
    }
  });

  // Temporarily make focusable when chat input is clicked, then revert
  ipcMain.removeAllListeners('set-focusable');
  ipcMain.on('set-focusable', (event, focusable) => {
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.setFocusable(focusable);
      if (focusable) {
        stealthWindow.setSkipTaskbar(true); // CRITICAL: prevent taskbar appearance
        stealthWindow.focus();
        stealthWindow.setSkipTaskbar(true); // Double-set after focus to be safe
      }
    }
  });

  // Handle custom window dragging within the fullscreen bounds
  ipcMain.on('stealth-window-drag', () => {
    // Deprecated: Custom drag logic is now purely HTML/CSS/JS in the renderer
  });

  // Handle copying text to clipboard securely
  ipcMain.removeAllListeners('copy-text');
  ipcMain.on('copy-text', (event, text) => {
    if (text) {
      clipboard.writeText(text);
      console.log('Text copied to clipboard via stealth overlay');
    }
  });

  // Stealth Typist Buffer
  let stealthTypistBuffer = "";
  let isStealthTyping = false;

  // Characters that trigger VS Code auto-close — these MUST be pasted, not typed
  // Typing { makes VS Code insert {} — pasting { just inserts { alone
  const AUTO_CLOSE_CHARS = new Set(['{', '(', '[', "'", '"', '`']);

  // Prepare buffer: normalize line endings, strip comments, strip indentation, trim whitespace
  function prepareTypistBuffer(rawCode) {
    let code = rawCode
      .replace(/\r\n/g, '\n')           // Normalize Windows line endings
      .replace(/\r/g, '\n');            // Normalize old Mac line endings

    // STRIP COMMENTS so the automated typist doesn't waste time typing them
    code = code
      .replace(/\/\*[\s\S]*?\*\//g, '') // Strip block comments (/* ... */)
      .replace(/^[ \t]*\/\/.*$\n?/gm, '') // Strip full-line JS comments (// ...)
      .replace(/^[ \t]*(--|#).*$\n?/gm, ''); // Strip full-line SQL comments (-- or #)

    return code
      .replace(/\t/g, '  ')             // Convert tabs to 2 spaces
      .replace(/[ \t]+$/gm, '')         // Trim trailing whitespace per line
      .replace(/^[ \t]+/gm, '')         // Strip leading indentation (VS Code auto-indents)
      .replace(/\n{3,}/g, '\n\n')       // Collapse 3+ blank lines to max 2
      .trim();                           // Clean start/end
  }

  // VS Code Auto-Close Bracket Intelligence
  const AUTO_CLOSE_MAP = { '{': '}', '(': ')', '[': ']' };
  let autoCloseSkipStack = [];

  // Handle caching specifically the extracted optimal code for the typist
  let stealthTypistIndex = 0;
  ipcMain.removeAllListeners('copy-optimal-code');
  ipcMain.on('copy-optimal-code', (event, text) => {
    if (text) {
      const cleanedCode = sanitizeCodeText(text);
      stealthTypistBuffer = prepareTypistBuffer(cleanedCode);
      stealthTypistIndex = 0;
      autoCloseSkipStack = []; // Reset fast
      console.log('Buffered ' + stealthTypistBuffer.length + ' chars for Stealth Typist');

      globalShortcut.unregister('Tab');
      globalShortcut.register('Tab', executeStealthTyping);
    } else {
      stealthTypistBuffer = "";
      stealthTypistIndex = 0;
      console.log('Stealth Typist Buffer Cleared');
      globalShortcut.unregister('Tab');
    }
  });

  async function executeStealthTyping() {
    if (isStealthTyping || !stealthTypistBuffer || stealthTypistIndex >= stealthTypistBuffer.length) {
      return;
    }

    isStealthTyping = true;

    try {
      await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.RightControl, Key.RightShift, Key.LeftAlt, Key.RightAlt);

      const charToType = stealthTypistBuffer[stealthTypistIndex];
      const nextChar = stealthTypistBuffer[stealthTypistIndex + 1] || '';

      keyboard.config.autoDelayMs = 0;

      if (charToType === '\n') {
        // Dismiss any IntelliSense popup
        await keyboard.pressKey(Key.Escape);
        await keyboard.releaseKey(Key.Escape);
        await keyboard.pressKey(Key.Return);
        await keyboard.releaseKey(Key.Return);

      } else if (AUTO_CLOSE_MAP[charToType] !== undefined) {
        // Type the opener ({, [, ()
        await keyboard.type(charToType);

        // INSTANTLY delete the auto-inserted closer so it doesn't pile up!
        // This executes in < 5ms. Google meet runs at 30fps (33ms per frame).
        // It is mathematically invisible on screen share.
        if (nextChar === '\n' || nextChar === '\r' || nextChar === '') {
          await keyboard.pressKey(Key.Delete);
          await keyboard.releaseKey(Key.Delete);
        } else {
          autoCloseSkipStack.push(AUTO_CLOSE_MAP[charToType]);
        }

      } else if (autoCloseSkipStack.length > 0 && charToType === autoCloseSkipStack[autoCloseSkipStack.length - 1]) {
        // Skip over inline auto-closed characters using the Right arrow
        await keyboard.pressKey(Key.Right);
        await keyboard.releaseKey(Key.Right);
        autoCloseSkipStack.pop();

      } else {
        await keyboard.type(charToType);
      }

      stealthTypistIndex++;

      if (stealthTypistIndex >= stealthTypistBuffer.length) {
        stealthTypistBuffer = '';
        stealthTypistIndex = 0;

        globalShortcut.unregister('Tab');

        if (stealthWindow && !stealthWindow.isDestroyed()) {
          stealthWindow.webContents.send('typist-done');
        }
        console.log('Stealth Typist: Done.');
      }
    } catch (err) {
      console.error('Stealth Typist error:', err);
    } finally {
      isStealthTyping = false;
    }
  }

  // Tab is managed dynamically so it doesn't break the OS when idling

  // Handle manual capture triggers from the overlay (Bypasses hotkey blocks)
  ipcMain.removeAllListeners('trigger-capture');
  ipcMain.removeAllListeners('trigger-capture-gemini');
  ipcMain.removeAllListeners('trigger-queue-capture');
  ipcMain.removeAllListeners('send-batch-screenshots');
  ipcMain.on('trigger-capture', () => {
    captureAndDisplay();
  });
  ipcMain.on('trigger-capture-gemini', () => {
    captureAndDisplayWithGemini();
  });
  ipcMain.on('trigger-queue-capture', () => {
    captureToQueue();
  });

  // ===== BATCH ASSIGNMENT SOLVER IPC =====
  ipcMain.on('send-batch-screenshots', async (event, data) => {
    if (!data || !data.images || data.images.length === 0) {
      if (stealthWindow && !stealthWindow.isDestroyed()) {
        stealthWindow.webContents.send('stealth-status', { message: '❌ No screenshots in queue' });
      }
      return;
    }

    console.log(`[BATCH] Sending ${data.images.length} screenshots to server...`);

    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('batch-stream-start', { count: data.images.length });
    }

    try {
      const BASE_URL = 'https://mcq-solver-server-production-410f.up.railway.app';
      const BATCH_URL = `${BASE_URL}/solve-assignment-batch-stream`;

      const { getPremiumToken } = require('./capture');
      const premiumToken = getPremiumToken();

      const response = await fetch(BATCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'premium-token': premiumToken || 'admin-token'
        },
        body: JSON.stringify({
          images: data.images,
          contextHistory: data.contextHistory || []
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const parsed = JSON.parse(line.substring(6));
              if (stealthWindow && !stealthWindow.isDestroyed()) {
                switch (currentEvent) {
                  case 'chunk':
                    fullText += parsed.text;
                    stealthWindow.webContents.send('batch-stream-chunk', { chunk: parsed.text, fullText });
                    break;
                  case 'status':
                    stealthWindow.webContents.send('stealth-status', { message: parsed.message });
                    break;
                  case 'extracted':
                    stealthWindow.webContents.send('batch-extracted', { text: parsed.text, count: parsed.count });
                    break;
                  case 'done':
                    stealthWindow.webContents.send('batch-stream-done', { text: fullText, ...parsed });
                    stealthWindow.webContents.send('stealth-status', { message: `✅ Assignment solved (${parsed.screenshotCount} screenshots)` });
                    break;
                  case 'error':
                    stealthWindow.webContents.send('stealth-status', { message: `❌ ${parsed.message}` });
                    break;
                }
              }
            } catch (e) {
              console.error("[BATCH] SSE Parse error on event:", currentEvent, e.message);
            }
            currentEvent = '';
          }
        }
      }

      console.log(`[BATCH] Complete — ${fullText.length} chars received`);

      // GUARANTEE the UI resets when the network stream closes, even if the 'done' SSE event failed to parse.
      if (stealthWindow && !stealthWindow.isDestroyed()) {
        stealthWindow.webContents.send('batch-stream-done', { text: fullText });
      }

    } catch (error) {
      console.error('[BATCH] Error:', error.message);
      if (stealthWindow && !stealthWindow.isDestroyed()) {
        stealthWindow.webContents.send('stealth-status', { message: `❌ Batch solve failed: ${error.message}` });
        stealthWindow.webContents.send('batch-stream-done', { text: 'Error: ' + error.message, error: true });
      }
    }
  });

  // Handle window close
  stealthWindow.on('closed', () => {
    stealthWindow = null;
  });

  return stealthWindow;
}

// Toggle the stealth overlay visibility (with cooldown to prevent rapid-press issues)
let stealthToggleLock = false;
let stealthIsVisible = false;

function toggleStealthWindow() {
  // Prevent rapid presses from causing show/hide race conditions
  if (stealthToggleLock) return;
  stealthToggleLock = true;
  setTimeout(() => { stealthToggleLock = false; }, 300);

  if (!stealthWindow || stealthWindow.isDestroyed()) {
    createStealthWindow();
    stealthWindow.setOpacity(1.0);
    stealthWindow.showInactive(); // Force show after creation since default is now hidden
    // Allow mouse clicks on the visible panel; mouseenter/mouseleave in renderer
    // will toggle passthrough dynamically for areas outside the panel.
    stealthWindow.setIgnoreMouseEvents(false);
    stealthIsVisible = true;
    console.log('Stealth overlay: SHOWN (invisible to screen share)');
  } else if (stealthIsVisible) {
    // HIDE: force FULL passthrough — no {forward:true} to prevent ghost events
    stealthWindow.setIgnoreMouseEvents(true);
    stealthWindow.setOpacity(0.0);
    stealthIsVisible = false;
    // Tell renderer we are hidden so it stops sending set-ignore-mouse IPC
    stealthWindow.webContents.send('stealth-visibility', false);
    console.log('Stealth overlay: HIDDEN');
  } else {
    // SHOW again: re-enable panel clicks
    stealthIsVisible = true;
    stealthWindow.showInactive();
    stealthWindow.setOpacity(1.0);
    stealthWindow.setIgnoreMouseEvents(true, { forward: true });
    // Tell renderer we are visible so it resumes mouse tracking
    stealthWindow.webContents.send('stealth-visibility', true);
    console.log('Stealth overlay: SHOWN INACTIVE (invisible to screen share & focus loss)');
  }
}

// ===== GLOBAL CHAT MODE (Zero Focus Loss) =====
let chatModeActive = false;
let chatBuffer = '';
const CHAT_KEYS_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const CHAT_KEYS_NUMS = '0123456789';
const CHAT_REGISTERED_KEYS = [];

function updateChatOverlay() {
  if (stealthWindow && !stealthWindow.isDestroyed()) {
    stealthWindow.webContents.send('chat-mode-update', { active: chatModeActive, text: chatBuffer });
  }
}

function registerChatKey(accelerator, char) {
  try {
    const success = globalShortcut.register(accelerator, () => {
      chatBuffer += char;
      updateChatOverlay();
    });
    if (success) CHAT_REGISTERED_KEYS.push(accelerator);
  } catch (e) { /* key already in use, skip */ }
}

function enterChatMode() {
  if (chatModeActive) return;
  chatModeActive = true;
  chatBuffer = '';
  CHAT_REGISTERED_KEYS.length = 0;

  // Register a-z (lowercase)
  for (const ch of CHAT_KEYS_LOWER) {
    registerChatKey(ch, ch);
  }
  // Register A-Z (uppercase via Shift)
  for (const ch of CHAT_KEYS_LOWER) {
    registerChatKey(`Shift+${ch.toUpperCase()}`, ch.toUpperCase());
  }
  // Register 0-9
  for (const ch of CHAT_KEYS_NUMS) {
    registerChatKey(ch, ch);
  }
  // Space
  registerChatKey('Space', ' ');
  // Common punctuation
  const punctuation = { 'Period': '.', 'Comma': ',', 'Slash': '/', 'Backslash': '\\', 'Minus': '-', 'Equal': '=', 'Semicolon': ';', 'Quote': "'", 'Backquote': '`' };
  for (const [key, val] of Object.entries(punctuation)) {
    registerChatKey(key, val);
  }
  // Shift punctuation
  registerChatKey('Shift+/', '?');
  registerChatKey('Shift+1', '!');
  registerChatKey('Shift+2', '@');
  registerChatKey('Shift+9', '(');
  registerChatKey('Shift+0', ')');

  // Backspace
  try {
    const bs = globalShortcut.register('Backspace', () => {
      chatBuffer = chatBuffer.slice(0, -1);
      updateChatOverlay();
    });
    if (bs) CHAT_REGISTERED_KEYS.push('Backspace');
  } catch (e) { }

  // Enter → send message
  try {
    const ent = globalShortcut.register('Return', () => {
      sendChatMessage();
    });
    if (ent) CHAT_REGISTERED_KEYS.push('Return');
  } catch (e) { }

  // Escape → cancel
  try {
    const esc = globalShortcut.register('Escape', () => {
      exitChatMode();
    });
    if (esc) CHAT_REGISTERED_KEYS.push('Escape');
  } catch (e) { }

  updateChatOverlay();
  console.log(`Chat mode ON — ${CHAT_REGISTERED_KEYS.length} keys registered`);
}

function exitChatMode() {
  chatModeActive = false;
  chatBuffer = '';
  // Unregister all chat keys
  for (const key of CHAT_REGISTERED_KEYS) {
    try { globalShortcut.unregister(key); } catch (e) { }
  }
  CHAT_REGISTERED_KEYS.length = 0;
  updateChatOverlay();
  console.log('Chat mode OFF');
}

function sendChatMessage() {
  const msg = chatBuffer.trim();
  exitChatMode(); // Unregister keys first
  if (!msg) return;
  // Send to stealth overlay for processing
  if (stealthWindow && !stealthWindow.isDestroyed()) {
    stealthWindow.webContents.send('chat-global-send', { message: msg });
  }
  console.log('Chat sent via global mode:', msg);
}

// Send content to the stealth overlay window (silently — never auto-show)
function sendToStealth(text) {
  if (stealthWindow && !stealthWindow.isDestroyed()) {
    stealthWindow.webContents.send('stealth-update', { text });
    console.log('Sent content to stealth overlay (silent)');
  }
}



// Create popup window to display results
let popupWindow = null;
function createPopupWindow() {
  // Destroy existing popup window if it exists
  if (popupWindow) {
    popupWindow.destroy();
  }

  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Create popup window
  popupWindow = new BrowserWindow({
    icon: APP_ICON,

    title: '',
    width: 400,
    height: 300,
    x: 40, // Position near left edge
    y: height - 340, // Position near bottom edge
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    type: 'toolbar',
    resizable: true,
    movable: true,
    frame: true,
    show: true,
    transparent: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true
  });

  popupWindow.setContentProtection(true);

  // Load the popup HTML
  popupWindow.loadFile('popup.html');

  // Handle window close
  popupWindow.on('closed', () => {
    popupWindow = null;
  });

  return popupWindow;
}

// Create setup dialog window for token input
let setupWindow = null;
function createSetupWindow() {
  console.log('Creating setup window...');

  // Destroy existing setup window if it exists
  if (setupWindow) {
    setupWindow.destroy();
  }

  // Create setup window
  setupWindow = new BrowserWindow({
    icon: APP_ICON,

    title: '',
    width: 500,
    height: 650,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    type: 'toolbar',
    resizable: false,
    movable: true,
    frame: true,
    show: true,
    transparent: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true
  });

  setupWindow.setContentProtection(true);

  console.log('Setup window created, loading setup-dialog.html...');

  // Load the setup dialog HTML
  setupWindow.loadFile('setup-dialog.html');

  // Show the window when it's ready
  setupWindow.once('ready-to-show', () => {
    console.log('Setup window ready to show, showing and focusing...');
    setupWindow.show();
    setupWindow.focus();
  });

  // Handle window close
  setupWindow.on('closed', () => {
    console.log('Setup window closed');
    setupWindow = null;
  });

  setupWindow.webContents.on('did-finish-load', () => {
    console.log('Setup window content loaded');
  });

  return setupWindow;
}

// Create system tray icon
function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Capture Screen (Ctrl+Shift+H)',
      click: captureAndDisplay
    },
    {
      label: 'Capture Screen with Gemini (Ctrl+Shift+X)',
      click: captureAndDisplayWithGemini
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('windows v1');

  // Add click event to tray icon
  tray.on('click', captureAndDisplay);
}

// Show results in console
function showResults() {
  const { spawn } = require('child_process');
  const python = spawn('python', ['console_results.py']);

  python.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  python.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  python.on('close', (code) => {
    console.log(`Python script exited with code ${code}`);
  });
}

// Helper function to truncate text to last 50 characters if too long
function truncateTextForNotification(text) {
  if (text.length <= 50) {
    return text;
  }
  return '...' + text.substring(text.length - 50);
}

// Helper function to strip markdown code blocks
function sanitizeCodeText(text) {
  if (!text) return '';

  // Remove markdown code fences (```javascript, ```js, ```, etc.)
  let cleaned = text
    .replace(/^```[a-zA-Z]*\n?/gim, '')
    .replace(/```$/gim, '')
    .trim();

  return cleaned;
}

// Extract ONLY the code portion from an AI answer that includes approach/dry-run sections
// Looks for the 💻 CODE: header and returns everything after it
function extractCodeOnly(text) {
  if (!text) return '';

  // Try multiple regex patterns from most specific to least specific
  // Must extract ONLY section 5 (Optimal Code) from the 9-step format
  const patterns = [
    /5\.\s*Optimal Code[^\n]*\n(?:Say:[^\n]*\n)?(?:Code rules:[^\n]*\n)?([^]*?)(?=\n\s*6\.\s|$)/i,
    /💻[^\n]*?Optimal\s*Code[^\n]*\n([^]*?)(?=🔍|⏱️|✅|🔥|\n\s*6\.\s|$)/i,
    /💻[^\n]*?Code[^\n]*\n([^]*?)(?=🔍|⏱️|✅|🔥|\n\s*6\.\s|$)/i,
    /Optimal\s*Code[^\n]*\n([^]*?)(?=🔍|⏱️|Dry\s*Run|✅|🔥|\n\s*6\.\s|$)/i,
    /(?:4\.?\s*)?Optimal\s*Code\s*\n([^]*?)(?:5\.|🔍|Dry\s*Run|\n\s*6\.\s|$)/i,
  ];

  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match && match[1] && match[1].trim().length > 10) {
      console.log(`[TAB EXTRACT] Pattern ${i + 1} matched! Extracted ${match[1].trim().length} chars of code.`);
      return sanitizeCodeText(match[1].trim());
    }
  }

  console.log('[TAB EXTRACT] WARNING: No Optimal Code section found! Falling back to full text.');
  console.log('[TAB EXTRACT] First 200 chars of AI response:', text.substring(0, 200));
  // Fallback if no specific code section found
  return sanitizeCodeText(text);
}

// Function to save data to a localStorage-like file
function saveToLocalStorage(key, data) {
  try {
    const storagePath = path.join(app.getPath('userData'), 'localStorage.json');
    let storage = {};

    // Read existing storage if it exists
    if (fs.existsSync(storagePath)) {
      const existingData = fs.readFileSync(storagePath, 'utf8');
      storage = JSON.parse(existingData);
    }

    // Save the data with a timestamp
    storage[key] = {
      data: data,
      timestamp: new Date().toISOString()
    };

    // Write back to file
    fs.writeFileSync(storagePath, JSON.stringify(storage, null, 2));
    console.log(`Data saved to localStorage-like storage with key: ${key}`);

    // Also save premium token to token.json file for easier access
    if (key === 'premiumToken') {
      const tokenPath = getWritablePath('token.json');
      const tokenData = { token: data };
      fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
      console.log('Premium token also saved to token.json');
    }
  } catch (error) {
    console.error('Error saving to localStorage-like storage:', error);
  }
}

// Function to load data from localStorage-like file
function loadFromLocalStorage(key) {
  try {
    const storagePath = path.join(app.getPath('userData'), 'localStorage.json');

    if (fs.existsSync(storagePath)) {
      const storageData = fs.readFileSync(storagePath, 'utf8');
      const storage = JSON.parse(storageData);

      if (storage[key]) {
        return storage[key].data;
      }
    }

    return null;
  } catch (error) {
    console.error('Error loading from localStorage-like storage:', error);
    return null;
  }
}




// Lock to prevent multiple simultaneous captures
let isCapturing = false;

// ===== SCREENSHOT QUEUE: Capture to queue without API call =====
async function captureToQueue() {
  try {
    console.log('[QUEUE] Capturing screenshot to queue...');
    const imgBuffer = await getScreenshotBuffer();
    const base64Image = imgBuffer.toString('base64');

    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('screenshot-queued', { image: base64Image });
      stealthWindow.webContents.send('stealth-status', { message: '📸 Screenshot added to queue' });
      console.log('[QUEUE] Screenshot sent to overlay queue');
    }
  } catch (error) {
    console.error('[QUEUE] Error capturing screenshot:', error.message);
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('stealth-status', { message: '❌ Queue capture failed' });
    }
  }
}

// New function to capture screen and send to server without displaying results
async function captureAndDisplay() {
  if (isCapturing) {
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('stealth-status', { message: '⏳ Already processing... please wait!' });
    }
    console.log('Capture already in progress, ignoring hotkey.');
    return;
  }
  isCapturing = true;

  const captureStartTime = Date.now();
  try {
    console.log('Capturing screen (STREAMING MODE)...');

    // Signal the overlay that a new streaming response is starting
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('stealth-stream-start', { captureStartTime });
    }

    const result = await captureAndProcessStreaming({
      onStatus: (message) => {
        if (stealthWindow && !stealthWindow.isDestroyed()) {
          stealthWindow.webContents.send('stealth-status', { message });
        }
      },
      onChunk: (chunkText, fullTextSoFar) => {
        // Send each chunk to the overlay for real-time rendering
        if (stealthWindow && !stealthWindow.isDestroyed()) {
          stealthWindow.webContents.send('stealth-stream-chunk', { chunk: chunkText, fullText: fullTextSoFar });
        }
      },
      onExtracted: (text) => {
        console.log('Vision extraction received, streaming reasoning...');
      },
      onDone: (result) => {
        console.log(`Streaming complete: ${result.text ? result.text.length : 0} chars`);
      },
      onError: (msg) => {
        console.error('Streaming error:', msg);
        if (stealthWindow && !stealthWindow.isDestroyed()) {
          stealthWindow.webContents.send('stealth-status', { message: `❌ Error: ${msg}` });
        }
      }
    });

    // Handle final result (same as before for Tab typing etc.)
    if (result && result.success) {
      // NOTE: results.txt write removed for production — reduces forensic file traces

      // Send final stealth-update for backward compatibility
      if (stealthWindow && !stealthWindow.isDestroyed()) {
        stealthWindow.webContents.send('stealth-stream-done', { text: result.aiAnswers, extractedText: result.extractedText, modelUsed: result.modelUsed, captureStartTime });
        stealthWindow.webContents.send('stealth-status', { message: `✅ Answer received via ${result.modelUsed || 'AI'}` });
      }
      console.log('Screen captured and streamed to server successfully');
    }
  } catch (error) {
    console.error('Error capturing screen:', error);
    fs.writeFileSync('results.txt', 'Error capturing screen: ' + error.message);
    console.error('Screen capture failed with exception');
  } finally {
    isCapturing = false;
  }
}

// New function to capture screen, send to Gemini API, and display result with cursor
async function captureAndDisplayWithGemini() {
  // Start overall timer
  const startTime = Date.now();
  console.log('=== Ctrl+Shift+X Process Timing ===');

  try {
    // Show processing status in console only
    console.log('Capturing screen for Gemini processing...');

    // Time the capture and processing
    const captureStartTime = Date.now();
    const result = await captureAndProcessWithGemini();
    const captureEndTime = Date.now();
    console.log(`Capture and API processing time: ${captureEndTime - captureStartTime}ms`);

    // Handle result - copy to clipboard and save to file
    if (result.success) {
      console.log('Gemini capture result:', JSON.stringify(result, null, 2));

      // Time file operations
      const fileOpStartTime = Date.now();

      // NOTE: results.txt write removed for production — reduces forensic file traces

      // clipboard.writeText(result.text); // DISABLED: Prevents accidental Ctrl+V detection

      // Store AI answer in our variable and localStorage-like storage
      // Use shared sanitizeCodeText to strip markdown, method signatures, and leading spaces
      const strippedText = sanitizeCodeText(result.text);
      lastAiAnswer = strippedText;
      storedAnswers = strippedText;
      answerIndex = 0;
      console.log('Stored answers from Gemini result:', storedAnswers);
      saveToLocalStorage('lastAiAnswer', lastAiAnswer);

      // Send to stealth overlay silently (do NOT auto-show for Alt+X MCQ mode)
      if (stealthWindow && !stealthWindow.isDestroyed()) {
        stealthWindow.webContents.send('stealth-update', { text: result.text, extractedText: result.extractedText, modelUsed: result.modelUsed });
        stealthWindow.webContents.send('stealth-status', { message: `✅ Answer received via ${result.modelUsed || 'AI'}` });
      }

      const fileOpEndTime = Date.now();
      console.log(`File operations time: ${fileOpEndTime - fileOpStartTime}ms`);

      // Display the result using cursor movement
      console.log('Displaying result with cursor movement...');
      console.log('Raw result text:', result.text);

      // Process the text to make it suitable for cursor display
      let displayText = result.text.trim();

      // Extract the MCQ answer after the Calculation
      const answerMatch = displayText.match(/Final Answer:\s*([A-Ea-e])/i);
      if (answerMatch) {
        displayText = answerMatch[1].toUpperCase();
      } else {
        // Fallback for older formats or standalone letters
        const letterMatch = displayText.match(/^\d+\.\s*([A-Ea-e])\b/) || displayText.match(/\b([A-Ea-e])\b/);
        if (letterMatch) {
          displayText = letterMatch[1].toUpperCase();
        } else {
          // No valid MCQ answer found — skip cursor movement entirely
          console.log('No valid MCQ answer (A-E) found, skipping cursor movement.');
          return;
        }
      }

      console.log('Processed display text:', displayText);

      // Time cursor display
      const cursorStartTime = Date.now();

      // Move cursor quietly using PowerShell (reliable, bypasses VBS and nut-js)
      console.log('Moving cursor with PowerShell script for answer:', displayText);
      await moveCursorForAnswer(displayText);

      const cursorEndTime = Date.now();
      console.log(`Cursor movement time: ${cursorEndTime - cursorStartTime}ms`);

      console.log('Cursor movement complete');
    } else {
      throw new Error(result.error || 'Gemini API processing failed');
    }
  } catch (error) {
    console.error('Error in Gemini capture and display:', error.message);
    console.error(error.stack);

    // Save error to file
    fs.writeFileSync(getWritablePath('results.txt'), 'Error: ' + error.message);

    // On error, do NOT move the cursor — just log it
  } finally {
    // End overall timer
    const endTime = Date.now();
    console.log(`Total Ctrl+Shift+X process time: ${endTime - startTime}ms`);
    console.log('====================================');
  }
}

async function captureAndDebugError() {
  if (isCapturing) {
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('stealth-status', { message: '⏳ Already processing... please wait!' });
    }
    return;
  }
  isCapturing = true;

  const captureStartTime = Date.now();
  try {
    console.log('Capturing screen for error debugging...');
    showStealthOverlay();

    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('stealth-stream-start', { captureStartTime });
    }

    const result = await captureAndDebugErrorStreaming({
      onStatus: (message) => {
        if (stealthWindow && !stealthWindow.isDestroyed()) stealthWindow.webContents.send('stealth-status', { message });
      },
      onChunk: (chunkText, fullTextSoFar) => {
        if (stealthWindow && !stealthWindow.isDestroyed()) stealthWindow.webContents.send('stealth-stream-chunk', { chunk: chunkText, fullText: fullTextSoFar });
      },
      onExtracted: (text) => console.log('Vision extraction received, streaming debug logic...'),
      onDone: (result) => console.log(`Debug streaming complete: ${result.text ? result.text.length : 0} chars`),
      onError: (msg) => {
        console.error('Streaming error:', msg);
        if (stealthWindow && !stealthWindow.isDestroyed()) stealthWindow.webContents.send('stealth-status', { message: `❌ Error: ${msg}` });
      }
    });

    if (result && result.success) {
      if (stealthWindow && !stealthWindow.isDestroyed()) {
        stealthWindow.webContents.send('stealth-stream-done', { text: result.aiAnswers, extractedText: result.extractedText, modelUsed: result.modelUsed, captureStartTime });
        stealthWindow.webContents.send('stealth-status', { message: `✅ Debug received via ${result.modelUsed || 'AI'}` });
      }
    }
  } catch (error) {
    console.error('Error capturing screen for debug:', error);
  } finally {
    isCapturing = false;
  }
}



// Show a notification with the character to avoid triggering browser shortcuts

function testCursorDisplay() {
  console.log('Testing cursor display with sample text...');

  // Execute the VBScript with a simple test text
  const { spawn } = require('child_process');
  const vbsPath = path.join(__dirname, 'run-cursor.vbs');

  console.log('Executing VBScript with test text: TEST');
  const vbsProcess = spawn('wscript.exe', ['//nologo', vbsPath, 'TEST'], {
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });

  vbsProcess.on('error', (err) => {
    console.error('Failed to start test VBScript process:', err);
  });

  vbsProcess.unref();

  console.log('Test sent to cursor display');
}

// Register global shortcuts
function registerGlobalShortcuts() {
  // Ctrl+Shift+P = Batch Solve (send all queued screenshots for processing)
  globalShortcut.register('Control+Shift+P', () => {
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('trigger-batch-solve');
      console.log('Batch solve triggered via Ctrl+Shift+P');
    }
  });

  // Ctrl+Arrow keys to move stealth overlay on screen (clamped to screen bounds)
  const MOVE_STEP = 30; // pixels per press — small for smooth sliding

  function moveStealthWindow(dx, dy) {
    if (!stealthWindow || stealthWindow.isDestroyed() || !stealthWindow.isVisible()) return;
    // Send movement commands directly to HTML renderer to preserve 100% OS Fullscreen lock
    stealthWindow.webContents.send('move-overlay', { dx, dy });
  }

  globalShortcut.register('Control+Left', () => moveStealthWindow(-MOVE_STEP, 0));
  globalShortcut.register('Control+Right', () => moveStealthWindow(MOVE_STEP, 0));
  globalShortcut.register('Control+Up', () => moveStealthWindow(0, -MOVE_STEP));
  globalShortcut.register('Control+Down', () => moveStealthWindow(0, MOVE_STEP));

  // Shift+Up/Down for hands-free stealth scrolling
  function scrollStealthWindow(deltaY) {
    if (!stealthWindow || stealthWindow.isDestroyed() || !stealthWindow.isVisible()) return;
    stealthWindow.webContents.send('scroll-overlay', deltaY);
  }

  globalShortcut.register('Shift+Up', () => scrollStealthWindow(-80));
  globalShortcut.register('Shift+Down', () => scrollStealthWindow(80));
  // Safe fallbacks to prevent highlight interference
  globalShortcut.register('CommandOrControl+Shift+Up', () => scrollStealthWindow(-80));
  globalShortcut.register('CommandOrControl+Shift+Down', () => scrollStealthWindow(80));


  // Screenshot queue hotkey (Ctrl+Shift+G = Grab to queue)
  globalShortcut.register('Control+Shift+G', captureToQueue);

  // Try to register shortcut for capture and display without auto-typing
  // let ret2 = globalShortcut.register('Control+Shift+H', captureAndDisplay);
  let ret2 = true; // Disabled by user

  // New debugging shortcut
  globalShortcut.register('Control+Shift+T', captureAndDebugError);

  // If failed, try alternative
  // if (!ret2) {
  //   console.log('Trying alternative shortcut for capture and display...');
  //   ret2 = globalShortcut.register('Control+Alt+R', captureAndDisplay);
  // }

  // Try to register shortcut for capture and Gemini API processing with cursor display
  let ret3 = globalShortcut.register('Alt+X', captureAndDisplayWithGemini);

  // If failed, try alternative
  if (!ret3) {
    console.log('Trying alternative shortcut for capture and Gemini display...');
    ret3 = globalShortcut.register('Alt+Y', captureAndDisplayWithGemini);
  }



  // Stealth overlay toggle shortcut
  let retStealth = globalShortcut.register('Control+Shift+S', toggleStealthWindow);
  if (!retStealth) {
    console.log('Trying alternative stealth shortcut...');
    retStealth = globalShortcut.register('Control+Alt+S', toggleStealthWindow);
  }

  // Stealth overlay clear shortcut
  globalShortcut.register('Control+Shift+C', () => {
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.webContents.send('stealth-clear');
      console.log('Stealth overlay cleared via Control+Shift+C');
    }
  });

  // Global chat mode toggle (zero focus loss)
  globalShortcut.register('Control+Alt+J', () => {
    if (chatModeActive) exitChatMode();
    else enterChatMode();
  });

  // Emergency Kill Switch to close the entire application from Task Manager instantly
  let ret5 = globalShortcut.register('Control+Q', () => {
    console.log('Emergency Kill Switch activated (Ctrl+Q). App force-closing.');
    app.quit();
    process.exit(0);
  });

  // Also register Alt+Q as a kill switch
  const ret6 = globalShortcut.register('Alt+Q', () => {
    console.log('Emergency Kill Switch activated (Alt+Q). App force-closing.');
    app.quit();
    process.exit(0);
  });



  if (!ret2) {
    console.log('Failed to register global shortcut for capture and display (both default and alternative)');
  }

  if (!ret3) {
    console.log('Failed to register global shortcut for capture and Gemini display (both default and alternative)');
  }



  console.log('Global shortcuts registered:');
  console.log('- Ctrl+Shift+P (Batch Solve):', globalShortcut.isRegistered('Control+Shift+P'));
  console.log('- Ctrl+Shift+G (Queue Capture):', globalShortcut.isRegistered('Control+Shift+G'));
  // console.log('- Ctrl+Shift+H (Instant Solve):', globalShortcut.isRegistered('Control+Shift+H') || globalShortcut.isRegistered('Control+Alt+R'));
  console.log('- Ctrl+Shift+T (Debug Error):', globalShortcut.isRegistered('Control+Shift+T'));
  console.log('- Alt+X (Gemini MCQ):', globalShortcut.isRegistered('Alt+X') || globalShortcut.isRegistered('Alt+Y'));
  console.log('- Ctrl+Shift+S (Stealth):', globalShortcut.isRegistered('Control+Shift+S') || globalShortcut.isRegistered('Control+Alt+S'));
  console.log('- Ctrl+Shift+C (Clear Stealth):', globalShortcut.isRegistered('Control+Shift+C'));
  console.log('- Ctrl+Alt+J (Chat Mode):', globalShortcut.isRegistered('Control+Alt+J'));
  console.log('- Ctrl+Q/Alt+Q/F5 (Kill Switch):', globalShortcut.isRegistered('Control+Q') || globalShortcut.isRegistered('Alt+Q') || globalShortcut.isRegistered('F5'));
}

// Eliminate GPU child process — removes the suspicious 'GPU Process' entry from Task Manager
app.disableHardwareAcceleration();

// Request single instance lock to prevent multiple instances from causing cache/GPU errors
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting this instance...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // App lifecycle events
  app.whenReady().then(async () => {
    // Set a generic app name so it doesn't show as suspicious in any system list
    app.setName('RuntimeBroker');

    // ===== STARTUP CLEANUP: Wipe stale answers from previous sessions =====

    // Clear stale results.txt
    try {
      const resultsPath = path.join(__dirname, 'results.txt');
      if (fs.existsSync(resultsPath)) {
        fs.writeFileSync(resultsPath, '');
        console.log('Cleared stale results.txt on startup');
      }
    } catch (err) {
      console.error('Error clearing stale results.txt:', err.message);
    }
    // ===== END STARTUP CLEANUP =====

    createWindow();
    createStealthWindow(); // Re-enabled: Interview proctoring apps respect setContentProtection(true)

    console.log('Bypassing setup window - Auto-activating premium access...');

    // Ensure we have a token saved so API calls work
    const currentToken = loadFromLocalStorage('premiumToken');
    if (!currentToken) {
      saveToLocalStorage('premiumToken', 'auto-activated-user-token');
    }

    // Directly initialize main components
    // createTray(); // DISCONNECTED: User requested no system tray icon
    registerGlobalShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // IPC handlers
  ipcMain.on('close-window', () => {
    if (mainWindow) {
      mainWindow.hide();  // Hide instead of close to keep the window ready for next use
    }
  });

  // IPC handler to hide stealth overlay
  ipcMain.on('stealth-hide', () => {
    if (stealthWindow && !stealthWindow.isDestroyed()) {
      stealthWindow.setOpacity(0.0);
      stealthWindow.setIgnoreMouseEvents(true, { forward: true });
      stealthIsVisible = false;
      console.log('Stealth overlay hidden via IPC');
    }
  });

  // ===== STREAMING CHAT IPC HANDLER =====
  ipcMain.on('chat-message', async (event, data) => {
    try {
      if (!data || !data.message) return;
      console.log('[CHAT STREAM] Sending message:', data.message.substring(0, 80));

      const API_URL = process.env.VITE_API_URL || 'https://mcq-solver-server-production-410f.up.railway.app';
      const payload = JSON.stringify({ message: data.message, context: data.context || [] });

      const urlObj = new URL(`${API_URL}/chat-stream`);
      const httpModule = urlObj.protocol === 'https:' ? require('https') : require('http');

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'premium-token': 'admin-token'
        }
      };

      // Signal the overlay that streaming is starting
      if (stealthWindow && !stealthWindow.isDestroyed()) {
        stealthWindow.webContents.send('chat-stream-start', {});
      }

      let fullText = '';
      let buffer = '';

      const req = httpModule.request(options, (res) => {
        res.setEncoding('utf8');

        res.on('data', (rawChunk) => {
          buffer += rawChunk;
          // SSE lines are separated by \n\n
          const parts = buffer.split('\n\n');
          buffer = parts.pop(); // Keep incomplete trailing part

          for (const part of parts) {
            const lines = part.split('\n');
            let eventName = 'message';
            let dataStr = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) eventName = line.slice(7).trim();
              else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
            }
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);
              if (eventName === 'chunk' && parsed.text) {
                fullText += parsed.text;
                if (stealthWindow && !stealthWindow.isDestroyed()) {
                  stealthWindow.webContents.send('chat-stream-chunk', { chunk: parsed.text, fullText });
                }
              } else if (eventName === 'done') {
                if (stealthWindow && !stealthWindow.isDestroyed()) {
                  stealthWindow.webContents.send('chat-stream-done', { answer: fullText });
                }
                // Also reply for backward compat (re-enables chat send button)
                event.reply('chat-stream-complete', {});
              } else if (eventName === 'error') {
                event.reply('chat-error', { error: parsed.message || 'Stream error' });
              }
            } catch (e) { /* malformed SSE line — skip */ }
          }
        });

        res.on('end', () => {
          // Ensure done is fired even if server closed without explicit done event
          if (fullText && stealthWindow && !stealthWindow.isDestroyed()) {
            stealthWindow.webContents.send('chat-stream-done', { answer: fullText });
          }
          event.reply('chat-stream-complete', {});
          console.log(`[CHAT STREAM] Done — ${fullText.length} chars`);
        });

        res.on('error', (err) => {
          console.error('[CHAT STREAM] Response error:', err.message);
          event.reply('chat-error', { error: err.message });
        });
      });

      req.on('error', (err) => {
        console.error('[CHAT STREAM] Request error:', err.message);
        event.reply('chat-error', { error: 'Network error: ' + err.message });
      });

      req.setTimeout(90000, () => {
        req.destroy();
        event.reply('chat-error', { error: 'Request timed out' });
      });

      req.write(payload);
      req.end();

    } catch (error) {
      console.error('[CHAT STREAM] Error:', error.message);
      event.reply('chat-error', { error: 'Failed to start stream: ' + error.message });
    }
  });

  // ===== AUDIO IPC HANDLERS =====

  // Provide desktopCapturer sources to renderer (required in Electron 17+)
  const { desktopCapturer } = require('electron');
  ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.map(s => ({ id: s.id, name: s.name }));
  });

  // Audio listener ready
  ipcMain.on('audio-listener-ready', () => {
    console.log('Audio listener window is ready');
  });

  // Audio chunk received from listener — process it
  ipcMain.on('audio-chunk', async (event, data) => {
    if (data && data.audio) {
      await processAudioChunk(data.audio);
    }
  });

  // Audio status update from listener
  ipcMain.on('audio-status', (event, data) => {
    console.log('Audio status:', data.status, data.error ? `(${data.error})` : '');
    if (data.status === 'error') {
      isAudioListening = false;
      sendAudioStatusToStealth('error');
    }
  });

  // copy-text is registered inside createStealthWindow() — no duplicate needed here

  // IPC handler for token validation
  ipcMain.handle('validate-token', async (event, token) => {
    // DISCONNECTED: Always return valid for the auto-assigned premium token
    return {
      valid: true,
      count: 99999,
      model: 'premium'
    };
    /* Original code kept but disconnected
    try {
      const response = await axios.get(`https://boss-pranav5.vercel.app/admin/token-model/${token}`);
      
      if (response.status === 200 && response.data && response.data.success) {
        return { 
          valid: true, 
          count: response.data.count, 
          model: response.data.model 
        };
      } else {
        return { valid: false };
      }
    } catch (error) {
      console.error('Token validation error:', error);
      return { valid: false, error: error.message };
    }
    */
  });

  // IPC handler for saving token
  ipcMain.on('save-token', (event, token) => {
    // DISCONNECTED: We handle saving the token automatically on startup now
    /* Original code kept but disconnected
    try {
      saveToLocalStorage('premiumToken', token);
      event.reply('token-saved', { success: true });
      
      // Close setup window and initialize main app
      if (setupWindow) {
        setupWindow.close();
        setupWindow = null;
      }
      
      // Create tray and register shortcuts
      createTray();
      registerGlobalShortcuts();
    } catch (error) {
      console.error('Error saving token:', error);
      event.reply('token-saved', { success: false, error: error.message });
    }
    */
  });

  // IPC handler for checking if token exists
  ipcMain.handle('check-token', async () => {
    // DISCONNECTED: Always say token exists since we auto-create it
    return { exists: true, token: 'auto-activated-user-token' };
    /* Original code kept but disconnected
    try {
      const token = loadFromLocalStorage('premiumToken');
      return { exists: !!token, token };
    } catch (error) {
      console.error('Error checking token:', error);
      return { exists: false };
    }
    */
  });
}
