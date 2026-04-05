const screenshot = require('screenshot-desktop');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Store the history of previous API interactions to provide context
// Format: [{ question: "...", answer: "..." }]
let contextHistory = [];
const MAX_HISTORY_LENGTH = 5;

// Server URL
const BASE_URL = 'https://boss-production-3b9c.up.railway.app';
const SERVER_URL = `${BASE_URL}/solve-mcqs-base64`;
const OCR_SERVER_URL = `${BASE_URL}/perform-ocr`;
const FALLBACK_SERVER_URL = `${BASE_URL}/solve-mcqs-base64`;
const GEMINI_SERVER_URL = `${BASE_URL}/solve-mcqs-base64-Gemini`;

// Import Electron to access app data and DXGI hardware capture
const { app, desktopCapturer, screen } = require('electron');

// Advanced Screen Capture using Electron DXGI mapping (Bypasses Hardware Acceleration Black Screen)
async function getScreenshotBuffer() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    // High-resolution screenshot for OCR
    const scaleFactor = primaryDisplay.scaleFactor || 1;
    const width = Math.round(primaryDisplay.size.width * scaleFactor);
    const height = Math.round(primaryDisplay.size.height * scaleFactor);

    console.log(`Using advanced Electron DXGI capturer: ${width}x${height}`);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });

    if (sources && sources.length > 0) {
      // Return the native high-res PNG buffer
      return sources[0].thumbnail.toPNG();
    }
  } catch (error) {
    console.error("Advanced DXGI capture failed, falling back to basic GDI capture...", error);
  }

  // Basic fallback
  console.log("Using fallback GDI capture (screenshot-desktop)...");
  return await screenshot({ format: 'png' });
}


// Helper: resolve path that might be inside ASAR to the unpacked equivalent
function resolveAsarPath(filePath) {
  if (filePath.includes('app.asar')) {
    const unpackedPath = filePath.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpackedPath)) return unpackedPath;
  }
  return filePath;
}

// Function to get premium token from storage
function getPremiumToken() {
  try {
    // Try to load from local token file (check both ASAR and unpacked paths)
    const tokenFilePath = resolveAsarPath(path.join(__dirname, 'token.json'));

    if (fs.existsSync(tokenFilePath)) {
      const tokenData = fs.readFileSync(tokenFilePath, 'utf8');
      const tokenObj = JSON.parse(tokenData);

      // Check if token exists
      if (tokenObj.token) {
        return tokenObj.token;
      }
    }

    // Also try userData directory (writable, works in packaged mode)
    let userDataPath;
    if (typeof app !== 'undefined' && app && app.getPath) {
      userDataPath = app.getPath('userData');
    } else {
      // Fallback for non-Electron environments
      userDataPath = __dirname;
    }

    // Check token.json in userData
    const userDataTokenPath = path.join(userDataPath, 'token.json');
    if (fs.existsSync(userDataTokenPath)) {
      const tokenData = fs.readFileSync(userDataTokenPath, 'utf8');
      const tokenObj = JSON.parse(tokenData);
      if (tokenObj.token) return tokenObj.token;
    }

    const storagePath = path.join(userDataPath, 'localStorage.json');
    if (fs.existsSync(storagePath)) {
      const storageData = fs.readFileSync(storagePath, 'utf8');
      const storage = JSON.parse(storageData);

      // Check if premiumToken exists and has data property
      if (storage.premiumToken && storage.premiumToken.hasOwnProperty('data')) {
        return storage.premiumToken.data;
      }
    }

    // Return null if no token is found
    return null;
  } catch (error) {
    console.error('Error loading premium token:', error);
    // Return null if there's an error
    return null;
  }
}

/**
 * Capture screen and send to server for processing
 */
