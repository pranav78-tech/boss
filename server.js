import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Razorpay from 'razorpay';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import Tesseract from 'tesseract.js';
import Groq from 'groq-sdk';
import os from 'os';

// Load environment variables
dotenv.config();

const RAILWAY_URL = 'https://boss-production-3b9c.up.railway.app/';

const DEBUG_MODIFICATION_PROMPT = `You are an elite competitive programmer and debugging expert.
The user has captured a screenshot of their code with an error, wrong output, TLE, MLE, or a failing test case.

Your job is to identify the bug and provide the corrected code.

RESPONSE FORMAT:
1. **Bug:** One line identifying the exact issue.
2. **Why:** 2-3 sentences explaining the root cause — off-by-one, wrong data structure, missing edge case, etc.
3. **Fix:** Show the corrected code. Use this format:

\`\`\`[language]
[corrected code — complete function/method body]
\`\`\`

RULES:
- For simple bugs (off-by-one, wrong operator, missing base case): show just the corrected function.
- For algorithmic bugs (wrong approach, TLE, MLE): rewrite the entire solution with the optimal approach.
- INCLUDE line-by-line comments explaining the fix and the algorithm logic.
- Output ONLY the method/function body unless the bug is in class structure or imports.
- Use the SAME language as the original code. Default to Java if unclear.
- If the problem is TLE: provide the optimal O(n) or O(n log n) solution.
- If the problem is MLE: optimize space usage, convert recursion to iteration if needed.
- The fixed code MUST pass all test cases immediately. No partial fixes.`;

const PROJECT_GENERATOR_PROMPT = `You are an elite competitive programmer solving a LIVE ONLINE ASSESSMENT. Perform perfectly — NO second chances.

Identify the type from the screenshot and respond accordingly.

=== MCQ ===
**Answer: [Letter]**
**Why:** [1 sentence]

=== DSA / CODING PROBLEM ===
**Approach:** [Technique — e.g., Two Pointers, DP, Binary Search]
**Complexity:** Time: O(?) | Space: O(?)
\`\`\`java
[Most optimal solution. Clean code. ZERO comments. Descriptive variable names.]
\`\`\`

=== SQL ===
\`\`\`sql
[Optimized query. No comments.]
\`\`\`

RULES:
1. Code MUST be 100% correct. Must pass ALL hidden test cases first try.
2. Always the MOST OPTIMAL algorithm. No brute force.
3. If boilerplate/class is shown, output ONLY the method body.
4. Default language: Java.
5. No dry runs. No theory. No edge case lists. Just the solution.
6. ZERO code comments. Clean code only.
7. Keep output SHORT and CLEAN.`;

const VISION_EXTRACTION_PROMPT = "Extract ALL text from this image precisely. This is a coding problem, MCQ, or SQL challenge. Extract: problem title, full statement, input/output format, constraints, examples, boilerplate code, and language shown. Preserve all details exactly.";

const ASSIGNMENT_BATCH_PROMPT = `You are an elite competitive programmer. Multiple screenshots from one coding assessment. Solve everything.

=== MCQ ===
**Q[number]: [Letter]**
**Why:** [1 sentence]

=== DSA / CODING ===
**Approach:** [Technique]
**Complexity:** Time: O(?) | Space: O(?)
\`\`\`java
[Most optimal solution. ZERO comments.]
\`\`\`

=== SQL ===
\`\`\`sql
[Optimized query]
\`\`\`

RULES:
1. Solve EVERY question. Skip nothing.
2. If screenshots show parts of same problem, combine into one solution.
3. Boilerplate is sacred — output ONLY method body.
4. Most optimal solution only. Must pass all hidden test cases.
5. Default: Java.
6. No dry runs. No theory. No filler. Just solutions.`;






// Initialize Razorpay lazily (only when keys are available)
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
} else {
  console.warn('Razorpay keys not set — payment endpoints will be unavailable.');
}

// Function to send email with premium token
async function sendTokenEmail(email, token) {
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });


    // Define email content
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Premium Token for Windows V1',
      html: `
  < div style = "font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;" >
          <h2 style="color: #333; text-align: center;">Windows V1 Premium Token</h2>
          
          <p style="font-size: 16px; color: #555;">Thank you for purchasing a premium token for Windows V1!</p>
          
          <div style="background-color: #f8f9fa; border: 2px dashed #007bff; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <p style="font-size: 18px; margin: 0 0 10px 0; color: #333;">Your Premium Token:</p>
            <p style="font-size: 24px; font-weight: bold; color: #007bff; background-color: #e9ecef; padding: 15px; border-radius: 5px; letter-spacing: 2px;">${token}</p>
          </div>
          
          <div style="background-color: #e8f4ff; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #007bff;">How to Use Your Token</h3>
            <p style="margin-bottom: 5px;"><strong>1.</strong> Open the Windows V1 Chrome extension</p>
            <p style="margin-bottom: 5px;"><strong>2.</strong> Go to Settings</p>
            <p style="margin-bottom: 5px;"><strong>3.</strong> Paste your token in the Premium Token field</p>
            <p style="margin-bottom: 0;"><strong>4.</strong> Save your settings and start using premium features!</p>
          </div>
          
          <p style="font-size: 16px; color: #555;">Track your usage at: <a href="https://boss-pranav5.vercel.app/logs.html" style="color: #007bff; text-decoration: none;">Token Logs Page</a></p>
          
          <p style="font-size: 16px; color: #555;">Have questions? Contact our support team anytime.</p>
          
          <br>
          <p style="font-size: 16px; color: #333;"><strong>Best regards,</strong><br>
          The Windows V1 Team</p>
        </div>
`
    };

    // Send email
    await transporter.sendMail(mailOptions);
    console.log('Token email sent successfully to:', email);
  } catch (error) {
    console.error('Error sending token email:', error);
    throw error;
  }
}

// Token-based model selection map (High-performance in-memory fallback)
// Structure: { token: { model: 'model-name', count: number } }
const tokenModelMap = new Map();

// Model constants — Sonnet as primary (fast + cost-effective), Opus as fallback (heavy reasoning)
const PRIMARY_MODEL = "anthropic/claude-sonnet-4.6";
const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

// Add default premium tokens for manual use
tokenModelMap.set('my-batman-17', { model: PRIMARY_MODEL, count: 999999 });
tokenModelMap.set('admin-token', { model: PRIMARY_MODEL, count: 999999 });
tokenModelMap.set('premium-2026', { model: PRIMARY_MODEL, count: 999999 });

// In-memory logs storage
const tokenLogs = new Map();

// Function to get model based on token
async function getModelForToken(token) {
  // If no token is provided, use the default primary model
  if (!token) {
    return PRIMARY_MODEL;
  }

  // Use in-memory Map
  if (tokenModelMap.has(token)) {
    const tokenData = tokenModelMap.get(token);
    if (tokenData.count > 0) {
      // Decrease count by one
      tokenData.count -= 1;
      tokenModelMap.set(token, tokenData);
      return tokenData.model;
    }
  }

  // If token is provided but not found or count is zero, use default model
  return PRIMARY_MODEL;
}

// Function to log token usage
function logTokenUsage(token, logEntry) {
  if (!token) return;

  // Add timestamp to log entry
  const logWithTimestamp = {
    ...logEntry,
    timestamp: new Date().toISOString()
  };

  // Store logs in memory
  if (!tokenLogs.has(token)) {
    tokenLogs.set(token, []);
  }
  tokenLogs.get(token).push(logWithTimestamp);
}

