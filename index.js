const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// SSE 事件发送函数，带错误处理
function sendSSE(res, event, data) {
  try {
    if (!res.writableEnded) {
      const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(eventString);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Failed to send SSE event ${event}:`, error);
    return false;
  }
}

// 完整的响应发送函数
async function sendFullResponse(res, responseText) {
  try {
    if (!sendSSE(res, 'meta', { content_type: 'text/markdown' })) return false;
    if (!sendSSE(res, 'text', { text: responseText })) return false;
    if (!sendSSE(res, 'done', {})) return false;
    
    if (!res.writableEnded) {
      res.end();
    }
    return true;
  } catch (error) {
    console.error('Error in sendFullResponse:', error);
    return false;
  }
}

// 错误响应发送函数
function sendErrorResponse(res, errorMessage) {
  try {
    if (!res.writableEnded) {
      sendSSE(res, 'error', { 
        text: errorMessage,
        allow_retry: true 
      });
      sendSSE(res, 'done', {});
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
  // 设置长超时
  req.setTimeout(30000);
  res.setTimeout(30000);

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

    // 调用 X.AI API，带重试机制
    let retries = 2;
    let xaiResponse;
    
    while (retries >= 0) {
      try {
        xaiResponse = await axios({
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
            max_tokens: 500 // 减少 token 数量以加快响应
          },
          timeout: 15000
        });
        break;
      } catch (error) {
        if (retries === 0) throw error;
        retries--;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const responseText = xaiResponse?.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      sendErrorResponse(res, 'No response from X.AI');
      return;
    }

    // 发送完整响应
    const success = await sendFullResponse(res, responseText);
    if (!success) {
      throw new Error('Failed to send complete response');
    }

  } catch (error) {
    console.error('Error occurred:', error);
    sendErrorResponse(res, `Error: ${error.message}`);
  }
});

// 全局错误处理
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

// 服务器错误处理
server.on('error', (error) => {
  console.error('Server error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
