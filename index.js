const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 发送单个 SSE 事件的函数
function sendEvent(res, event, data) {
  try {
    const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(eventString);
    return true;
  } catch (error) {
    console.error(`Error sending ${event} event:`, error);
    return false;
  }
}

// 完整的响应序列
async function sendCompleteResponse(res, content) {
  try {
    // 1. 发送 meta 事件
    if (!sendEvent(res, 'meta', { content_type: 'text/markdown' })) {
      throw new Error('Failed to send meta event');
    }

    // 等待一小段时间
    await new Promise(resolve => setTimeout(resolve, 100));

    // 2. 发送文本内容
    if (!sendEvent(res, 'text', { text: content })) {
      throw new Error('Failed to send text event');
    }

    // 再等待一小段时间
    await new Promise(resolve => setTimeout(resolve, 100));

    // 3. 发送结束事件
    if (!sendEvent(res, 'done', {})) {
      throw new Error('Failed to send done event');
    }

    // 4. 结束响应
    res.end();
    return true;
  } catch (error) {
    console.error('Error in sendCompleteResponse:', error);
    return false;
  }
}

app.post('/', async (req, res) => {
  console.log('Received request:', JSON.stringify(req.body, null, 2));

  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
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
        max_tokens: 800,
        temperature: 0.7
      },
      timeout: 10000 // 10 秒超时
    });

    const responseText = response.data?.choices?.[0]?.message?.content;
    if (!responseText) {
      throw new Error('Empty response from X.AI');
    }

    // 记录响应内容
    console.log('X.AI response:', responseText);

    // 发送完整响应
    const success = await sendCompleteResponse(res, responseText);
    if (!success) {
      throw new Error('Failed to send complete response');
    }

  } catch (error) {
    console.error('Error occurred:', error);
    
    // 发送错误响应
    try {
      if (!res.writableEnded) {
        sendEvent(res, 'error', {
          text: `Error: ${error.message}`,
          allow_retry: true
        });
        sendEvent(res, 'done', {});
        res.end();
      }
    } catch (finalError) {
      console.error('Error sending error response:', finalError);
    }
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
