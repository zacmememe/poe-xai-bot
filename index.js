const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res) => {
  try {
    const message = req.body.message || '';
    console.log('Received message:', message); // 添加日志
    console.log('API Key:', XAI_API_KEY ? 'Present' : 'Missing'); // 检查 API key

    if (!XAI_API_KEY) {
      throw new Error('API key is not configured');
    }

    const response = await axios({
      method: 'post',
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: 'xai-chat-beta',
        messages: [{
          role: 'user',
          content: message
        }],
        max_tokens: 1000
      }
    });

    console.log('X.AI Response:', response.data); // 添加日志
    res.json({ response: response.data.choices[0].message.content });
  } catch (error) {
    console.error('Detailed Error:', error); // 添加更详细的错误日志
    res.status(500).json({ 
      response: `Error: ${error.message}`,
      details: error.response?.data || 'No additional details'
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
