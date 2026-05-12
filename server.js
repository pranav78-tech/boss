import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatOpenAI } from "@langchain/openai";
import Razorpay from 'razorpay';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import Tesseract from 'tesseract.js';
import Groq from 'groq-sdk';
import os from 'os';

// Load environment variables
dotenv.config();

const RAILWAY_URL = 'https://mcq-solver-server-production-410f.up.railway.app';

const DEBUG_MODIFICATION_PROMPT = `You are an elite competitive programmer and debugging expert.
The user has captured a screenshot of their code with an error.

YOU MUST NOT REWRITE THE ENTIRE FUNCTION. NEVER output the full class or method block.
Use EXACTLY this 4-part format. Do not use bold headers, just the numbers:

1. The Bug:
[1 short sentence identifying the exact issue]

2. Incorrect Code:
\`\`\`cpp
// Copy ONLY the 1-2 lines that are wrong.
// ^^^ Use ^ symbols underneath the exact typo/error to visually point to it.
\`\`\`

3. The Fix:
\`\`\`cpp
// Write ONLY the 1-2 corrected lines. DO NOT write the rest of the function.
\`\`\`

4. Why:
[1 sentence explaining why this specific fix works]`;

const VISION_EXTRACTION_PROMPT = "Extract ALL text from this image precisely. This is a coding problem, MCQ, or SQL challenge. Extract: problem title, full statement, input/output format, constraints, examples, boilerplate code, and language shown. Preserve all details exactly.";

// =================== DSA FORCE PROMPT (No Auto-Detection — Always DSA) ===================
const DSA_FORCE_PROMPT = `You are an elite interview coach who thinks and speaks like a senior engineer at Google.
The user has sent a screenshot of a DSA / coding problem.
SKIP all auto-detection. Treat EVERYTHING as a DSA CODING PROBLEM and respond in the EXACT 6-section format below.

=== STEALTH INTERVIEW FORMAT — MANDATORY ===

Problem:

Input: [describe input]

Output: [describe output]

Goal: [1 sentence core task]

Approach:
[Explain the solution exactly like a strong candidate speaking during a real technical interview.]

The tone should feel: confident, natural, concise, and technically strong.

MUST start by explaining how you will approach the problem from the beginning using simple, clear language.

The explanation must be a direct verbal map of the Dry Run and Code sections.

The approach must:

Explain the initial strategy and logic.

Detail how you will move through the data (pointers, loops, or recursion).

Describe what you are looking for or calculating at each step.

End with how the final answer is captured.

Avoid robotic template phrases like: "I'll use X technique", "Brute force is inefficient", "We optimize this", "The intuition is".

Instead, write naturally like: "So I'm thinking I'll start by...", "While I move through the list, I'll keep track of...", "Once that's done, I can simply...", "Then I'll just return the...".

MUST FORMAT AS 3-5 SHORT BULLET POINTS.

Every sentence should progress the reasoning forward.
(DO NOT mention time or space complexity here).

Code:
"I'll follow the function signature given."

C++
// Write COMPLETE optimal C++ solution here.
// RULE 1: Use SHORT, CLEAR names (no i, j, l, r). Use names like 'index', 'left', 'current'.
// RULE 2: EVERY single line of code MUST have a short comment ABOVE it.
// RULE 3: Comments act as a teleprompter. They must be exactly what you would SAY out loud while typing the line. Keep them highly natural and conversational.
// RULE 4: No chaining, no condensed logic. Handle edge cases.
// RULE 5: ALGORITHM LOGIC: Whenever possible, implement the exact optimal logic and algorithmic structure taught by "Take U Forward" (Striver).

Complexity:

Time: O(...) because [1 short sentence]

Space: O(...) since [1 short sentence]

Dry Run:
Example: [Pick a clear example]

Start: [initial variables and their starting values]

Step-by-Step Trace: [Explicitly show the variable changes and loop iterations matching the Approach and Code logic]

Final Answer: [final returned value]

Edge Case:
Example: [Pick edge case]

[1 sentence trace matching the specific logic for this case]
"This confirms the approach works even in tricky cases."

⚠️ ABSOLUTE RULES — NEVER BREAK THESE:

DEFAULT LANGUAGE IS C++. Match the platform language ONLY if boilerplate is visible.

ZERO filler. No motivational phrases. Pure technical content only.

Code MUST be 100% correct and pass ALL hidden test cases.

Group logical chunks with natural, Capitalized comments.

NEVER use single-letter names: i, j, l, r, n, m, x, y. Use descriptive names like 'pos', 'start', 'total'.

Comments must be SPEAKABLE — written as if talking to an interviewer.

NEVER use the word "bottleneck".

DO NOT USE MARKDOWN TABLES in dry runs. Use only hyphen bullet points.

DO NOT skip any of the 6 sections even if the problem seems simple.`;

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

