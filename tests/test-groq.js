import dotenv from 'dotenv';
dotenv.config();
import https from 'https';

async function checkModels() {
  const options = {
    hostname: 'api.groq.com',
    path: '/openai/v1/models',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    }
  };

  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const models = json.data.map(m => m.id);
        console.log("AVAILABLE MODELS:");
        console.log(models.join('\n'));
      } catch(e) {
        console.log("Error parsing response:");
        console.log(data);
      }
    });
  });
  req.on('error', console.error);
  req.end();
}

checkModels();
