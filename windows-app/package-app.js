const packager = require('electron-packager');
const path = require('path');

async function packageApp() {
  try {
    const appPaths = await packager({
      dir: '.',
      out: 'dist',
      overwrite: true,
      platform: 'win32',
      arch: 'x64',
      appCopyright: 'Copyright (C) 2025 windows v1 Team',
      appVersion: '1.0.0',
      name: 'windows v1',
      executableName: 'ai-auto-marker',
      icon: path.join(__dirname, 'icon.png'),
      ignore: [
        '/dist($|/)',
        '/package-app.js',
        '/.git($|/)',
        '/node_modules/electron($|/)',
        '/node_modules/electron-builder($|/)',
        '/move-cursor2.ps1',
        '/move-cursor.ps1',  // Only if not needed at runtime
        '/run-cursor-B.bat',
        '/run-cursor-C.bat'
      ],
      prune: true,  // Remove unused dependencies
      derefSymlinks: true,
      win32metadata: {
        CompanyName: 'windows v1 Team',
        FileDescription: 'windows v1 Application',
        OriginalFilename: 'ai-auto-marker.exe',
        ProductName: 'windows v1'
      }
    });
    
    console.log('App packaged successfully to:', appPaths);
  } catch (error) {
    console.error('Error packaging app:', error);
  }
}

packageApp();
