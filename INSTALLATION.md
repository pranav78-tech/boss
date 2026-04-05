# Installation Guide

## Prerequisites

1. Node.js v14 or higher installed on your system
2. A Groq API key (get it from [https://console.groq.com](https://console.groq.com))
3. Google Chrome browser

## Setting up the MCQ Solver Server

1. Install the required dependencies:
   ```bash
   npm install
   ```

2. Configure your environment:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and add your Groq API key:
     ```
     GROQ_API_KEY=your_actual_groq_api_key_here
     ```

3. Start the server:
   ```bash
   npm start
   ```
   
   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

4. The server will start on `https://project-final-mu-wine.vercel.app` (or your configured PORT).

## Setting up the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions/`

2. Enable "Developer mode" (toggle in the top right corner)

3. Click "Load unpacked" and select the `ai-auto-marker-extension` folder

4. The extension should now appear in your toolbar

## Using the System

### Method 1: Using the Chrome Extension

1. Navigate to a webpage with MCQs
2. Click the extension icon in your toolbar
3. Choose one of the options:
   - "Scan & Solve MCQs" - Scans the page and solves questions individually
   - "Solve All with Server" - Sends the entire page to the server for processing

### Method 2: Using the Server Directly

1. Send a POST request to `https://project-final-mu-wine.vercel.app/solve-mcqs` with HTML content:
   ```json
   {
     "htmlContent": "<html>...</html>"
   }
   ```

2. Receive a JSON response with the solved MCQs:
   ```json
   {
     "success": true,
     "answers": [
       {
         "question": "Full question text",
         "options": [
           {"label": "A", "text": "Option A text"},
           {"label": "B", "text": "Option B text"},
           {"label": "C", "text": "Option C text"},
           {"label": "D", "text": "Option D text"}
         ],
         "answer": "A"
       }
     ]
   }
   ```

## Testing

To test the server with sample data:
```bash
npm run test-server
```

## Troubleshooting

1. **Server not starting**: Check that your Groq API key is correctly configured in the `.env` file

2. **Extension not working**: Ensure the server is reachable at `https://project-final-mu-wine.vercel.app`

3. **No MCQs detected**: The extension currently looks for specific patterns in the HTML. You may need to adjust the detection logic in `content.js` for your specific MCQ format.

## Customization

- Adjust the MCQ detection patterns in `content.js`
- Modify the prompt template in `server.js` to improve answer accuracy
- Update the HTML parsing logic for better MCQ extraction
