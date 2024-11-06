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
    console.log('Received request:', req.body);

    // 从 Poe 请求中获取消息
    const query = req.body.query || '';
    
    // 准备发送给 x.ai 的请求
    const xaiRequestData = {
      model: "claude-instant-1.2",
      messages: [
        {
          role: "user",
          content: query
        }
      ],
      temperature: 0.7,
      max_tokens: 1000
    };

    console.log('Sending to X.AI:', xaiRequestData);

    const xaiResponse = await axios({
      method: 'post',
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: xaiRequestData
    });

    console.log('X.AI response received:', xaiResponse.data);

    // 返回给 Poe 的响应
    res.json({
      text: xaiResponse.data.choices[0].message.content
    });

  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      data: error.response?.data,
      status: error.response?.status
    });

    res.json({
      text: `Error: ${error.message || 'Unknown error occurred'}`
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
