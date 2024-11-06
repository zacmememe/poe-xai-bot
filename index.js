const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 用于发送 SSE 事件的辅助函数
function sendSSEEvent(res, eventType, data) {
  try {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.error(`Error sending SSE event ${eventType}:`, error);
  }
}

// 确保总是发送完整的响应序列
async function sendCompleteResponse(res, messageContent) {
  try {
    // 1. 发送 meta 事件
    sendSSEEvent(res, 'meta', {
      content_type: 'text/markdown',
      suggested_replies: true
    });

    // 2. 调用 X.AI API
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
      },
      timeout: 30000 // 30秒超时
    });

    const responseText = xaiResponse.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      throw new Error('No response content from X.AI');
    }

    // 3. 发送文本响应
    sendSSEEvent(res, 'text', { text: responseText });

    // 4. 如果回复较长，可以添加一些建议的后续问题
    if (responseText.length > 100) {
      sendSSEEvent(res, 'suggested_reply', { text: '能详细解释一下这个观点吗？' });
      sendSSEEvent(res, 'suggested_reply', { text: '有具体的例子吗？' });
    }

  } catch (error) {
    console.error('Error in processing:', error);
    sendSSEEvent(res, 'error', {
      text: `Error: ${error.message}`,
      allow_retry: true
    });
  } finally {
    // 5. 确保总是发送 done 事件
    try {
      sendSSEEvent(res, 'done', {});
      res.end();
    } catch (finalError) {
      console.error('Error sending final done event:', finalError);
    }
  }
}

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
      sendSSEEvent(res, 'error', { text: 'No message content found' });
      sendSSEEvent(res, 'done', {});
      res.end();
      return;
    }

    // 使用新的响应处理函数
    await sendCompleteResponse(res, messageContent);

  } catch (error) {
    console.error('Fatal error:', error);
    try {
      sendSSEEvent(res, 'error', {
        text: `Fatal error: ${error.message}`,
        allow_retry: true
      });
      sendSSEEvent(res, 'done', {});
      res.end();
    } catch (finalError) {
      console.error('Error sending error response:', finalError);
    }
  }
});

// 添加错误处理中间件
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  try {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    sendSSEEvent(res, 'error', {
      text: `Server error: ${error.message}`,
      allow_retry: true
    });
    sendSSEEvent(res, 'done', {});
    res.end();
  } catch (finalError) {
    console.error('Error in error handler:', finalError);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});