// Function to perform OCR using Tesseract.js
async function performTesseractOCR(base64Data) {
  try {
    console.log('Starting Tesseract.js OCR...');
    const buffer = Buffer.from(base64Data, 'base64');
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
    console.log('Tesseract.js OCR complete.');
    return text;
  } catch (error) {
    console.error('Tesseract.js OCR failed:', error);
    return null;
  }
}

// Use /tmp on Vercel (read-only filesystem), local uploads/ dir otherwise
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, 'uploads');
if (!process.env.VERCEL && !fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'screenshot-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use('/uploads', express.static(uploadDir)); // Serve uploaded files
app.use('/fonts', express.static(path.join(__dirname, 'fonts'))); // Serve fonts

// Route to handle screenshot file uploads

// --- GLOBAL STEALTH MULTIPLAYER STATE ---
const globalSSEClients = new Set();
const globalHistory = [];
const MAX_GLOBAL_HISTORY = 500;

function broadcastGlobalStealth(data) {
  // Enforce required structure
  const broadcastData = {
    text: data.text || data.aiAnswers || "No content",
    timestamp: Date.now()
  };

  // Add to memory history
  globalHistory.push(broadcastData);
  if (globalHistory.length > MAX_GLOBAL_HISTORY) globalHistory.shift();
  
  // Broadcast to all active Web UI clients
  for (const client of globalSSEClients) {
    try {
      client.write(`data: ${JSON.stringify(broadcastData)}\n\n`);
    } catch (e) {
      globalSSEClients.delete(client);
    }
  }
}



// Secret mobile route — short URL for quick phone access
app.get('/m', (req, res) => {
  res.sendFile(path.join(__dirname, 'mobile.html'));
});

app.get('/api/stealth-history', (req, res) => {
  res.json({ success: true, history: globalHistory });
});

app.get('/api/stealth-global-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  globalSSEClients.add(res);
  req.on('close', () => globalSSEClients.delete(res));
});
app.post('/solve-mcqs', upload.single('screenshot'), async (req, res) => {
  const endpointStartTime = Date.now();
  console.log('=== /solve-mcqs Endpoint Timing ===');

  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'Screenshot file is required' });
    }

    // Get token from premium-token header
    const token = req.headers['premium-token'];

    // Determine model based on token
    const modelName = await getModelForToken(token);

    // Create model instance
    const model = new ChatGroq({
      model: modelName,
      temperature: 0.3,
      apiKey: process.env.GROQ_API_KEY,
    });

    // Read the uploaded file and convert to base64 for Native Vision
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Data = imageBuffer.toString('base64');

    // --- STEP 1: NATIVE VISION EXTRACTION (Gemini 2.5 Flash) ---
    console.log('Starting Native Vision extraction with Gemini 2.5 Flash...');
    const visionModel = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    let extractedQuestion = "";
    try {
      const visionResponse = await visionModel.invoke([
        {
          role: "user",
          content: [
            { type: "text", text: VISION_EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } }
          ]
        }
      ]);
      extractedQuestion = visionResponse.content;
      console.log('Vision extraction complete.');
    } catch (visionError) {
      console.error('Vision extraction failed, falling back to Tesseract.js:', visionError);
      extractedQuestion = await performTesseractOCR(base64Data);
      if (!extractedQuestion) {
        throw new Error('Both Vision and Tesseract OCR failed');
      }
    }

    // Save the extracted text to a file for logging
    const textFilename = req.file.filename.replace(path.extname(req.file.filename), '.txt');
    const textFilePath = path.join(uploadDir, textFilename);
    fs.writeFileSync(textFilePath, extractedQuestion);

    // --- STEP 2: OCR SANITATION PASS ---
    let sanitizedText = extractedQuestion;


    // --- STEP 3: REASONING (Single Powerful Model) ---
    let aiAnswers = null;
    let actualModelUsed = "Project Generator";
    try {
      console.log('--- STEP 3: Running Project Generator ---');
      const claudeModel = new ChatOpenAI({
        model: PRIMARY_MODEL,
        temperature: 0.1,
        maxTokens: 16000,
        apiKey: process.env.OPENROUTER_API_KEY,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: {
            "HTTP-Referer": RAILWAY_URL,
            "X-Title": "Windows V1",
          }
        }
      });

      const response = await claudeModel.invoke([
        ["system", PROJECT_GENERATOR_PROMPT],
        ["user", "Here is the project assignment extracted from the screenshot. Generate the complete project files:\n\n" + sanitizedText]
      ]);

      // Server-side post-processing: strip thinking tags, extract clean output
      aiAnswers = response.content
        .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
        .trim();

      actualModelUsed = "Project Generator (Claude Sonnet 4)";

      console.log('\n================ RAW EXPLANATION TEXT (TO STEALTH) ================\n');
      console.log(aiAnswers);
      console.log('\n===================================================================\n');

    } catch (error) {
      console.error('Claude reasoning failed:', error.message);
      aiAnswers = "AI reasoning failed: " + error.message;
      actualModelUsed = "failed";
    }

    // Prepare the response
    const responseJson = {
      success: true,
      message: 'Image processed with Multi-Pass Native Vision successfully',
      fileId: req.file.filename,
      filePath: req.file.path,
      extractedText: sanitizedText,
      textFileId: textFilename,
      textFilePath: textFilePath,
      aiAnswers: aiAnswers,
      modelUsed: `Vision: Gemini 2.5 Flash, Logic: ${actualModelUsed} `
    };

    // Log token usage
    logTokenUsage(token, {
      modelUsed: `Vision: Gemini 2.5 Flash, Logic: ${actualModelUsed} `,
      extractedText: sanitizedText,
      aiAnswers: aiAnswers,
      fileId: req.file.filename,
      filePath: req.file.path
    });

    const endpointEndTime = Date.now();
    console.log(`Total / solve - mcqs endpoint time: ${endpointEndTime - endpointStartTime} ms`);
    console.log('=====================================');

    // Send the response
    res.json(responseJson);

    // Delete the uploaded image file after sending the response
    try {
      fs.unlinkSync(req.file.path);
      console.log('Deleted uploaded image file:', req.file.path);
    } catch (deleteError) {
      console.error('Error deleting image file:', deleteError);
    }

  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process file: ' + error.message
    });
  }
});

