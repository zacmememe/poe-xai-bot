const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 简化的事件发送函数
function sendSSE(res, event, data) {
  console.log(`Sending ${event} event:`, data);
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// API调用函数
async function callXAI(message) {
  console.log('Calling X.AI API with message:', message);
  
  const response = await axios({
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
        content: message
      }],
      max_tokens: 800,
      temperature: 0.7
    },
    timeout: 8000 // 8秒超时
  });

  console.log('X.AI API response received:', response.data);
  return response;
}

app.post('/', async (req, res) => {
  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let isDone = false;

  // 确保响应结束
  const finish = (error = null) => {
    if (isDone) return;
    isDone = true;

    try {
      if (error) {
        console.error('Sending error:', error.message);
        sendSSE(res, 'error', {
          text: `Error: ${error.message}`,
          allow_retry: true
        });
      }
      sendSSE(res, 'done', {});
      res.end();
    } catch (e) {
      console.error('Error during finish:', e);
    }
  };

  try {
    console.log('Request received:', req.body);

    const message = req.body.query?.[0]?.content;
    if (!message) {
      throw new Error('No message content found');
    }

    // 发送meta事件
    sendSSE(res, 'meta', { content_type: 'text/markdown' });

    // 设置超时
    const timeout = setTimeout(() => {
      if (!isDone) {
        finish(new Error('Request timeout'));
      }
    }, 15000);

    try {
      // 调用API
      const response = await callXAI(message);
      const responseText = response.data?.choices?.[0]?.message?.content;

      if (!responseText) {
        throw new Error('Empty response from X.AI');
      }

      // 发送响应
      console.log('Sending response text:', responseText);
      sendSSE(res, 'text', { text: responseText });
      
      // 正常完成
      clearTimeout(timeout);
      finish();

    } catch (apiError) {
      console.error('API Error:', apiError);
      throw apiError;
    }

  } catch (error) {
    console.error('Error in request handler:', error);
    finish(error);
  }
});

// 基础路由
app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

// 启动服务器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
