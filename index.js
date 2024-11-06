const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 重试函数
async function withRetry(operation, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxAttempts}`);
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      console.log(`Attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// API调用函数
async function callXAI(message) {
  console.log('Calling X.AI API...');
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
    timeout: 25000  // 增加到25秒
  });
  return response;
}

function sendSSE(res, event, data) {
  try {
    console.log(`Sending ${event} event`);
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.error(`Error sending ${event} event:`, error);
  }
}

app.post('/', async (req, res) => {
  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let isResponseSent = false;

  const completeResponse = (error = null) => {
    if (isResponseSent) return;
    isResponseSent = true;

    try {
      if (error) {
        console.log('Sending error response:', error.message);
        sendSSE(res, 'error', {
          text: `Error: ${error.message}`,
          allow_retry: true
        });
      }
      sendSSE(res, 'done', {});
      res.end();
    } catch (e) {
      console.error('Error in completeResponse:', e);
    }
  };

  try {
    console.log('Processing request...');
    const message = req.body.query?.[0]?.content;
    
    if (!message) {
      throw new Error('No message content found');
    }

    // 发送meta事件
    sendSSE(res, 'meta', { content_type: 'text/markdown' });

    // 使用重试机制调用API
    const response = await withRetry(async () => await callXAI(message));
    
    const responseText = response.data?.choices?.[0]?.message?.content;
    if (!responseText) {
      throw new Error('Empty response from X.AI');
    }

    // 发送响应文本
    console.log('Sending response text');
    sendSSE(res, 'text', { text: responseText });
    
    // 完成响应
    completeResponse();

  } catch (error) {
    console.error('Request failed:', error);
    completeResponse(error);
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

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