// New endpoint to handle base64 image data directly
app.post('/solve-mcqs-base64', async (req, res) => {
  try {
    const { image, contextHistory } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }

    // Get token from premium-token header
    const token = req.headers['premium-token'];

    // Determine model based on token
    const modelName = await getModelForToken(token);

    // Create model instance
    const model = new ChatGroq({
      model: modelName,
      temperature: 0.3,
      apiKey: process.env.GROQ_API_KEY,
    });

    // Generate a unique filename
    const filename = `screenshot - ${Date.now()} -${Math.round(Math.random() * 1E9)}.png`;
    const filePath = path.join(uploadDir, filename);

    // If image is already a data URL, extract the base64 data
    // Otherwise, assume it's base64 data
    let base64Data;
    if (image.startsWith('data:image')) {
      base64Data = image.split(',')[1];
    } else {
      base64Data = image;
    }

    // Save the image file
    fs.writeFileSync(filePath, base64Data, "base64");

    // --- STEP 1: NATIVE VISION EXTRACTION (Gemini 2.5 Flash) ---
    console.log('Starting Native Vision extraction with Gemini 2.5 Flash...');
    const visionModel = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    let extractedQuestion = "";
    try {
      const visionResponse = await visionModel.invoke([
        {
          role: "user",
          content: [
            { type: "text", text: VISION_EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } }
          ]
        }
      ]);
      extractedQuestion = visionResponse.content;
      console.log('Vision extraction complete.');
    } catch (visionError) {
      console.error('Vision extraction failed, falling back to Tesseract.js:', visionError);
      extractedQuestion = await performTesseractOCR(base64Data);
      if (!extractedQuestion) {
        throw new Error('Both Vision and Tesseract OCR failed');
      }
    }

    // --- STEP 2: OCR SANITATION PASS ---
    // (Disabled because Gemini 2.5 Flash Vision OCR is virtually flawless. Skipping saves ~1-2 seconds of latency)
    let sanitizedText = extractedQuestion; // Pass raw text directly to Reasoning Phase


    // --- STEP 3: REASONING (Single Powerful Model) ---
    let aiAnswers = null;
    let actualModelUsed = "Project Generator";
    try {
      console.log('--- STEP 3: Running Project Generator ---');
      let contextStr = "";
      if (contextHistory && contextHistory.length > 0) {
        contextStr = "Previous context from past screenshots for this session:\n";
        contextHistory.forEach((item, index) => {
          contextStr += `--- Screenshot ${index + 1} ---\nExtracted: ${item.question} \n\n`;
        });
        contextStr += "Use the above context if relevant to the current assignment.\n\n";
      }

      const claudeModel = new ChatOpenAI({
        model: PRIMARY_MODEL,
        temperature: 0.1,
        maxTokens: 16000,
        apiKey: process.env.OPENROUTER_API_KEY,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: {
            "HTTP-Referer": RAILWAY_URL,
            "X-Title": "Windows V1",
          }
        }
      });

      const response = await claudeModel.invoke([
        ["system", PROJECT_GENERATOR_PROMPT],
        ["user", contextStr + "Here is the project assignment extracted from the screenshot. Generate the complete project files:\n\n" + sanitizedText]
      ]);

      // Server-side post-processing: strip thinking tags, extract clean output
      aiAnswers = response.content
        .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
        .trim();

      actualModelUsed = "Project Generator (Claude Sonnet 4)";

      console.log('\n================ RAW EXPLANATION TEXT (TO STEALTH) ================\n');
      console.log(aiAnswers);
      console.log('\n===================================================================\n');

    } catch (error) {
      console.error('Claude reasoning failed:', error.message);
      aiAnswers = "AI reasoning failed: " + error.message;
      actualModelUsed = "failed";
    }

    // Prepare the response
    const responseJson = {
      success: true,
      message: 'Image processed with Multi-Pass Native Vision successfully',
      aiAnswers: aiAnswers,
      extractedText: sanitizedText,
      modelUsed: `Vision: Gemini 2.5 Flash, Logic: ${actualModelUsed} `
    };

    console.log(`✅ Response ready(${actualModelUsed}, ${aiAnswers ? aiAnswers.length : 0} chars)`);

    // Log token usage
    logTokenUsage(token, {
      modelUsed: actualModelUsed,
      extractedText: sanitizedText,
      aiAnswers: aiAnswers,
      fileId: filename,
      filePath: filePath
    });

    // Send the response
    res.json(responseJson);

    // Broadcast to all global Web UI clients
    broadcastGlobalStealth({ text: aiAnswers });

    // Delete the uploaded image file after sending the response
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('Deleted uploaded image file:', filePath);
      }
    } catch (deleteError) {
      console.error('Error deleting image file:', deleteError);
    } 

  } catch (error) {
    console.error('Error saving base64 image:', error);
    
    try {
      if (typeof filePath !== 'undefined' && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}

    res.status(500).json({
      success: false,
      error: 'Failed to save base64 image: ' + error.message
    });
  }
});

