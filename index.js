const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

function sendSSEEvent(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.error(`Failed to send SSE event ${event}:`, error);
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res) => {
  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    // 提取消息内容
    const query = req.body.query;
    let messageContent = '';
    
    if (Array.isArray(query) && query.length > 0) {
      const lastMessage = query[query.length - 1];
      messageContent = lastMessage.content || '';
    }

    if (!messageContent) {
      sendSSEEvent(res, 'error', { text: 'No message content found' });
      sendSSEEvent(res, 'done', {});
      res.end();
      return;
    }

    // 1. 发送 meta 事件
    sendSSEEvent(res, 'meta', { content_type: 'text/markdown' });

    // 2. 调用 X.AI API，设置较短的超时时间
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
        stream: false,
        max_tokens: 800 // 减少token数量
      },