// =================== DSA SCREENSHOT SOLVER — FORCE DSA FORMAT ===================
app.post('/solve-dsa-base64-stream', async (req, res) => {
  try {
    const { image, contextHistory } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, error: 'Image data is required' });
    }

    const token = req.headers['premium-token'];

    if (!process.env.OPENROUTER_API_KEY) {
      console.error('CRITICAL: OPENROUTER_API_KEY is missing.');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'API Keys missing on server.' }));
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // --- STEP 1: VISION EXTRACTION ---
    sendSSE('status', { message: '🔍 Reading DSA problem from screenshot...' });

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `dsa-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
    const filePath = path.join(uploadDir, filename);

    let base64Data = image.startsWith('data:image') ? image.split(',')[1] : image;
    fs.writeFileSync(filePath, base64Data, 'base64');

    console.log('[DSA SOLVE] Starting 3-tier vision extraction...');
    const visionResult = await extractTextWithVision(base64Data, '[DSA SOLVE]');
    if (!visionResult) {
      sendSSE('error', { message: 'All vision extraction methods failed (Gemini, GPT-4o, Tesseract).' });
      res.end();
      return;
    }
    let extractedQuestion = visionResult.text;
    console.log(`[DSA SOLVE] Extracted via ${visionResult.model}.`);

    sendSSE('extracted', { text: extractedQuestion });
    sendSSE('status', { message: '🧠 Generating full DSA solution (6 sections)...' });

    // --- STEP 2: STREAMING DSA SOLUTION (FORCED FORMAT) ---
    let contextStr = '';
    if (contextHistory && contextHistory.length > 0) {
      contextStr = 'Previous session context (use only if relevant):\n';
      contextHistory.forEach((item, idx) => {
        contextStr += `--- Context ${idx + 1} ---\n${item.question}\n\n`;
      });
      contextStr += '\n';
    }

    const dsaModel = new ChatOpenAI({
      model: PRIMARY_MODEL,
      temperature: 0.1,
      maxTokens: 16000,
      streaming: true,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': RAILWAY_URL,
          'X-Title': 'Windows V1',
        }
      }
    });

    console.log('[DSA SOLVE] Streaming full 6-section DSA response...');
    let fullResponse = '';

    const stream = await dsaModel.stream([
      ['system', DSA_FORCE_PROMPT],
      ['user', contextStr + 'Solve the following DSA problem extracted from a screenshot. Apply the FULL 6-section format:\n\n' + extractedQuestion]
    ]);

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (!text) continue;
      fullResponse += text;
      sendSSE('chunk', { text });
    }

    console.log(`\n[DSA SOLVE] Complete — ${fullResponse.length} chars\n`);
    console.log('\n================ STREAMED RESPONSE ================\n');
    console.log(fullResponse);
    console.log('\n===================================================\n');

    sendSSE('done', {
      extractedText: extractedQuestion,
      modelUsed: 'DSA Force Solver (Claude Opus)',
      totalLength: fullResponse.length
    });

    broadcastGlobalStealth({ text: fullResponse });

    logTokenUsage(token, {
      modelUsed: 'DSA Force Solver',
      extractedText: extractedQuestion,
      aiAnswers: fullResponse,
      fileId: filename
    });

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('[DSA SOLVE] Cleanup error:', e.message);
    }

    res.end();

  } catch (error) {
    console.error('[DSA SOLVE] Streaming error:', error.message);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    } catch (e) { /* already closed */ }
  }
});

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

const CHAT_COACH_PROMPT = `You are an interview coach who teaches like a senior engineer at Google.
Your goal is to help the user speak, think, and code like a confident engineer in a real interview.

