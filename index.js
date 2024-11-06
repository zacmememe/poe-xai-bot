const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 简单的重试函数
async function retryOperation(operation, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function callXAIAPI(message) {
  return axios({
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
      max_tokens: 1000,
      temperature: 0.7
    },
    timeout: 15000 // 15秒超时
  });
}

app.post('/', async (req, res) => {
  // 设置更短的超时时间
  req.setTimeout(20000);
  res.setTimeout(20000);

  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let hasEnded = false;

  // 确保响应结束
  const endResponse = (error = null) => {
    if (hasEnded) return;
    hasEnded = true;
    
    try {
      if (error) {
        res.write('event: error\n');
        res.write(`data: {"text": "Error: ${error.message}", "allow_retry": true}\n\n`);
      }
      res.write('event: done\n');
      res.write('data: {}\n\n');
      res.end();
    } catch (e) {
      console.error('Error while ending response:', e);
    }
  };

  try {
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    const message = req.body.query?.[0]?.content;
    if (!message) {
      endResponse(new Error('No message content found'));
      return;
    }

    // 发送meta事件
    res.write('event: meta\n');
    res.write('data: {"content_type": "text/markdown"}\n\n');

    // 使用重试机制调用API
    const response = await retryOperation(async () => await callXAIAPI(message));
    
    const responseText = response.data?.choices?.[0]?.message?.content;
    if (!responseText) {
      endResponse(new Error('Empty response from X.AI'));
      return;
    }

    // 记录响应
    console.log('Sending response:', responseText);

    // 发送文本响应
    res.write('event: text\n');
    res.write(`data: {"text": ${JSON.stringify(responseText)}}\n\n`);

    // 正常结束响应
    endResponse();

  } catch (error) {
    console.error('Error occurred:', error);
    endResponse(error);
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
