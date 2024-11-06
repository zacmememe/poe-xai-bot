const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res) => {
  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    const query = req.body.query;
    let messageContent = '';
    
    if (Array.isArray(query)) {
      const lastMessage = query[query.length - 1];
      if (lastMessage && lastMessage.content) {
        messageContent = lastMessage.content;
      }
    }

    if (!messageContent) {
      // 发送错误事件
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ text: 'No message content found' })}\n\n`);
      res.write('event: done\n');
      res.write('data: {}\n\n');
      res.end();
      return;
    }

    // 发送元数据事件
    res.write('event: meta\n');
    res.write('data: {"content_type": "text/markdown"}\n\n');

    // 调用 X.AI API
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

    console.log('X.AI Response:', JSON.stringify(xaiResponse.data, null, 2));

    const responseText = xaiResponse.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      // 发送错误事件
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ text: 'No response from X.AI' })}\n\n`);
      res.write('event: done\n');
      res.write('data: {}\n\n');
      res.end();
      return;
    }

    // 发送文本事件
    res.write('event: text\n');
    res.write(`data: ${JSON.stringify({ text: responseText })}\n\n`);

    // 发送完成事件
    res.write('event: done\n');
    res.write('data: {}\n\n');
    res.end();

  } catch (error) {
    console.error('Error occurred:', error);
    
    // 发送错误事件
    res.write('event: error\n');
    res.write(`data: ${JSON.stringify({ text: `Error: ${error.message}` })}\n\n`);
    res.write('event: done\n');
    res.write('data: {}\n\n');
    res.end();
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});
