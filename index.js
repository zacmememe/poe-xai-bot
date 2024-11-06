const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 简化的 SSE 发送函数
async function sendResponse(res, text) {
  try {
    // 1. 发送 meta
    res.write('event: meta\n');
    res.write('data: {"content_type": "text/markdown"}\n\n');

    // 2. 发送文本
    res.write('event: text\n');
    res.write(`data: {"text": ${JSON.stringify(text)}}\n\n`);

    // 3. 发送完成标记
    res.write('event: done\n');
    res.write('data: {}\n\n');

    // 4. 结束响应
    res.end();
    return true;
  } catch (error) {
    console.error('Send response error:', error);
    return false;
  }
}

app.post('/', async (req, res) => {
  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 记录接收到的请求
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    // 获取用户消息
    const message = req.body.query?.[0]?.content;
    if (!message) {
      throw new Error('No message content found');
    }

    // 调用 X.AI API
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
        max_tokens: 1500
      },
      timeout: 20000
    });

    // 获取响应文本
    const responseText = response.data?.choices?.[0]?.message?.content;
    if (!responseText) {
      throw new Error('Empty response from X.AI');
    }

    // 记录响应文本
    console.log('X.AI response text:', responseText);

    // 发送响应
    const success = await sendResponse(res, responseText);
    if (!success) {
      throw new Error('Failed to send response');
    }

  } catch (error) {
    console.error('Error:', error);
    try {
      if (!res.writableEnded) {
        res.write('event: error\n');
        res.write(`data: {"text": "Error: ${error.message}", "allow_retry": true}\n\n`);
        res.write('event: done\n');
        res.write('data: {}\n\n');
        res.end();
      }
    } catch (finalError) {
      console.error('Error sending error response:', finalError);
    }
  }
});

// 基础健康检查
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