async function captureAndProcess() {
  const funcStartTime = Date.now();
  console.log('=== CaptureAndProcess Timing ===');

  try {
    console.log('Starting screen capture...');

    // Time screen capture
    const captureStartTime = Date.now();
    // Capture the entire screen using advanced DXGI bypass
    const imgBuffer = await getScreenshotBuffer();
    const captureEndTime = Date.now();
    console.log(`Screen capture time: ${captureEndTime - captureStartTime}ms`);

    // Convert to base64
    const base64Image = imgBuffer.toString('base64');

    console.log('Sending image to server...');

    // Time API call
    const apiCallStartTime = Date.now();
    // Get premium token
    const premiumToken = getPremiumToken();

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json'
    };

    // Only add premium token header if token is available
    if (premiumToken) {
      headers['premium-token'] = premiumToken;
    } else {
      headers['premium-token'] = 'admin-token';
    }

    // Send to server with headers
    const response = await axios.post(SERVER_URL, {
      image: base64Image,
      contextHistory: contextHistory
    }, {
      headers,
      timeout: 120000 // 120 second timeout for massive A2Z prompts
    });
    const apiCallEndTime = Date.now();
    console.log(`API call time: ${apiCallEndTime - apiCallStartTime}ms`);

    console.log('Server response received');

    if (response.data && response.data.success) {
      // Prefer AI answers if available, otherwise use extracted text
      let resultText = '';

      if (response.data.aiAnswers &&
        response.data.aiAnswers !== 'No AI answers available' &&
        response.data.aiAnswers !== 'No relevant questions found.') {
        resultText = response.data.aiAnswers;
      } else if (response.data.extractedText) {
        resultText = response.data.extractedText;
      } else {
        resultText = 'No content available';
      }

      const funcEndTime = Date.now();
      console.log(`Total captureAndProcess time: ${funcEndTime - funcStartTime}ms`);
      console.log('================================');

      // Save context history for future use
      if (resultText && resultText !== 'No content available' && resultText !== 'No relevant questions found.') {
        contextHistory.push({
          question: response.data.extractedText || "Unknown question extracted from image",
          answer: resultText
        });

        // Keep only the last MAX_HISTORY_LENGTH items
        if (contextHistory.length > MAX_HISTORY_LENGTH) {
          contextHistory.shift();
        }
      }

      return {
        success: true,
        text: resultText,
        aiAnswers: response.data.aiAnswers,
        extractedText: response.data.extractedText,
        modelUsed: response.data.modelUsed
      };
    } else {
      throw new Error(response.data.error || 'Server processing failed');
    }
  } catch (error) {
    console.error('Error in capture and process:', error.message);
    throw error;
  }
}

/**
 * Capture screen and send to Gemini API for processing
 */
async function captureAndProcessWithGemini() {
  const funcStartTime = Date.now();
  console.log('=== CaptureAndProcessWithGemini Timing ===');

  try {
    console.log('Starting screen capture for Gemini processing...');

    // Time screen capture
    const captureStartTime = Date.now();
    // Capture the entire screen using advanced DXGI bypass
    const imgBuffer = await getScreenshotBuffer();
    const captureEndTime = Date.now();
    console.log(`Screen capture time: ${captureEndTime - captureStartTime}ms`);

    // Convert to base64
    const base64Image = imgBuffer.toString('base64');

    console.log('Sending image to Gemini API...');

    // Time API call
    const apiCallStartTime = Date.now();
    // Get premium token
    const premiumToken = getPremiumToken();

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json'
    };

    // Only add premium token header if token is available
    if (premiumToken) {
      headers['premium-token'] = premiumToken;
    } else {
      headers['premium-token'] = 'admin-token';
    }

    // Send to Gemini API endpoint with headers
    const response = await axios.post(GEMINI_SERVER_URL, {
      image: base64Image,
      contextHistory: contextHistory
    }, {
      headers,
      timeout: 120000 // 120 second timeout for massive A2Z prompts
    });
    const apiCallEndTime = Date.now();
    console.log(`API call time: ${apiCallEndTime - apiCallStartTime}ms`);

    console.log('Gemini API response received');

    if (response.data && response.data.success) {
      // Get AI answers
      let resultText = '';

      if (response.data.aiAnswers &&
        response.data.aiAnswers !== 'No AI answers available' &&
        response.data.aiAnswers !== 'No relevant questions found.' &&
        response.data.aiAnswers !== 'No MCQ questions found.') {
        resultText = response.data.aiAnswers;
      } else {
        resultText = 'No MCQ questions found in the image';
      }

      const funcEndTime = Date.now();
      console.log(`Total captureAndProcessWithGemini time: ${funcEndTime - funcStartTime}ms`);
      console.log('========================================');

      // Save context history for future use
      if (resultText && resultText !== 'No content available' && resultText !== 'No MCQ questions found.') {
        contextHistory.push({
          question: response.data.question || "Unknown question extracted from Gemini vision",
          answer: resultText
        });

        // Keep only the last MAX_HISTORY_LENGTH items
        if (contextHistory.length > MAX_HISTORY_LENGTH) {
          contextHistory.shift();
        }
      }

      return {
        success: true,
        text: resultText,
        aiAnswers: response.data.aiAnswers,
        cursorAction: response.data.cursor,
        modelUsed: response.data.modelUsed
      };
    } else {
      throw new Error(response.data.error || 'Gemini API processing failed');
    }
  } catch (error) {
    console.error('Error in Gemini capture and process:', error.message);
    throw error;
  }
}

/**
 * Streaming version of captureAndProcess — sends chunks to callback in real-time
 * @param {Object} callbacks - { onChunk, onStatus, onExtracted, onDone, onError }
 */