AUTO-DETECTION RULE:
- If the user provides code and asks to find a bug or fix it -> Treat as DEBUGGING.
- If the text contains a new coding problem or boilerplate -> Treat as DSA CODING PROBLEM.
- If the text asks "what is", "explain", "difference between", or a concept name -> Treat as THEORY QUESTION.
- If it's SQL -> Treat as SQL (write the query and explain clauses).

=== DEBUGGING ===
If the user provides buggy code, YOU MUST NOT REWRITE THE ENTIRE FUNCTION. NEVER output the full class or method block.
Use EXACTLY this 4-part format. Do not use bold headers, just the numbers:

1. The Bug:
[1 short sentence identifying the exact issue]

2. Incorrect Code:
\`\`\`cpp
// Copy ONLY the 1-2 lines that are wrong.
// ^^^ Use ^ symbols underneath the exact typo/error to visually point to it.
\`\`\`

3. The Fix:
\`\`\`cpp
// Write ONLY the 1-2 corrected lines. DO NOT write the rest of the function.
\`\`\`

4. Why:
[1 sentence explaining why this specific fix works]

---

=== DSA / CODING PROBLEM ===

Follow this concise, 6-section stealth script:

1. Problem:
- Input: [describe input]
- Output: [describe output]
- Goal: [1 sentence core task]

2. Approach:
[Explain the solution exactly like a strong candidate speaking during a real technical interview.]
- The tone should feel: confident, natural, concise, and technically strong.
- Do NOT sound like: a teacher, a tutorial, documentation, or a textbook.
- The explanation should feel like walking the interviewer through your thought process in real time.
- The approach must:
  - Start from the key observation
  - Explain the important constraint or insight naturally
  - Introduce the core idea organically
  - Explain the invariant or placement logic if relevant
  - End with how the final answer is obtained
- Avoid robotic template phrases like: "I'll use X technique", "Brute force is inefficient", "We optimize this", "The intuition is".
- Instead, write naturally like: "The key observation here is...", "So we really only care about...", "At that point, I can...", "Once the array is rearranged...", "Then I just scan for...".
- MUST FORMAT AS 3-5 SHORT BULLET POINTS. Do not output a giant paragraph. Bullet points are strictly required for easy reading during the interview.
- Every sentence should progress the reasoning forward.
- The goal is to sound like a genuinely strong interview candidate thinking clearly under pressure.
(DO NOT mention time or space complexity here).

3. Code:
"I'll follow the function signature given."

\`\`\`cpp
// Write COMPLETE optimal C++ solution here.
// RULE 1: Use SHORT, CLEAR names (no i, j).
// RULE 2: EVERY single line of code MUST have a short comment ABOVE it.
// RULE 3: Comments act as a teleprompter. They must be exactly what you would SAY out loud while typing the line. Keep them highly natural and conversational.
// RULE 4: No chaining, no condensed logic. Handle edge cases.
// RULE 5: ALGORITHM LOGIC: Whenever possible, implement the exact optimal logic and algorithmic structure taught by "Take U Forward" (Striver).
\`\`\`

4. Complexity:
- Time: O(...) because [1 short sentence]
- Space: O(...) since [1 short sentence]

5. Dry Run:
Example: [Pick a clear example]
- Start: [initial vars]
- Step 1: [trace]
- Final Answer: [answer]

6. Edge Case:
Example: [Pick edge case]
- [1 sentence trace]
"This confirms the approach works even in tricky cases."

---

=== THEORY / CONCEPT QUESTION ===

Do NOT sound like Wikipedia. Speak like a senior developer explaining it on a whiteboard. Use exactly this format:

🔹 1. The "1-Sentence" Definition
[Exactly 1 sentence explaining what it is in simple terms, no jargon.]

🔹 2. Real-World Example
[1 sentence. Show where this concept appears in a real system or problem. For tools — when a developer reaches for it. For concepts — when/where it naturally occurs in real code or systems.]

🔹 3. Key Properties
- [Bullet 1: most critical property]
- [Bullet 2: memory or performance trade-off]
- [Bullet 3: contrast with the closest alternative]

🔹 4. Code Example (Speakable)
\`\`\`cpp
// A short 5-10 line C++ example showing the concept in action
// Include speakable comments ABOVE every line
// Use highly descriptive variable names
\`\`\`

🔹 5. Typical Follow-up Question
[State the most common follow-up question an interviewer asks about this topic, and give a 1-sentence answer.]

---

⚠️ ABSOLUTE RULES — NEVER BREAK THESE:

1. DEFAULT LANGUAGE IS C++. Match the platform language only if the user explicitly shows boilerplate.
2. ZERO filler text. No emojis inside explanations. No motivational phrases. Pure technical content only.
3. Code MUST be 100% correct and pass all hidden test cases.
4. Group logical chunks with natural, Capitalized comments. DO NOT comment every single line like a robot.
5. NEVER use single-letter names: i, j, l, r, n, m, x, y. Short clear names ARE allowed: left, right, curr, prev, val, target, count, sum, temp, freq, slow, fast, maxLen, minIdx.
6. Comments must be SPEAKABLE — written as if you are talking to an interviewer.
7. NEVER use the word "bottleneck" anywhere in your response.
8. DO NOT USE MARKDOWN TABLES in dry runs. Use only hyphen bullet points.
9. DO NOT skip any of the 6 sections even if the problem seems simple.`;




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