// =================== STREAMING ENDPOINT ===================
app.post('/solve-mcqs-base64-stream', async (req, res) => {
  try {
    const { image, contextHistory } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, error: 'Image data is required' });
    }

    const token = req.headers['premium-token'];

    // Check for missing keys early
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('CRITICAL: OPENROUTER_API_KEY is missing in environment variables.');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'API Keys missing on server. Please check Railway Variables.' }));
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Helper to send SSE events
    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // --- STEP 1: VISION EXTRACTION (non-streaming, fast) ---
    sendSSE('status', { message: '🔍 Extracting text from screenshot...' });

    // Use global uploadDir (already configured for Vercel /tmp at top of file)
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filename = `screenshot-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
    const filePath = path.join(uploadDir, filename);

    let base64Data = image.startsWith('data:image') ? image.split(',')[1] : image;
    fs.writeFileSync(filePath, base64Data, "base64");

    console.log('Starting Native Vision extraction with Gemini 2.5 Flash...');
    const visionModel = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    let extractedQuestion = "";
    try {
      const visionResponse = await visionModel.invoke([
        {
          role: "user",
          content: [
            { type: "text", text: VISION_EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } }
          ]
        }
      ]);
      extractedQuestion = visionResponse.content;
      console.log('Vision extraction complete.');
    } catch (visionError) {
      console.error('Vision extraction failed, falling back to Tesseract.js:', visionError);
      extractedQuestion = await performTesseractOCR(base64Data);
      if (!extractedQuestion) {
        sendSSE('error', { message: 'Both Vision and Tesseract OCR failed' });
        res.end();
        return;
      }
    }

    let sanitizedText = extractedQuestion;
    sendSSE('extracted', { text: sanitizedText });

    // --- STEP 2: STREAMING REASONING ---
    sendSSE('status', { message: 'Generating project...' });

    let contextStr = "";
    if (contextHistory && contextHistory.length > 0) {
      contextStr = "Previous context from past screenshots for this session:\n";
      contextHistory.forEach((item, index) => {
        contextStr += `--- Screenshot ${index + 1} ---\nExtracted: ${item.question}\n\n`;
      });
      contextStr += "Use the above context if relevant to the current assignment.\n\n";
    }

    const claudeModel = new ChatOpenAI({
      model: PRIMARY_MODEL,
      temperature: 0.1,
      maxTokens: 16000,
      streaming: true,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    console.log('--- STREAMING: Running Project Generator (Sonnet 4.6) ---');

    let fullResponse = "";
    let hasStartedStep1 = false;
    let preambleBuffer = "";

    const stream = await claudeModel.stream([
      ["system", PROJECT_GENERATOR_PROMPT],
      ["user", contextStr + "Here is the project assignment extracted from the screenshot. Generate the complete project files:\n\n" + sanitizedText]
    ]);

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (!text) continue;

      fullResponse += text;

      // Instantly send real-time chunks to frontend!
      sendSSE('chunk', { text });
    }

    console.log('\n================ STREAMED RESPONSE ================\n');
    console.log(fullResponse);
    console.log(`\n=== Total: ${fullResponse.length} chars ===\n`);

    // Send completion event with metadata
    sendSSE('done', {
      extractedText: sanitizedText,
      modelUsed: 'Project Generator (Streaming)',
      totalLength: fullResponse.length
    });

    // Broadcast to all global Web UI clients
    broadcastGlobalStealth({ text: fullResponse });

    // Log token usage
    logTokenUsage(token, {
      modelUsed: 'Project Generator (Streaming)',
      extractedText: sanitizedText,
      aiAnswers: fullResponse,
      fileId: filename,
      filePath: filePath
    });

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (deleteError) {
      console.error('Error deleting image file:', deleteError);
    }

    res.end();

  } catch (error) {
    console.error('Streaming error:', error);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    } catch (e) {
      // Response already closed
    }
    try {
      // We can't access filePath block scoped var cleanly here without moving it up, so doing best-effort cleanup where possible. 
      // Instead, I'll extract it dynamically from the error scope if feasible, or let it fall back.
      // Easiest is just ensuring we try to clean it at the end of the success path.
    } catch (e) {}
  }
});

// =================== ERROR DEBUGGING STREAMING ENDPOINT ===================
app.post('/solve-error-base64-stream', async (req, res) => {
  try {
    const { image, contextHistory } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, error: 'Image data is required' });
    }

    const token = req.headers['premium-token'];

    // Check for missing keys early
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('CRITICAL: OPENROUTER_API_KEY is missing in environment variables.');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'API Keys missing on server. Please check Railway Variables.' }));
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Helper to send SSE events
    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // --- STEP 1: VISION EXTRACTION (non-streaming, fast) ---
    sendSSE('status', { message: '🔍 Extracting text from screenshot...' });

    // Use global uploadDir (already configured for Vercel /tmp at top of file)
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filename = `screenshot-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
    const filePath = path.join(uploadDir, filename);

    let base64Data = image.startsWith('data:image') ? image.split(',')[1] : image;
    fs.writeFileSync(filePath, base64Data, "base64");

    console.log('Starting Native Vision extraction with Gemini 2.5 Flash...');
    const visionModel = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    let extractedQuestion = "";
    try {
      const visionResponse = await visionModel.invoke([
        {
          role: "user",
          content: [
            { type: "text", text: VISION_EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } }
          ]
        }
      ]);
      extractedQuestion = visionResponse.content;
      console.log('Vision extraction complete.');
    } catch (visionError) {
      console.error('Vision extraction failed, falling back to Tesseract.js:', visionError);
      extractedQuestion = await performTesseractOCR(base64Data);
      if (!extractedQuestion) {
        sendSSE('error', { message: 'Both Vision and Tesseract OCR failed' });
        res.end();
        return;
      }
    }

    let sanitizedText = extractedQuestion;
    sendSSE('extracted', { text: sanitizedText });

    // --- STEP 2: STREAMING REASONING ---
    sendSSE('status', { message: 'Analyzing error logs and generating fix...' });

    let contextStr = "";
    if (contextHistory && contextHistory.length > 0) {
      contextStr = "Previous context from past screenshots for this session:\n";
      contextHistory.forEach((item, index) => {
        contextStr += `--- Screenshot ${index + 1} ---\nExtracted: ${item.question}\n\n`;
      });
      contextStr += "Use the above context if relevant to the current assignment.\n\n";
    }

    const claudeModel = new ChatOpenAI({
      model: PRIMARY_MODEL,
      temperature: 0.1,
      maxTokens: 16000,
      streaming: true,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    console.log('--- STREAMING: Running Error Debugger (Sonnet 4.6) ---');

    let fullResponse = "";
    let hasStartedStep1 = false;
    let preambleBuffer = "";

    const stream = await claudeModel.stream([
      ["system", DEBUG_MODIFICATION_PROMPT],
      ["user", contextStr + "Here is the project assignment extracted from the screenshot. Analyze the issue and generate the fixed code:\n\n" + sanitizedText]
    ]);

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (!text) continue;

      fullResponse += text;

      // Instantly send real-time chunks to frontend!
      sendSSE('chunk', { text });
    }

    console.log('\n================ STREAMED RESPONSE ================\n');
    console.log(fullResponse);
    console.log(`\n=== Total: ${fullResponse.length} chars ===\n`);

    // Send completion event with metadata
    sendSSE('done', {
      extractedText: sanitizedText,
      modelUsed: 'Error Debugger (Streaming)',
      totalLength: fullResponse.length
    });

    // Broadcast to all global Web UI clients
    broadcastGlobalStealth({ text: fullResponse });

    // Log token usage
    logTokenUsage(token, {
      modelUsed: 'Error Debugger (Streaming)',
      extractedText: sanitizedText,
      aiAnswers: fullResponse,
      fileId: filename,
      filePath: filePath
    });

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (deleteError) {
      console.error('Error deleting image file:', deleteError);
    }

    res.end();

  } catch (error) {
    console.error('Streaming error:', error);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    } catch (e) {
      // Response already closed
    }
  }
});

// =================== BATCH ASSIGNMENT SOLVER (Multi-Screenshot) ===================
app.post('/solve-assignment-batch-stream', async (req, res) => {
  try {
    const { images, contextHistory } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one image is required' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      console.error('CRITICAL: OPENROUTER_API_KEY is missing in environment variables.');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'API Keys missing on server.' }));
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSSE('status', { message: `Extracting text from ${images.length} screenshots...` });

    const visionModel = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    const extractionPromises = images.map(async (img, index) => {
      let base64Data = img.startsWith('data:image') ? img.split(',')[1] : img;
      try {
        const visionResponse = await visionModel.invoke([
          {
            role: "user",
            content: [
              { type: "text", text: VISION_EXTRACTION_PROMPT },
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } }
            ]
          }
        ]);
        sendSSE('status', { message: `Extracted screenshot ${index + 1}/${images.length}` });
        return { index, text: visionResponse.content, success: true };
      } catch (err) {
        console.error(`Vision extraction failed for image ${index + 1}:`, err.message);
        const ocrText = await performTesseractOCR(base64Data);
        return { index, text: ocrText || `[Failed to extract text from screenshot ${index + 1}]`, success: !!ocrText };
      }
    });

    const extractionResults = await Promise.all(extractionPromises);
    extractionResults.sort((a, b) => a.index - b.index);

    const combinedText = extractionResults
      .map((r, i) => `--- SCREENSHOT ${i + 1} of ${images.length} ---\n${r.text}`)
      .join('\n\n');

    sendSSE('extracted', { text: combinedText, count: images.length });
    sendSSE('status', { message: 'Generating complete project code...' });

    let contextStr = "";
    if (contextHistory && contextHistory.length > 0) {
      contextStr = "Previous context from this session:\n";
      contextHistory.forEach((item, index) => {
        contextStr += `--- Context ${index + 1} ---\n${item.question}\n\n`;
      });
      contextStr += "Use the above context if relevant.\n\n";
    }

    const claudeModel = new ChatOpenAI({
      model: PRIMARY_MODEL,
      temperature: 0.1,
      maxTokens: 64000,
      streaming: true,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    console.log(`--- BATCH ASSIGNMENT: ${images.length} screenshots, ${combinedText.length} chars of extracted text ---`);

    let fullResponse = "";
    const stream = await claudeModel.stream([
      ["system", ASSIGNMENT_BATCH_PROMPT],
      ["user", contextStr + "Here is the COMPLETE assignment extracted from " + images.length + " screenshots. Analyze everything and generate the full project:\n\n" + combinedText]
    ]);

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (!text) continue;
      fullResponse += text;
      sendSSE('chunk', { text });
    }

    console.log(`\n=== BATCH ASSIGNMENT COMPLETE: ${fullResponse.length} chars ===\n`);

    sendSSE('done', {
      extractedText: combinedText,
      modelUsed: 'Assignment Solver (Claude Sonnet 4)',
      totalLength: fullResponse.length,
      screenshotCount: images.length
    });

    broadcastGlobalStealth({ text: fullResponse });

    const token = req.headers['premium-token'];
    logTokenUsage(token, {
      modelUsed: 'Assignment Batch Solver (Streaming)',
      extractedText: combinedText,
      aiAnswers: fullResponse,
      screenshotCount: images.length
    });

    res.end();

  } catch (error) {
    console.error('Batch assignment streaming error:', error);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    } catch (e) {
      // Response already closed
    }
  }
});

