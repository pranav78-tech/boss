const { app, globalShortcut } = require('electron');
const { captureAndProcessWithGemini } = require('./capture');

// A simple script to import main.js functions and test them, 
// but since main.js isn't easily testable without launching the app, 
// we'll just modify main.js temporarily to run the function on startup for testing.