// Model constants — Opus as primary (best reasoning for DSA), Sonnet as fallback (speed)
const PRIMARY_MODEL = "anthropic/claude-opus-4.6";
const FALLBACK_MODEL = "anthropic/claude-sonnet-4.6";
const VISION_FALLBACK_MODEL = "openai/gpt-4o"; // Tier 2: best vision quality + different provider if Google goes down

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

// 3-tier vision extraction: Gemini 2.5 Flash → GPT-4o → Tesseract OCR
async function extractTextWithVision(base64Data, logPrefix = '') {
  const imagePayload = [
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_EXTRACTION_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Data}` } }
      ]
    }
  ];

  // Tier 1: Gemini 2.5 Flash (fastest, cheapest)
  try {
    console.log(`${logPrefix} Tier 1: Trying Gemini 2.5 Flash...`);
    const geminiModel = new ChatOpenAI({
      model: 'google/gemini-2.5-flash',
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: { 'HTTP-Referer': RAILWAY_URL, 'X-Title': 'Windows V1' }
      }
    });
    const response = await geminiModel.invoke(imagePayload);
    console.log(`${logPrefix} Tier 1 SUCCESS: Gemini extracted text.`);
    return { text: response.content, model: 'Gemini 2.5 Flash' };
  } catch (err) {
    console.warn(`${logPrefix} Tier 1 FAILED (Gemini): ${err.message}`);
  }

  // Tier 2: GPT-4o (different provider for resilience)
  try {
    console.log(`${logPrefix} Tier 2: Trying GPT-4o fallback...`);
    const gptModel = new ChatOpenAI({
      model: VISION_FALLBACK_MODEL,
      temperature: 0.0,
      apiKey: process.env.OPENROUTER_API_KEY,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: { 'HTTP-Referer': RAILWAY_URL, 'X-Title': 'Windows V1' }
      }
    });
    const response = await gptModel.invoke(imagePayload);
    console.log(`${logPrefix} Tier 2 SUCCESS: GPT-4o extracted text.`);
    return { text: response.content, model: 'GPT-4o (fallback)' };
  } catch (err) {
    console.warn(`${logPrefix} Tier 2 FAILED (GPT-4o): ${err.message}`);
  }

  // Tier 3: Tesseract OCR (last resort — local, no API dependency)
  try {
    console.log(`${logPrefix} Tier 3: Falling back to Tesseract OCR...`);
    const ocrText = await performTesseractOCR(base64Data);
    if (ocrText) {
      console.log(`${logPrefix} Tier 3 SUCCESS: Tesseract extracted text.`);
      return { text: ocrText, model: 'Tesseract OCR (last resort)' };
    }
  } catch (err) {
    console.warn(`${logPrefix} Tier 3 FAILED (Tesseract): ${err.message}`);
  }

  console.error(`${logPrefix} ALL 3 vision tiers failed.`);
  return null;
}

// App initialization moved to the top of the file to prevent ReferenceError
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

    console.log('[MCQ SOLVE] Starting 3-tier vision extraction...');
    const visionResult = await extractTextWithVision(base64Data, '[MCQ SOLVE]');
    if (!visionResult) {
      sendSSE('error', { message: 'All vision extraction methods failed (Gemini, GPT-4o, Tesseract).' });
      res.end();
      return;
    }
    console.log(`[MCQ SOLVE] Extracted via ${visionResult.model}.`);

    let sanitizedText = visionResult.text;
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
      ["system", CHAT_COACH_PROMPT],
      ["user", contextStr + "Here is the text extracted from the screenshot. Auto-detect the type (DSA/SQL/Theory) and respond in the correct format:\n\n" + sanitizedText]
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
    } catch (e) { }
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

    console.log('[ERROR DEBUG] Starting 3-tier vision extraction...');
    const visionResult = await extractTextWithVision(base64Data, '[ERROR DEBUG]');
    if (!visionResult) {
      sendSSE('error', { message: 'All vision extraction methods failed (Gemini, GPT-4o, Tesseract).' });
      res.end();
      return;
    }
    console.log(`[ERROR DEBUG] Extracted via ${visionResult.model}.`);

    let sanitizedText = visionResult.text;
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

    const extractionPromises = images.map(async (img, index) => {
      let base64Data = img.startsWith('data:image') ? img.split(',')[1] : img;
      const result = await extractTextWithVision(base64Data, `[BATCH img-${index + 1}]`);
      sendSSE('status', { message: `Extracted screenshot ${index + 1}/${images.length} via ${result?.model || 'none'}` });
      return {
        index,
        text: result?.text || `[Failed to extract text from screenshot ${index + 1}]`,
        success: !!result
      };
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
      ["user", contextStr + "Here are the problems extracted from " + images.length + " screenshots. Solve everything:\n\n" + combinedText]
    ]);

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (!text) continue;
      fullResponse += text;
      sendSSE('chunk', { text });
    }

    console.log(`\n=== BATCH ASSIGNMENT COMPLETE: ${fullResponse.length} chars ===\n`);
    console.log('\n================ STREAMED RESPONSE ================\n');
    console.log(fullResponse);
    console.log('\n===================================================\n');

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
      ["system", CHAT_COACH_PROMPT]
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
      ["system", CHAT_COACH_PROMPT]
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

    const model = PRIMARY_MODEL;

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

    // Store token data in memory
    tokenModelMap.set(token, { model: PRIMARY_MODEL, count: tokenCount });

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

    // STEP 1: Classify the transcript (Gemini 2.0 Flash — fast, smart, reliable JSON)
    const classifyModel = new ChatOpenAI({
      model: "google/gemini-2.0-flash",
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

    const classifyResponse = await classifyModel.invoke([
      ["system", `You are an expert interview speech classifier. You are listening to a LIVE TECHNICAL INTERVIEW. Analyze the transcript and detect if the interviewer is asking a question.

You MUST respond with ONLY a valid JSON object (no markdown, no code blocks) in this exact format:
{ "type": "<type>", "question": "<the cleaned-up question if detected, or null>" }

Types:
- "conversation" — ONLY pure chitchat, greetings ("hi", "how are you"), scheduling talk, or completely unrelated non-technical talk
- "theory_question" — conceptual/theory question about CS/programming (e.g. "What is polymorphism?", "Explain how HashMap works")
- "coding_question" — asking to write code, implement a function, or solve a coding problem
- "backend_question" — asking about data structures/algorithms (e.g. "Reverse a linked list", "Find shortest path")
- "backend_followup" — a follow-up twist to a previous question (e.g. "Now do it without extra space")

CRITICAL — Interviewers do NOT always ask questions directly. Indirect phrasing like "Tell me about...", "Walk me through...", "Have you heard of...", or just naming a topic directly — ALL are questions. Classify them accordingly, NOT as conversation.

When in doubt, LEAN TOWARDS classifying as a question. Missing a real question is worse than answering an extra one.

If the transcript has poor transcription, INFER what the interviewer is asking from context and keywords.

For the "question" field: clean up the question — fix transcription errors, reconstruct the full question from fragments.

Previous question context: ${session.lastQuestion || 'None'}
Previous answer context: ${session.lastAnswer ? session.lastAnswer.substring(0, 200) : 'None'}`],
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

    // STEP 2: Generate answer based on type (Claude Opus — best reasoning for interviews)
    const answerModel = new ChatOpenAI({
      model: PRIMARY_MODEL,
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
      systemPrompt = DSA_SOLVER_PROMPT;
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