// Chat endpoint for stealth overlay "Ask anything" chatbox
app.post('/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const chatModel = new ChatOpenAI({
      model: PRIMARY_MODEL,
      temperature: 0.1,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    // Build messages array with context
    const messages = [
      ["system", `You are a senior Node.js/JavaScript engineer assistant interviewing for a 25 LPA role. First, identify if the user's prompt is a "Project Request" (generating full backend API files) or an "Interview/General Question" (explaining concepts, debugging, or DSA).

IF IT IS A PROJECT REQUEST:
- ALL code MUST be Node.js with ES modules (import/export), Express.js, and mysql2/promise.
- NO ORM. Use raw SQL queries with parameterized placeholders only.
- ZERO code comments. Code only.
- ABSOLUTELY ZERO SYNTAX ERRORS. Code MUST run perfectly on the first try. Ensure imports match usage perfectly.
- ENTERPRISE ARCHITECTURE: Strict Routes -> Controllers -> Services separation.
- Implement centralized error handling with a custom \`AppError\` class and a global error middleware.
- Always use asynchronous error wrapping (try/catch -> next(err)).
- Validate input thoroughly before DB operations.
- CRITICAL SETUP OUTPUT: Provide a text block showing the file tree (NO emojis), followed by EXACT \`npm install <dependencies>\` command needed.
- Output complete files using this exact format:
  ### FILE: [path/to/file]
  \`\`\`javascript
  [code]
  \`\`\`
- Be concise. No emojis.

IF IT IS AN INTERVIEW/GENERAL QUESTION:
- Provide a brief, technical explanation suitable for a Senior Engineering interview (3-5 sentences max).
- Provide perfectly accurate, bug-free code snippets clearly. Comments ARE allowed to explain complex logic in these snippets.
- Do NOT output "### FILE:" headers unless explicitly asked to create full files.
- Be highly accurate and concise. No emojis. No filler text.`]
    ];

    if (context && Array.isArray(context)) {
      for (const item of context.slice(-10)) {
        messages.push([item.role, item.content]);
      }
    }
    messages.push(["user", message]);

    const response = await chatModel.invoke(messages);

    res.json({
      success: true,
      answer: response.content
    });
  } catch (error) {
    console.error('Chat endpoint error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =================== STREAMING CHAT ENDPOINT ===================
app.post('/chat-stream', async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const chatModel = new ChatOpenAI({
      model: PRIMARY_MODEL,
      temperature: 0.1,
      streaming: true,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    // Build messages array with context
    const messages = [
      ["system", `You are a senior Node.js/JavaScript engineer assistant interviewing for a 25 LPA role. First, identify if the user's prompt is a "Project Request" (generating full backend API files) or an "Interview/General Question" (explaining concepts, debugging, or DSA).

IF IT IS A PROJECT REQUEST:
- ALL code MUST be Node.js with ES modules (import/export), Express.js, and mysql2/promise.
- HYBRID DB APPROACH: Use Sequelize ORM for basic models/CRUD, but you MUST use raw SQL queries (via sequelize.query) for complex logic/reporting.
- ZERO code comments. Code only.
- ABSOLUTELY ZERO SYNTAX ERRORS. Code MUST run perfectly on the first try. Ensure imports match usage perfectly.
- ENTERPRISE ARCHITECTURE: Strict Routes -> Controllers -> Services separation.
- Implement centralized error handling with a custom \`AppError\` class and a global error middleware.
- Always use asynchronous error wrapping (try/catch -> next(err)).
- Validate input thoroughly before DB operations.
- CRITICAL SETUP OUTPUT: Provide a text block showing the file tree (NO emojis), followed by EXACT \`npm install <dependencies>\` command needed.
- Output complete files using this exact format:
  ### FILE: [path/to/file]
  \`\`\`javascript
  [code]
  \`\`\`
- Be concise. No emojis.

IF IT IS AN INTERVIEW/GENERAL QUESTION:
- Provide a brief, technical explanation suitable for a Senior Engineering interview (3-5 sentences max).
- Provide perfectly accurate, bug-free code snippets clearly. Comments ARE allowed to explain complex logic in these snippets.
- Do NOT output "### FILE:" headers unless explicitly asked to create full files.
- Be highly accurate and concise. No emojis. No filler text.`]
    ];
    if (context && Array.isArray(context)) {
      for (const item of context.slice(-10)) {
        messages.push([item.role, item.content]);
      }
    }
    messages.push(["user", message]);

    console.log('--- STREAMING CHAT: Starting stream ---');
    let fullResponse = "";

    const stream = await chatModel.stream(messages);

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (!text) continue;
      fullResponse += text;
      sendSSE('chunk', { text });
    }

    sendSSE('done', { totalLength: fullResponse.length });
    console.log(`--- STREAMING CHAT: Done (${fullResponse.length} chars) ---`);

    // Broadcast to all global Web UI clients
    broadcastGlobalStealth({ text: fullResponse });

    res.end();

  } catch (error) {
    console.error('Chat stream error:', error.message);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    } catch (e) { /* already closed */ }
  }
});