async function captureAndProcessStreaming(callbacks = {}) {
  const { onChunk, onStatus, onExtracted, onDone, onError } = callbacks;
  const funcStartTime = Date.now();
  console.log('=== CaptureAndProcess STREAMING Timing ===');

  try {
    console.log('Starting screen capture...');
    const imgBuffer = await getScreenshotBuffer();
    const base64Image = imgBuffer.toString('base64');

    const premiumToken = getPremiumToken();
    const headers = {
      'Content-Type': 'application/json',
      'premium-token': premiumToken || 'admin-token'
    };

    console.log('Sending image to streaming endpoint...');

    // Use native fetch for SSE streaming (available in Electron/Node 18+)
    const STREAM_URL = `${BASE_URL}/solve-mcqs-base64-stream`;
    const response = await fetch(STREAM_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image: base64Image,
        contextHistory: contextHistory
      })
    });

    if (!response.ok) {
      let errorMessage = `Stream request failed: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (e) {
        // Not JSON
      }
      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let extractedText = '';
    let modelUsed = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.substring(6));

            switch (currentEvent) {
              case 'chunk':
                fullText += data.text;
                if (onChunk) onChunk(data.text, fullText);
                break;
              case 'status':
                if (onStatus) onStatus(data.message);
                break;
              case 'extracted':
                extractedText = data.text;
                if (onExtracted) onExtracted(data.text);
                break;
              case 'done':
                extractedText = data.extractedText || extractedText;
                modelUsed = data.modelUsed || '';
                break;
              case 'error':
                if (onError) onError(data.message);
                break;
            }
          } catch (parseErr) {
            // Skip malformed JSON
          }
          currentEvent = '';
        }
      }
    }

    const funcEndTime = Date.now();
    console.log(`Total streaming captureAndProcess time: ${funcEndTime - funcStartTime}ms`);

    // Save to context history
    if (fullText && fullText !== 'No content available') {
      contextHistory.push({
        question: extractedText || "Unknown question extracted from image",
        answer: fullText
      });
      if (contextHistory.length > MAX_HISTORY_LENGTH) {
        contextHistory.shift();
      }
    }

    if (onDone) onDone({
      success: true,
      text: fullText,
      aiAnswers: fullText,
      extractedText: extractedText,
      modelUsed: modelUsed
    });

    return {
      success: true,
      text: fullText,
      aiAnswers: fullText,
      extractedText: extractedText,
      modelUsed: modelUsed
    };

  } catch (error) {
    console.error('Error in streaming capture:', error.message);
    if (onError) onError(error.message);
    throw error;
  }
}



async function captureAndDebugErrorStreaming(callbacks = {}) {
  const { onChunk, onStatus, onExtracted, onDone, onError } = callbacks;
  const funcStartTime = Date.now();
  console.log('=== CaptureAndDebugError STREAMING Timing ===');

  try {
    console.log('Starting error screen capture...');
    const imgBuffer = await getScreenshotBuffer();
    const base64Image = imgBuffer.toString('base64');

    const premiumToken = getPremiumToken();
    const headers = {
      'Content-Type': 'application/json',
      'premium-token': premiumToken || 'admin-token'
    };

    console.log('Sending error image to streaming debug endpoint...');

    // Hit the new error debugging API endpoint
    const STREAM_URL = `${BASE_URL}/solve-error-base64-stream`;
    const response = await fetch(STREAM_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image: base64Image,
        contextHistory: contextHistory
      })
    });

    if (!response.ok) {
      let errorMessage = `Stream request failed: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (e) {
        // Not JSON
      }
      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let extractedText = '';
    let modelUsed = '';

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
            const data = JSON.parse(line.substring(6));

            switch (currentEvent) {
              case 'chunk':
                fullText += data.text;
                if (onChunk) onChunk(data.text, fullText);
                break;
              case 'status':
                if (onStatus) onStatus(data.message);
                break;
              case 'extracted':
                extractedText = data.text;
                if (onExtracted) onExtracted(data.text);
                break;
              case 'done':
                extractedText = data.extractedText || extractedText;
                modelUsed = data.modelUsed || '';
                break;
              case 'error':
                if (onError) onError(data.message);
                break;
            }
          } catch (parseErr) {
            // Skip malformed JSON
          }
          currentEvent = '';
        }
      }
    }

    const funcEndTime = Date.now();
    console.log(`Total streaming captureAndDebugError time: ${funcEndTime - funcStartTime}ms`);

    if (onDone) onDone({
      success: true,
      text: fullText,
      aiAnswers: fullText,
      extractedText: extractedText,
      modelUsed: modelUsed
    });

    return {
      success: true,
      text: fullText,
      aiAnswers: fullText,
      extractedText: extractedText,
      modelUsed: modelUsed
    };

  } catch (error) {
    console.error('Error in streaming error debug capture:', error.message);
    if (onError) onError(error.message);
    throw error;
  }
}

module.exports = {
  captureAndProcess,
  captureAndProcessWithGemini,
  captureAndProcessStreaming,
  captureAndDebugErrorStreaming,
  getPremiumToken
};

