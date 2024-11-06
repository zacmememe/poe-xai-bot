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
    // 详细记录接收到的请求
    console.log('Received raw request:', JSON.stringify(req.body, null, 2));
    console.log('Headers:', JSON.stringify(req.headers, null, 2));

    // 检查 API key
    if (!XAI_API_KEY) {
      throw new Error('API key not configured');
    }

    // 从请求中获取消息
    const query = req.body.query;
    if (!query) {
      console.log('No query found in request body');
      throw new Error('No query provided');
    }

    // 构建 x.ai API 请求
    const requestData = {
      messages: [
        {
          role: "user",
          content: query
        }
      ]
    };

    console.log('Sending request to X.AI:', JSON.stringify(requestData, null, 2));

    // 发送请求到 x.ai
    const xaiResponse = await axios({
      method: 'post',
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: requestData,
      timeout: 30000 // 30 秒超时
    });

    console.log('X.AI response:', JSON.stringify(xaiResponse.data, null, 2));

    // 返回响应给 Poe
    res.json({
      text: xaiResponse.data.choices[0].message.content
    });

  } catch (error) {
    console.error('Full error:', {
      message: error.message,
      data: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers,
      requestData: error.config?.data
    });

    // 返回错误信息
    res.status(500).json({
      text: `Error: ${error.message}. ${error.response?.data?.error || ''}`
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}, API Key present: ${!!XAI_API_KEY}`);
});