// New endpoint to handle base64 image data with Google Gemini AI
app.post('/solve-mcqs-base64-Gemini', async (req, res) => {
  const endpointStartTime = Date.now();
  console.log('=== /solve-mcqs-base64-Gemini Endpoint Timing ===');

  try {
    const { image, contextHistory } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }

    // Get token from premium-token header (required for this endpoint)
    const token = req.headers['premium-token'];

    // Check if token is provided
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Premium token is required for this endpoint'
      });
    }

    // Validate token exists and has remaining uses
    let tokenData = null;

    if (tokenModelMap.has(token)) {
      tokenData = tokenModelMap.get(token);
    }

    // If token not found or no remaining uses, deny access
    if (!tokenData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired premium token'
      });
    }

    if (tokenData.count <= 0) {
      return res.status(401).json({
        success: false,
        error: 'Premium token has no remaining uses'
      });
    }

    // Generate a unique filename
    const filename = `screenshot - ${Date.now()} -${Math.round(Math.random() * 1E9)}.png`;
    const filePath = path.join(uploadDir, filename);

    // If image is already a data URL, extract the base64 data
    // Otherwise, assume it's base64 data
    let base64Data;
    if (image.startsWith('data:image')) {
      base64Data = image.split(',')[1];
    } else {
      base64Data = image;
    }

    // Save the image file
    fs.writeFileSync(filePath, base64Data, "base64");

    // --- STEP 1: NATIVE VISION EXTRACTION (Gemini 2.5 Flash) ---
    console.log('Starting Native Vision extraction with Gemini 2.5 Flash...');
    const visionModel = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    let extractedQuestion = "";
    try {
      const visionResponse = await visionModel.invoke([
        {
          role: "user",
          content: [
            { type: "text", text: "Find any MCQ questions in this text and provide the exact text. If it is an image of a diagram or chart, describe it briefly so I can solve it." },
            { type: "image_url", image_url: { url: `data: image / png; base64, ${base64Data} ` } }
          ]
        }
      ]);
      extractedQuestion = visionResponse.content;
      console.log('Vision extraction complete.');
    } catch (visionError) {
      console.error('Vision extraction failed, falling back to Tesseract.js:', visionError);
      extractedQuestion = await performTesseractOCR(base64Data);
      if (!extractedQuestion) {
        throw new Error('Both Vision and Tesseract OCR failed');
      }
    }

    // Determine reasoning model based on token
    const modelName = await getModelForToken(token);

    // Create model instance
    const model = new ChatGroq({
      model: modelName,
      temperature: 0.3,
      apiKey: process.env.GROQ_API_KEY,
    });

    // --- STEP 2: OCR SANITATION PASS ---
    // (Disabled because Gemini 2.5 Flash Vision OCR is virtually flawless. Skipping saves ~1-2 seconds of latency)
    let sanitizedText = extractedQuestion; // Pass raw text directly to Reasoning Phase

    // --- STEP 3: REASONING & SOLVING (Auto-Router: DeepSeek Free vs Kimi) ---
    let aiAnswers = null;

    let actualModelUsed = PRIMARY_MODEL;
    try {
      // Build context string from history if provided
      let contextStr = "";
      if (contextHistory && contextHistory.length > 0) {
        contextStr = "Previous context from past debug screenshots for this session:\n";
        contextHistory.forEach((item, index) => {
          contextStr += `-- - Image / Debug Log ${index + 1} ---\nContent: ${item.question} \n\n`;
        });
        contextStr += "Please use the above context to inform your debugging if relevant. "
      }

      const modelsToTry = [
        { id: PRIMARY_MODEL, provider: "openrouter" },
        { id: FALLBACK_MODEL, provider: "openrouter" }
      ];

      let success = false;
      for (const modelEntry of modelsToTry) {
        try {
          console.log(`Calling Reasoning model(${modelEntry.id})...`);
          const aiCallStartTime = Date.now();

          let reasoningModel = new ChatOpenAI({
            model: modelEntry.id,
            temperature: 1,
            maxTokens: 16000,
            modelKwargs: { reasoning: { effort: "high" } },
            apiKey: process.env.OPENROUTER_API_KEY,
            configuration: {
              baseURL: "https://openrouter.ai/api/v1",
              defaultHeaders: {
                "HTTP-Referer": RAILWAY_URL,
                "X-Title": "Windows V1",
              }
            }
          });

          const response = await reasoningModel.invoke([
            ["system", DEBUG_MODIFICATION_PROMPT],
            ["user", contextStr + "Current extract from vision model (error log or broken code):\n" + sanitizedText]
          ]);

          const aiCallEndTime = Date.now();
          console.log(`AI Reasoning call time(${modelEntry.id}): ${aiCallEndTime - aiCallStartTime} ms`);

          if (response && response.content) {
            aiAnswers = response.content;
            actualModelUsed = modelEntry.id;
            success = true;
            break;
          }
        } catch (modelError) {
          console.warn(`Reasoning model ${modelEntry.id} failed: `, modelError.message);
        }
      }

      if (!success) {
        throw new Error("All reasoning models (including fallbacks) failed.");
      }
    } catch (aiError) {
      console.error('AI reasoning error:', aiError);
      aiAnswers = "AI reasoning failed: " + aiError.message;
    }

    // Prepare the response
    const responseJson = {
      success: true,
      message: 'Image processed with Multi-Pass Native Vision successfully',
      aiAnswers: aiAnswers,
      extractedText: sanitizedText,
      modelUsed: `Vision: Gemini 2.5 Flash, Logic: ${actualModelUsed} `
    };

    console.log("Processed base64 image with ChatGPT model");
    console.log(aiAnswers);

    // Log token usage
    logTokenUsage(token, {
      modelUsed: actualModelUsed,
      extractedText: sanitizedText,
      aiAnswers: aiAnswers,
      fileId: filename,
      filePath: filePath
    });

    const endpointEndTime = Date.now();
    console.log(`Total / solve - mcqs - base64 - Gemini endpoint time: ${endpointEndTime - endpointStartTime} ms`);
    console.log('===================================================');

    // Send the response
    res.json(responseJson);

    // Broadcast to all global Web UI clients
    broadcastGlobalStealth({ text: aiAnswers });

    // Delete the uploaded image file after sending the response
    try {
      fs.unlinkSync(filePath);
      console.log('Deleted uploaded image file:', filePath);
    } catch (deleteError) {
      console.error('Error deleting image file:', deleteError);
    }

  } catch (error) {
    console.error('Error processing base64 image with ChatGPT:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process image with ChatGPT: ' + error.message
    });
  }
});

// Endpoint to add/update token model mapping (for administration)
app.post('/admin/token-model', async (req, res) => {
  try {
    const { token, model, count } = req.body;

    if (!token || !model || count === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Token, model, and count are required'
      });
    }

    // Store token data in memory
    tokenModelMap.set(token, { model, count: parseInt(count) });

    res.json({
      success: true,
      message: 'Token model mapping updated successfully'
    });
  } catch (error) {
    console.error('Error updating token model mapping:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update token model mapping: ' + error.message
    });
  }
});

// New endpoint to add a premium token with best model
app.post('/admin/add-premium-token', async (req, res) => {
  try {
    const { token, count } = req.body;

    if (!token || count === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Token and count are required'
      });
    }

    const model = "moonshotai/kimi-k2-instruct-0905";

    // Store token data in memory
    tokenModelMap.set(token, { model, count: parseInt(count) });

    res.json({
      success: true,
      message: 'Premium token with best model added successfully',
      token,
      model,
      count: parseInt(count)
    });
  } catch (error) {
    console.error('Error adding premium token:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add premium token: ' + error.message
    });
  }
});

// Endpoint to get token model mapping info (for administration)
app.get('/admin/token-model/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!tokenModelMap.has(token)) {
      return res.status(404).json({
        success: false,
        error: 'Token not found'
      });
    }

    const tokenData = tokenModelMap.get(token);

    res.json({
      success: true,
      token,
      model: tokenData.model,
      count: tokenData.count
    });
  } catch (error) {
    console.error('Error retrieving token model mapping:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve token model mapping: ' + error.message
    });
  }
});

// Endpoint to create Razorpay order
app.post('/create-order', async (req, res) => {
  try {
    const { email, amount, plan, uses } = req.body;

    if (!email || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Email and amount are required'
      });
    }

    // Create order options
    const options = {
      amount: amount, // Amount in paise from request
      currency: 'INR',
      receipt: 'receipt_' + Date.now(),
      notes: {
        email: email,
        plan: plan || 'Pro Plan',
        uses: uses || 50
      }
    };

    // Create order
    const order = await razorpay.orders.create(options);

    // Add Razorpay key ID to the response
    order.razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    order.email = email;

    res.json({
      success: true,
      order: order
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create order: ' + error.message
    });
  }
});

// Endpoint to verify payment
app.post('/verify-payment', async (req, res) => {
  try {
    const { paymentResponse, email, plan, amount, uses } = req.body;

    if (!paymentResponse || !email) {
      return res.status(400).json({
        success: false,
        error: 'Payment response and email are required'
      });
    }

    // Verify payment signature
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentResponse;

    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generatedSignature = hmac.digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Payment verification failed'
      });
    }

    // Determine token count based on plan or uses parameter
    let tokenCount = 50; // Default for Pro Plan
    if (uses) {
      tokenCount = uses;
    } else if (plan === 'Premium Plan' || amount === 6900) {
      tokenCount = 100;
    } else if (plan === 'Pro Plan' || amount === 3900) {
      tokenCount = 50;
    }

    // Payment verified, create premium token
    const token = 'premium_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    const modelName = "moonshotai/kimi-k2-instruct-0905"; // Best model for Premium Users

    // Store token data in memory
    tokenModelMap.set(token, { model: modelName, count: tokenCount });

    // Send email with token
    try {
      await sendTokenEmail(email, token);

      res.json({
        success: true,
        message: 'Payment verified successfully. Your premium token has been sent to your email.',
        token: token
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Still respond with success since payment was verified, but note email issue
      res.json({
        success: true,
        message: 'Payment verified successfully. However, there was an issue sending the email. Please contact support with your payment ID for your token.',
        token: token
      });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify payment: ' + error.message
    });
  }
});

