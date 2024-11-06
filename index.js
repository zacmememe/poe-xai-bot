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
    // 详细记录收到的请求
    console.log('Received Poe request:', JSON.stringify(req.body, null, 2));

    // 从 Poe 请求中提取消息
    let messageContent = '';
    if (req.body.query && Array.isArray(req.body.query)) {
      const lastMessage = req.body.query[req.body.query.length - 1];
      if (lastMessage && lastMessage.content) {
        messageContent = lastMessage.content;
      }
    }

    if (!messageContent) {
      console.log('No message content found in request');
      return res.status(200).json({ text: '' });
    }

    console.log('Extracted message:', messageContent);

    // 发送到 X.AI
    const xaiResponse = await axios({
      method: 'post',
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: "grok-beta",
        messages: [{
          role: 'user',
          content: messageContent
        }],
        stream: false
      }
    });

    console.log('X.AI raw response:', JSON.stringify(xaiResponse.data, null, 2));

    // 从 X.AI 响应中提取回复内容
    const responseText = xaiResponse.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      console.log('No response text found in X.AI response');
      return res.status(200).json({ text: '' });
    }

    console.log('Sending response to Poe:', { text: responseText });

    // 返回给 Poe
    return res.status(200).json({
      text: responseText
    });

  } catch (error) {
    console.error('Error occurred:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    // 即使发生错误也返回 200 状态码
    return res.status(200).json({
      text: `Error: ${error.message}`
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});
