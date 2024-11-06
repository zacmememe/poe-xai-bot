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
    console.log('Received request body:', req.body);

    if (!req.body.query) {
      throw new Error('No query provided');
    }

    // X.AI API 请求
    const response = await axios({
      method: 'POST',
      url: 'https://api.x.ai/v1/messages',  // 使用 messages endpoint
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        content: req.body.query
      }
    });

    console.log('X.AI response:', response.data);

    // 返回给 Poe
    res.json({
      text: response.data.content || 'No response content'
    });

  } catch (error) {
    console.error('Error occurred:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    res.status(200).json({
      text: `Error: ${error.message || 'Unknown error'}`
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