// Test endpoint for sending token email
app.post('/test-email', async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({
        success: false,
        error: 'Email and token are required'
      });
    }

    await sendTokenEmail(email, token);

    res.json({
      success: true,
      message: 'Test email sent successfully'
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test email: ' + error.message
    });
  }
});

// Endpoint to get logs for a premium token
app.get('/getlogs/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Validate token exists
    if (!tokenModelMap.has(token)) {
      return res.status(404).json({
        success: false,
        error: 'Token not found'
      });
    }

    // Get logs for this token
    let logs = [];
    if (tokenLogs.has(token)) {
      logs = tokenLogs.get(token);
    }

    res.json({
      success: true,
      logs: logs
    });
  } catch (error) {
    console.error('Error retrieving token logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve token logs: ' + error.message
    });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Windows V1 API' });
});

// Endpoint to download the windows-v1-windows.zip file

// ===== AUDIO TRANSCRIPTION & CLASSIFICATION ENDPOINTS =====

// Initialize Groq SDK for Whisper lazily
let groqClient = null;
if (process.env.GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
} else {
  console.warn('GROQ_API_KEY not set — audio transcription endpoints will be unavailable.');
}

// In-memory store for conversation context per session
const audioSessionContext = new Map();

// POST /transcribe-audio — Receives base64 audio chunk, returns transcription
app.post('/transcribe-audio', async (req, res) => {
  try {
    const { audio, sessionId } = req.body;

    if (!audio) {
      return res.status(400).json({ success: false, error: 'Audio data is required' });
    }

    // Convert base64 audio to a temporary file (Whisper needs a file)
    const tempFilename = `audio - ${Date.now()} -${Math.round(Math.random() * 1E9)}.wav`;
    const tempFilePath = path.join(os.tmpdir(), tempFilename);

    // Decode base64 and write to temp file
    const audioBuffer = Buffer.from(audio, 'base64');
    fs.writeFileSync(tempFilePath, audioBuffer);

    console.log(`Transcribing audio chunk(${(audioBuffer.length / 1024).toFixed(1)}KB)...`);

    // Send to Groq Whisper for transcription
    const transcription = await groqClient.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
      language: 'en',
      response_format: 'json'
    });

    // Clean up temp file
    try { fs.unlinkSync(tempFilePath); } catch (e) { /* ignore */ }

    const transcribedText = transcription.text || '';
    console.log('Transcription:', transcribedText.substring(0, 100) + (transcribedText.length > 100 ? '...' : ''));

    // Update session transcript buffer
    const sid = sessionId || 'default';
    if (!audioSessionContext.has(sid)) {
      audioSessionContext.set(sid, { transcript: '', lastQuestion: '', lastAnswer: '' });
    }
    const session = audioSessionContext.get(sid);
    session.transcript += ' ' + transcribedText;

    // Keep only last ~3000 chars (~3 min of speech) for better context
    if (session.transcript.length > 3000) {
      session.transcript = session.transcript.substring(session.transcript.length - 3000);
    }

    res.json({
      success: true,
      text: transcribedText,
      fullTranscript: session.transcript.trim()
    });

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ success: false, error: 'Transcription failed: ' + error.message });
  }
});

