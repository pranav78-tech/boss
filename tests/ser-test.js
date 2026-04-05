import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { Groq } from 'groq-sdk';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ChatGroq } from "@langchain/groq";
import { createClient } from 'redis';
import { GoogleGenerativeAI } from "@google/generative-ai";
import Razorpay from 'razorpay';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

// Load environment variables
dotenv.config();

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

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
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
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
          
          <p style="font-size: 16px; color: #555;">Track your usage at: <a href="https://project-final-mu-wine.vercel.app/logs.html" style="color: #007bff; text-decoration: none;">Token Logs Page</a></p>
          
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

// Token-based model selection map (fallback when Redis is not available)
// Structure: { token: { model: 'model-name', count: number } }
const tokenModelMap = new Map();

// In-memory logs storage (in production, this should be replaced with a proper database)
// Structure: { token: [logEntry1, logEntry2, ...] }
const tokenLogs = new Map();

// Redis client initialization
let redisClient = null;
let useRedis = false;

// Try to initialize Redis client with environment variables
try {
  redisClient = createClient({
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: process.env.REDIS_PORT || 6379
    }
  });

  redisClient.on('error', (err) => {
    console.log('Redis Client Error (continuing with fallback)', err);
    useRedis = false;
  });

  // Attempt to connect to Redis
  await redisClient.connect();
  useRedis = true;
  console.log('Successfully connected to Redis');
} catch (error) {
  console.log('Failed to connect to Redis, using in-memory Map as fallback');
  useRedis = false;
}

// Function to get model based on token
async function getModelForToken(token) {
  // If no token is provided, use the default llama model
  if (!token) {
    return "llama-3.3-70b-versatile";
  }

  if (useRedis && redisClient) {
    try {
      const tokenData = await redisClient.get(token);
      if (tokenData) {
        const parsedData = JSON.parse(tokenData);
        if (parsedData.count > 0) {
          // Decrease count by one
          parsedData.count -= 1;
          await redisClient.set(token, JSON.stringify(parsedData));
          return parsedData.model;
        }
      }
    } catch (error) {
      console.error('Redis error:', error);
    }
  } else {
    // Fallback to in-memory Map
    if (tokenModelMap.has(token)) {
      const tokenData = tokenModelMap.get(token);
      if (tokenData.count > 0) {
        // Decrease count by one
        tokenData.count -= 1;
        tokenModelMap.set(token, tokenData);
        return tokenData.model;
      }
    }
  }

  // If token is provided but not found or count is zero, use default llama model
  return "llama-3.3-70b-versatile";
}

// Function to log token usage
function logTokenUsage(token, logEntry) {
  if (!token) return;

  // Add timestamp to log entry
  const logWithTimestamp = {
    ...logEntry,
    timestamp: new Date().toISOString()
  };

  if (useRedis && redisClient) {
    // In a production environment, you might want to store logs in a separate Redis key
    // For now, we'll just keep them in memory
    if (!tokenLogs.has(token)) {
      tokenLogs.set(token, []);
    }
    tokenLogs.get(token).push(logWithTimestamp);
  } else {
    // Fallback to in-memory Map
    if (!tokenLogs.has(token)) {
      tokenLogs.set(token, []);
    }
    tokenLogs.get(token).push(logWithTimestamp);
  }
}

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve index.html explicitly
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'marketing', 'index.html'));
});

// Static file serving
app.use('/', express.static(path.join(process.cwd(), 'marketing')));
app.use('/fonts', express.static(path.join(process.cwd(), 'fonts')));



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
    const modelName = 'openai/gpt-oss-20b';

    if (useRedis && redisClient) {
      // Store token data in Redis with ChatGPT model
      await redisClient.set(token, JSON.stringify({ model: modelName, count: tokenCount }));
    } else {
      // Store token data in memory
      tokenModelMap.set(token, { model: modelName, count: tokenCount });
    }

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

