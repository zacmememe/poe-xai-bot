const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 将长文本分成多个块发送
async function sendLongTextInChunks(res, text, chunkSize = 100) {
  try {
    // 发送 meta 事件
    res.write('event: meta\n');
    res.write('data: {"content_type": "text/markdown"}\n\n');

    // 分块发送文本
    let position = 0;
    while (position < text.length) {
      const chunk = text.slice(position, position + chunkSize);
      res.write('event: text\n');
      res.write(`data: {"text": ${JSON.stringify(chunk)}}\n\n`);
      position += chunkSize;
      // 小延迟以确保数据能够被正确处理
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 发送完成事件
    res.write('event: done\n');
    res.write('data: {}\n\n');
    res.end();
    return true;
  } catch (error) {
    console.error('Error in sendLongTextInChunks:', error);
    return false;
  }
}

function sendErrorResponse(res, errorMessage) {
  try {
    if (!res.writableEnded) {
      res.write('event: error\n');
      res.write(`data: {"text": "${errorMessage}", "allow_retry": true}\n\n`);
      res.write('event: done\n');
      res.write('data: {}\n\n');
      res.end();
    }
  } catch (error) {
    console.error('Error sending error response:', error);
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res) => {
  // 设置更长的超时时间
  req.setTimeout(60000);
  res.setTimeout(60000);

  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    const query = req.body.query;
    const lastMessage = Array.isArray(query) && query.length > 0 
      ? query[query.length - 1] 
      : null;

    if (!lastMessage?.content) {
      sendErrorResponse(res, 'No message content found');
      return;
    }

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
        max_tokens: 2000  // 增加 token 限制以获取更长的响应
      },
      timeout: 30000
    });

    const responseText = xaiResponse?.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      sendErrorResponse(res, 'No response from X.AI');
      return;
    }

    console.log('X.AI Response:', responseText);  // 记录完整响应

    // 使用分块方式发送长文本
    const success = await sendLongTextInChunks(res, responseText);
    if (!success) {
      throw new Error('Failed to send complete response');
    }

  } catch (error) {
    console.error('Error occurred:', error);
    sendErrorResponse(res, `Error: ${error.message}`);
  }
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  if (!res.headersSent) {
    sendErrorResponse(res, `Server error: ${err.message}`);
  }
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});

// 进程错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
