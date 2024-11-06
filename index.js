const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 简单的 SSE 事件发送函数
function sendSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// 基础路由
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// 主要处理路由
app.post('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 记录请求
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    // 获取最后一条消息
    const query = req.body.query;
    const lastMessage = Array.isArray(query) && query.length > 0 
      ? query[query.length - 1] 
      : null;
    
    if (!lastMessage || !lastMessage.content) {
      sendSSE(res, 'error', { text: 'No message content found' });
      sendSSE(res, 'done', {});
      res.end();
      return;
    }

    // 发送元数据
    sendSSE(res, 'meta', { content_type: 'text/markdown' });

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
          content: lastMessage.content
        }],
        stream: false,
        max_tokens: 800
      },
      timeout: 20000
    });

    // 获取响应文本
    const responseText = xaiResponse.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      sendSSE(res, 'error', { text: 'No response from X.AI' });
      sendSSE(res, 'done', {});
      res.end();
      return;
    }

    // 发送响应
    sendSSE(res, 'text', { text: responseText });
    sendSSE(res, 'done', {});
    res.end();

  } catch (error) {
    console.error('Error:', error);
    sendSSE(res, 'error', { 
      text: `Error: ${error.message}`,
      allow_retry: true 
    });
    sendSSE(res, 'done', {});
    res.end();
  }
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/event-stream');
    sendSSE(res, 'error', { 
      text: `Server error: ${err.message}`,
      allow_retry: true 
    });
    sendSSE(res, 'done', {});
    res.end();
  }
});

// 启动服务器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});
