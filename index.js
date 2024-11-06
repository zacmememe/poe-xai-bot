const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 添加响应超时设置
const RESPONSE_TIMEOUT = 50000; // 50 seconds
const CHUNK_SIZE = 100; // 每次发送的字符数

function sendSSEEvent(res, eventType, data) {
  try {
    if (!res.writableEnded) {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  } catch (error) {
    console.error(`Error sending SSE event ${eventType}:`, error);
  }
}

// 将长文本分块发送
async function sendTextInChunks(res, text) {
  try {
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      const chunk = text.slice(i, i + CHUNK_SIZE);
      sendSSEEvent(res, 'text', { text: chunk });
      // 添加小延迟以防止发送太快
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return true;
  } catch (error) {
    console.error('Error sending text chunks:', error);
    return false;
  }
}

async function sendCompleteResponse(res, messageContent) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Response timeout')), RESPONSE_TIMEOUT)
  );

  try {
    // 1. 发送 meta 事件
    sendSSEEvent(res, 'meta', {
      content_type: 'text/markdown'
    });

    // 2. 调用 X.AI API，使用 Promise.race 来处理超时
    const xaiResponsePromise = axios({
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
        max_tokens: 2000 // 限制响应长度
      }
    });

    const xaiResponse = await Promise.race([xaiResponsePromise, timeoutPromise]);
    const responseText = xaiResponse.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      throw new Error('No response content from X.AI');
    }

    // 3. 分块发送文本响应
    const sendSuccess = await sendTextInChunks(res, responseText);
    if (!sendSuccess) {
      throw new Error('Failed to send complete response');
    }

  } catch (error) {
    console.error('Error in processing:', error);
    if (!res.writableEnded) {
      sendSSEEvent(res, 'error', {
        text: `Error: ${error.message}`,
        allow_retry: true
      });
    }
  } finally {
    // 4. 确保发送 done 事件
    if (!res.writableEnded) {
      sendSSEEvent(res, 'done', {});
      res.end();
    }
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res) => {
  // 设置更长的超时时间
  req.setTimeout(RESPONSE_TIMEOUT);
  res.setTimeout(RESPONSE_TIMEOUT);

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

    await sendCompleteResponse(res, messageContent);

  } catch (error) {
    console.error('Fatal error:', error);
    if (!res.writableEnded) {
      sendSSEEvent(res, 'error', {
        text: `Fatal error: ${error.message}`,
        allow_retry: true
      });
      sendSSEEvent(res, 'done', {});
      res.end();
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});