// Endpoint to handle base64 image data directly (no file system operations)
app.post('/solve-mcqs-base64', async (req, res) => {
  try {
    const { image } = req.body;

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

    // If image is already a data URL, extract the base64 data
    // Otherwise, assume it's base64 data
    let base64Data;
    if (image.startsWith('data:image')) {
      base64Data = image.split(',')[1];
    } else {
      base64Data = image;
    }

    // Use Groq SDK for image processing directly
    let aiAnswers = null;
    try {
      console.log('Calling Groq API with image processing...');
      const aiCallStartTime = Date.now();

      const chatCompletion = await groq.chat.completions.create({
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": `Extract and return all text from the image as JSON in this format: {"extractedText": "all text from image", "questionFound": true/false, "question": "the question text if found", "options": ["option A text", "option B text", "option C text", "option D text"]}. Return only valid JSON, no other text.`
              },

              {
                "type": "image_url",
                "image_url": {
                  "url": `data:image/png;base64,${base64Data}`
                }
              }
            ]
          }
        ],
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "temperature": 0,
        "top_p": 1,
        "stream": false,
        "stop": null
      });

      const aiCallEndTime = Date.now();
      console.log(`Groq API call time: ${aiCallEndTime - aiCallStartTime}ms`);

      if (chatCompletion && chatCompletion.choices && chatCompletion.choices[0].message.content) {
        aiAnswers = chatCompletion.choices[0].message.content;
      }
    } catch (aiError) {
      console.error('AI processing error:', aiError);
      aiAnswers = "AI processing failed: " + aiError.message;
    }

    const solverModel = new ChatGroq({
      model: modelName,
      temperature: 0,
      top_p: 1,
      apiKey: process.env.GROQ_API_KEY, // Use environment variable only
    });

    const finalans = await solverModel.invoke([
      ["system", "Find any MCQ questions in this text and provide the answers in the format 'A answer ' without any explanations or theory. If no MCQ questions are found, respond with 'No MCQ questions found.'"],
      ["user", aiAnswers]
    ]);

    // Prepare the response
    const responseJson = {
      success: true,
      message: 'Image processed successfully with Groq AI',
      aiAnswers: finalans.content,
      modelUsed: modelName // Include model info in response
    };

    console.log(aiAnswers);
    console.log("Processed base64 image with Groq image processing");
    console.log(finalans.content);

    // Log token usage
    logTokenUsage(token, {
      modelUsed: modelName,
      aiAnswers: finalans.content,
      fileId: "base64-upload",
      filePath: "in-memory"
    });

    // Send the response
    res.json(responseJson);

  } catch (error) {
    console.error('Error processing base64 image:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process base64 image',
      details: error.message
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

    if (useRedis && redisClient) {
      // Store token data in Redis
      await redisClient.set(token, JSON.stringify({ model, count: parseInt(count) }));
    } else {
      // Store token data in memory
      tokenModelMap.set(token, { model, count: parseInt(count) });
    }

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

// New endpoint to add a premium token with ChatGPT model
app.post('/admin/add-premium-token', async (req, res) => {
  try {
    const { token, count } = req.body;

    if (!token || count === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Token and count are required'
      });
    }

    const model = "openai/gpt-oss-20b";

    if (useRedis && redisClient) {
      // Store token data in Redis with ChatGPT model
      await redisClient.set(token, JSON.stringify({ model, count: parseInt(count) }));
    } else {
      // Store token data in memory
      tokenModelMap.set(token, { model, count: parseInt(count) });
    }

    res.json({
      success: true,
      message: 'Premium token with ChatGPT model added successfully',
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

    let tokenData = null;

    if (useRedis && redisClient) {
      // Retrieve token data from Redis
      tokenData = await redisClient.get(token);
    } else {
      // Retrieve token data from memory
      if (tokenModelMap.has(token)) {
        tokenData = JSON.stringify(tokenModelMap.get(token));
      }
    }

    if (!tokenData) {
      return res.status(404).json({
        success: false,
        error: 'Token not found'
      });
    }

    const parsedData = useRedis ? JSON.parse(tokenData) : JSON.parse(tokenData);

    res.json({
      success: true,
      token,
      model: parsedData.model,
      count: parsedData.count
    });
  } catch (error) {
    console.error('Error retrieving token model mapping:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve token model mapping: ' + error.message
    });
  }
});

// Endpoint to get logs for a premium token
app.get('/getlogs/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Validate token exists
    let tokenData = null;

    if (useRedis && redisClient) {
      // Retrieve token data from Redis
      tokenData = await redisClient.get(token);
    } else {
      // Retrieve token data from memory
      if (tokenModelMap.has(token)) {
        tokenData = JSON.stringify(tokenModelMap.get(token));
      }
    }

    if (!tokenData) {
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

// New endpoint to handle base64 image data with Google Gemini AI
app.post('/solve-mcqs-base64-Gemini', async (req, res) => {
  const endpointStartTime = Date.now();
  console.log('=== /solve-mcqs-base64-vision Endpoint ===');

  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }

    const token = req.headers['premium-token'];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Premium token required'
      });
    }

    // Validate token
    let tokenData = null;

    if (useRedis && redisClient) {
      tokenData = await redisClient.get(token);
    } else {
      if (tokenModelMap.has(token)) {
        tokenData = JSON.stringify(tokenModelMap.get(token));
      }
    }

    if (!tokenData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const parsedData = JSON.parse(tokenData);

    if (parsedData.count <= 0) {
      return res.status(401).json({
        success: false,
        error: 'Token has no remaining uses'
      });
    }

    // Extract base64
    let base64Data;
    if (image.startsWith('data:image')) {
      base64Data = image.split(',')[1];
    } else {
      base64Data = image;
    }

    const modelName = await getModelForToken(token);

    /*
    ==========================
    STEP 1: IMAGE → TEXT (Llama Vision)
    ==========================
    */

    console.log("Calling Llama Vision...");

    const visionResponse = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
Extract the MCQ from the image.

Return JSON ONLY in this format:

{
 "question":"...",
 "context":"any code, equation, or supporting text required to answer the question",
 "options":[
   {"label":"A","text":"..."},
   {"label":"B","text":"..."},
   {"label":"C","text":"..."},
   {"label":"D","text":"..."}
 ]
}

Rules:
- Include full code if present
- Include equations if present
- Include any text needed to solve the question
- Return valid JSON only

`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Data}`
              }
            }
          ]
        }
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0,
      max_tokens: 1000
    });

    const extractedData = visionResponse.choices[0].message.content;

    /*
    ==========================
    STEP 2: SOLVE QUESTION
    ==========================
    */

    const solverModel = new ChatGroq({
      model: modelName,
      temperature: 0,
      top_p: 1,
      apiKey: process.env.GROQ_API_KEY
    });

    const solverPrompt = `
Solve this MCQ.

Question:
${extractedData}

`;

    const answer = await solverModel.invoke([
      ["system", "Find the correct answer for the MCQ and provide the answer in the format 'Label OptionText' without any explanations or theory. For example: 'A answer text'."],
      ["user", solverPrompt]
    ]);

    const finalAnswer = answer.content.trim();

    /*
    ==========================
    RESPONSE FORMAT
    ==========================
    */

    const responseJson = {
      success: true,
      question: extractedData,
      answer: finalAnswer,
      aiAnswers: finalAnswer,
      cursor: `Cursor should select option ${finalAnswer}`,
      modelUsed: modelName
    };

    console.log("Extracted:", extractedData);
    console.log("Answer:", finalAnswer);

    logTokenUsage(token, {
      modelUsed: modelName,
      extractedQuestion: extractedData,
      aiAnswer: finalAnswer,
      fileId: "base64-upload"
    });

    const endpointEndTime = Date.now();
    console.log(`Total endpoint time: ${endpointEndTime - endpointStartTime}ms`);

    res.json(responseJson);

  } catch (error) {
    console.error("Vision solver error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Serve index.html explicitly (moved before static middleware to ensure proper routing)
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'marketing', 'index.html'));
});

// Serve buy-token.html
app.get('/buy-token', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'marketing', 'buy-token.html'));
});

// Serve logs.html
app.get('/logs.html', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'marketing', 'logs.html'));
});

// Start server locally
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running locally on port ${PORT}`);
  });
}

// Vercel serverless function handler
export default (req, res) => {
  // Apply CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, premium-token');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Pass the request to the express app
  return app(req, res);
};
