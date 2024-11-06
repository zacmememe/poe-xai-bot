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
    console.log('Received request:', JSON.stringify(req.body));

    const query = req.body.query;
    let messageContent = '';
    
    if (Array.isArray(query)) {
      const lastMessage = query[query.length - 1];
      messageContent = lastMessage.content || '';
    } else {
      messageContent = query || '';
    }

    if (!messageContent) {
      return res.json({ text: 'No query provided' });
    }

    const xaiResponse = await axios({
      method: 'post',
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: {
        model: "grok-beta",
        messages: [{
          role: 'user',
          content: messageContent
        }],
        stream: false
      },
      responseType: 'json'
    });

    console.log('X.AI Response:', JSON.stringify(xaiResponse.data));

    // 确保我们能获取到响应内容
    const responseContent = xaiResponse.data?.choices?.[0]?.message?.content;
    
    if (!responseContent) {
      console.error('No response content found in:', xaiResponse.data);
      return res.json({ text: 'No response content from X.AI' });
    }

    // 直接返回响应内容，确保是字符串格式
    return res.json({
      text: String(responseContent)
    });

  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      data: error.response?.data,
      status: error.response?.status,
      request: error.config?.data
    });

    // 确保错误消息也是字符串格式
    return res.json({
      text: String(`Error: ${error.message}. ${error.response?.data?.error || ''}`)
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log(`API Key present: ${!!XAI_API_KEY}`);
});
