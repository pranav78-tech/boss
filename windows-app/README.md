# Windows V1 Windows Application

## Optimization Tips for Faster Distribution

1. **Icon Optimization**: The current icon.png is 2.2MB which is quite large. Consider reducing it to 256x256 pixels or smaller for distribution.

2. **Unused Files**: Remove unused PowerShell scripts and batch files:
   - move-cursor2.ps1
   - run-cursor-B.bat
   - run-cursor-C.bat

3. **Build Command**: Use the optimized packaging script:
   ```
   npm run package
   ```

4. **Alternative Distribution Methods**:
   - Consider using a web-based version for lighter distribution
   - Use an installer instead of distributing the raw folder
   - Implement code splitting to reduce initial download size

## Build Process

To package the application for Windows:
```
npm run package
```

This will create a distributable package in the `dist` folder.

## Installation

Simply extract the package and run `ai-auto-marker.exe`.

## Requirements

- Windows 10 or later
- No additional dependencies required

## Features

- Capture your entire screen with a keyboard shortcut (Ctrl+Shift+U)
- Process screenshots with AI to extract text and answer MCQ questions
- **Completely invisible operation** - No visible windows during screen sharing
- **Multiple result delivery methods**:
  - Automatic clipboard copy
  - Text file output (results.txt)
  - System notifications
  - Console display option
- System tray icon for quick access
- **Automatic AI Answer Typing** - Type stored AI answers automatically with Ctrl+Shift+P

## Usage

1. Launch the application
2. Press Ctrl+Shift+U to capture your screen
3. The application will process the screenshot invisibly
4. Results are automatically:
   - Copied to your clipboard
   - Saved to results.txt
   - Notified via system notification
5. To view results in console, click "View Results" in the system tray menu
6. Press Ctrl+Shift+P to automatically type the last AI answer:
   - The text will be typed character by character automatically
   - Focus on the target application before pressing the shortcut
   - The typing will start after a 3-second delay

You can also click the system tray icon to trigger a screen capture.

## Invisible Operation Mode

The application now operates completely invisibly to screen sharing applications:

- Window is hidden at all times (positioned off-screen)
- No visible UI elements during operation
- Results delivered through non-visual means
- System tray icon is the only visible element

## Result Delivery Methods

1. **Clipboard Copy**: Results are automatically copied to your clipboard
2. **Text File**: Results are saved to `results.txt` in the application directory
3. **System Notifications**: Brief notifications show processing status
4. **Console Display**: Click "View Results" in the system tray to see results in a console window
5. **Automatic Typing**: Press Ctrl+Shift+P to type the last AI answer automatically

## Building Executable

To build a standalone executable for Windows:

```
npm run build
```

This will create a distributable package in the `dist` folder.

## Advanced Hidden Window (C++ Version)

For even better invisibility, you can compile the included C++ version which creates a truly hidden window:

1. Run `build_hidden_window.bat` to compile the C++ version
2. This creates `hidden_window.exe` which runs completely invisibly

Note: The C++ version only creates the hidden window and doesn't include the full AI processing features.
