# Deploying to Render

This guide explains how to deploy the MCQ Solver Server to Render.

## Prerequisites

1. Create a Render account at https://render.com
2. Fork this repository to your GitHub account (if not already done)

## Deployment Steps

1. Go to your Render Dashboard
2. Click "New" → "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - Name: `mcq-solver-server` (or any name you prefer)
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Branch: `main` (or your preferred branch)

5. Add Environment Variables:
   - `GROQ_API_KEY`: Your Groq API key
   - `PORT`: `10000` (Render's default port) or leave it blank to use default

6. Click "Create Web Service"

## File Storage Configuration

Render automatically configures persistent storage for uploaded files. The server uses `/tmp/uploads` as the upload directory when deployed to Render.

## Domain

Render will provide you with a public URL for your service, typically in the format:
`https://your-service-name.onrender.com`

## Auto-Scaling

Render automatically scales your service based on traffic. The service will automatically spin down when inactive to save resources, which may cause a slight delay on the first request.

## Troubleshooting

1. If you encounter file permission issues, ensure the `RENDER_UPLOAD_DIR` environment variable is set to `/tmp/uploads`
2. Check the logs in the Render dashboard for any error messages
3. Make sure your `GROQ_API_KEY` is correctly set in the environment variables
