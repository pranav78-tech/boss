const electronInstaller = require('electron-installer-windows');
const path = require('path');

async function buildInstaller() {
  try {
    const options = {
      src: 'dist/RuntimeBroker-win32-x64',
      dest: 'dist/installers',
      authors: ['windows v1 Team'],
      exe: 'RuntimeBroker.exe',
      description: 'windows v1 Application',
      version: '1.0.0',
      title: 'windows v1',
      setupExe: 'build_final_v9.exe',
      iconUrl: 'file:///' + path.join(__dirname, 'icon_2.ico').replace(/\\/g, '/'),
      setupIcon: path.join(__dirname, 'icon_2.ico'),
      noMsi: true,
      skipUpdateIcon: false
    };

    console.log('Building Windows installer...');
    await electronInstaller(options);
    console.log('Successfully created Windows installer at:', path.join(__dirname, 'dist/installers'));
  } catch (error) {
    console.error('Error building installer:', error);
  }
}

buildInstaller();