// POST /classify-and-answer — Classifies transcript and generates answers
app.post('/classify-and-answer', async (req, res) => {
  try {
    const { transcript, sessionId } = req.body;

    if (!transcript || transcript.trim().length === 0) {
      return res.json({ success: true, type: 'conversation', question: null, answer: null });
    }

    const sid = sessionId || 'default';
    const session = audioSessionContext.get(sid) || { transcript: '', lastQuestion: '', lastAnswer: '' };

    // STEP 1: Classify the transcript
    const classifyModel = new ChatGroq({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      apiKey: process.env.GROQ_API_KEY,
    });

    const classifyResponse = await classifyModel.invoke([
      ["system", `You are an expert interview speech classifier.You are listening to a LIVE TECHNICAL INTERVIEW.Analyze the transcript and detect if the interviewer is asking a question.

You MUST respond with ONLY a valid JSON object(no markdown, no code blocks) in this exact format:
{ "type": "<type>", "question": "<the cleaned-up question if detected, or null>" }

Types:
- "conversation" — ONLY pure chitchat, greetings("hi", "how are you"), scheduling talk, or completely unrelated non - technical talk
  - "theory_question" — conceptual / theory question about CS / programming(e.g. "What is polymorphism?", "Explain how HashMap works", "Tell me about SOLID principles", "What do you know about multithreading?")
    - "coding_question" — asking to write code, implement a function, or solve a coding problem
      - "backend_question" — asking about data structures / algorithms(e.g. "Reverse a linked list", "Find shortest path")
        - "backend_followup" — a follow - up twist to a previous question(e.g. "Now do it without extra space", "What if the list is doubly linked?")

CRITICAL — Interviewers do NOT always ask questions directly.They often use INDIRECT phrasing such as:
- "Tell me about..." / "Can you explain..."
  - "So what happens when..." / "Walk me through..."
  - "Do you know what is..." / "Have you heard of..."
  - "What do you understand by..." / "How would you describe..."
  - "Let's talk about..." / "Let's move to..."
  - "So basically..." followed by a topic
    - Naming a topic directly, e.g.just saying "abstraction" or "encapsulation" or "multithreading" — this IS a question asking you to explain it
      - "Give me the answer for X" / "Explain X"
ALL of these are questions and should be classified as theory_question, coding_question, or backend_question — NOT conversation.

When in doubt between "conversation" and a question type, LEAN TOWARDS classifying as a question.It's better to answer an unnecessary question than to miss a real one.

If the transcript has poor transcription(missing words, garbled text), try to INFER what the interviewer is asking from context and keywords.

For the "question" field: clean up the question — fix transcription errors, reconstruct the full question from fragments.Don't just copy garbled text.

Previous question context: ${session.lastQuestion || 'None'}
Previous answer context: ${session.lastAnswer ? session.lastAnswer.substring(0, 200) : 'None'} `],
      ["user", "Latest transcript to classify:\n" + transcript.substring(transcript.length - 800)]
    ]);

    let classification;
    try {
      // Try to parse JSON from the response, handling possible markdown wrapping
      let rawContent = classifyResponse.content.trim();
      rawContent = rawContent.replace(/^```json\s * /i, '').replace(/```$/i, '').trim();
      classification = JSON.parse(rawContent);
    } catch (parseError) {
      console.error('Classification parse error:', parseError.message, 'Raw:', classifyResponse.content);
      return res.json({ success: true, type: 'conversation', question: null, answer: null });
    }

    console.log('Classification:', JSON.stringify(classification));

    // If it's just conversation, return early
    if (classification.type === 'conversation' || !classification.question) {
      return res.json({ success: true, type: 'conversation', question: null, answer: null });
    }

    // STEP 2: Generate answer based on type
    const answerModel = new ChatOpenAI({
      model: "openai/o3-mini",
      temperature: 0.3,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": RAILWAY_URL,
          "X-Title": "Windows V1",
        }
      }
    });

    let systemPrompt = '';
    if (classification.type === 'theory_question') {
      systemPrompt = `You are a senior software engineer helping someone answer a technical interview question.Give a clear, concise, technically accurate answer.

Format your response like this:

DEFINITION:
[1 - 2 sentences — precise technical definition]

KEY POINTS:
-[Point 1 — technical detail]
  - [Point 2 — technical detail]
  - [Point 3 — technical detail]
  - [Add more if needed, keep each point to 1 sentence]

TYPES(if applicable):
  -[Type 1]: [brief explanation]
    - [Type 2]: [brief explanation]

EXAMPLE:
[Short, clean code example(10 - 20 lines max) demonstrating the concept.Use C++ unless the question specifies another language.No markdown code blocks — raw code only.]

Rules:
- Be TECHNICAL and PRECISE — this is for a real interview, not a tutorial
  - Use proper CS terminology
    - NO emojis, NO markdown formatting
      - NO analogies like "think of it like a TV remote" — keep it professional
        - Keep total response under 250 words(excluding code)
          - If the concept has types / categories, list them
            - The code example should be simple but technically correct
              - Write like a confident engineer explaining to another engineer`;
    } else if (classification.type === 'coding_question' || classification.type === 'backend_question') {
      systemPrompt = PROJECT_GENERATOR_PROMPT;
    } else if (classification.type === 'backend_followup') {
      systemPrompt = `You are an expert competitive programmer.The interviewer asked a FOLLOW - UP TWIST to a previous question.CRITICAL: You are solving a LIVE ONLINE ASSESSMENT TEST.You MUST perform perfectly.Provide strictly optimal code that passes all hidden test cases immediately.There are no second chances.

Original question: ${session.lastQuestion}
Previous answer(summary): ${session.lastAnswer ? session.lastAnswer.substring(0, 300) : 'N/A'}

Format your response EXACTLY like this with emoji headers:

🔄 TWIST: [Problem Title](FOLLOW - UP)

🧠 WHAT CHANGED
[2 - 3 lines explaining what the twist changes about the original problem]

🟢 New Approach([Technique Name]) ⭐
🧠 CORE INTUITION
[Explain the updated strategy step by step]

🔥 NEW GOLDEN RULE
[State the one - line rule that drives the modified algorithm]

❓ WHY this works
[Explain why the new approach handles the twist correctly]

💻 Updated Code(clean + interview ready)
[Complete, updated, working code.Raw code, no markdown blocks.No code comments.Standard 4 - space indentation.]

⏱️ Complexity
Time: O(?) | Space: O(?)

🔍 COMPLETE DRY RUN(INTERVIEW LEVEL)
Example:
[Small example]

[Show EVERY step with actual values]
🟢 Step N
[variable states, calculation, result]

✅ Final Answer
[answer]

🔥 EDGE CASES
[2 - 3 edge cases with short explanations]

Rules:
- Follow this EXACT section structure with emoji headers
  - NO markdown code blocks — raw text only
    - YOU MUST write extremely detailed, line - by - line code comments(using //) EXACTLY matching the simple, step-by-step explanatory style shown in the Container With Most Water example. Every line of logic must have a plain English explanation above it.
      - ⚠️ CRITICAL ⚠️: SKIP the existing 'class' block and the MAIN given method signature.Start directly with the inner logic.You CAN output full method signatures for completely NEW helper functions if needed.
- ⚠️ CRITICAL ⚠️: Write the ABSOLUTE MOST OPTIMAL algorithmic solution theoretically possible incorporating the twist.Your code MUST strictly prevent Time Limit Exceeded(TLE) and Memory Limit Exceeded(MLE) errors.For naturally high - complexity scenarios, write the best approach for that category.Ensure your output perfectly matches any existing skeletons.
- ⚠️ CRITICAL ⚠️: Use highly relevant and descriptive variable names based specifically on the problem context.Avoid generic names like 'res', 'ans', 'temp', or single letters(unless for loop indices).
- ⚠️ HELPER METHODS ⚠️: If you must write helper methods(e.g., for recursion), you MUST explicitly declare them with the 'private' access modifier.For C++, prefer using lambda functions inside the method body.`;
    }

    let userReminder = "";
    if (classification.type === 'coding_question' || classification.type === 'backend_question' || classification.type === 'backend_followup') {
      userReminder = "\n\nCRITICAL REMINDERS:\n1. ⚠️ Use highly descriptive variable names based on the problem context! NO generic names like 'res', 'ans', 'temp', or single letters.\n2. ⚠️ OUTPUT ONLY THE INTERNAL METHOD BODY. No class definitions, no method signatures, no markdown blocks, no trailing closing braces.";
    }

    const answerResponse = await answerModel.invoke([
      ["system", systemPrompt],
      ["user", "Question: " + classification.question + userReminder]
    ]);

    let answer = answerResponse.content || 'Could not generate answer';
    answer = answer.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();

    // Update session context
    session.lastQuestion = classification.question;
    session.lastAnswer = answer;
    // Clear transcript after answering — prevents old questions from bleeding into next classification
    session.transcript = '';
    audioSessionContext.set(sid, session);

    console.log(`Generated ${classification.type} answer(${answer.length} chars)`);

    res.json({
      success: true,
      type: classification.type,
      question: classification.question,
      answer: answer
    });

  } catch (error) {
    console.error('Classify-and-answer error:', error);
    res.status(500).json({ success: false, error: 'Classification failed: ' + error.message });
  }
});

// ===== NEW: MANUAL CHAT ENDPOINT =====
app.post('/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'Message required' });

  try {
    const chatModel = new ChatGroq({
      model: "moonshotai/kimi-k2-instruct-0905",
      temperature: 0.3,
      apiKey: process.env.GROQ_API_KEY,
    });

    const messages = [
      ["system", `You are a senior backend engineer assistant.

Answer in a simple, direct, technical style.

Rules:
- ALL code MUST be Node.js with ES modules, Express.js, and mysql2/promise.
- HYBRID DB APPROACH: Balance using Sequelize ORM with raw SQL queries (sequelize.query) to satisfy both ORM and raw query requirements.
- ZERO code comments. Code only.
- Use async/await everywhere.
- Use proper HTTP status codes.
- try/catch in every function.

If asked to explain a concept: give a brief, technical explanation (3-5 sentences max), then show a concise code example.
If asked to write code: output the complete file.`]
    ];
    // Add context as a separate background message, NOT mixed with the question
    if (context && Array.isArray(context) && context.length > 0) {
      const contextSummary = context.map(m => m.content).join('\n');
      messages.push(["system", "Background context (ignore unless the user refers to it): " + contextSummary]);
    }

    // User's typed question is ALWAYS the final message
    messages.push(["user", message]);

    const response = await chatModel.invoke(messages);

    res.json({
      success: true,
      answer: response.content || 'No response generated.'
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Only listen locally or on Railway/Render (not on Vercel serverless)
if (!process.env.VERCEL) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`MCQ Solver Server is running on port ${port}`);
    console.log(`Token system: In - memory Map(${tokenModelMap.size} tokens loaded)`);
  });
}

// Vercel serverless function export
export default (req, res) => {
  // Apply CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, premium-token');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return app(req, res);
};

