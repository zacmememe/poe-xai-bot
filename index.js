const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendSSEMessage(res, message) {
  try {
    // 1. 发送 meta 事件
    res.write('event: meta\n');
    res.write('data: {"content_type": "text/markdown"}\n\n');
    
    await sleep(100); // 短暂延迟

    // 2. 发送文本事件
    res.write('event: text\n');
    res.write(`data: {"text": ${JSON.stringify(message)}}\n\n`);
    
    await sleep(100); // 短暂延迟

    // 3. 发送结束事件
    res.write('event: done\n');
    res.write('data: {}\n\n');
    
    // 4. 结束响应
    res.end();
    
    return true;
  } catch (error) {
    console.error('Error sending SSE message:', error);
    return false;
  }
}

async function sendErrorMessage(res, error) {
  try {
    // 1. 发送错误事件
    res.write('event: error\n');
    res.write(`data: {"text": "Error: ${error.message}", "allow_retry": true}\n\n`);
    
    // 2. 发送结束事件
    res.write('event: done\n');
    res.write('data: {}\n\n');
    
    // 3. 结束响应
    res.end();
  } catch (finalError) {
    console.error('Error sending error message:', finalError);
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res) => {
  // 设置响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    // 提取消息内容
    const query = req.body.query;
    let messageContent = '';
    
    if (Array.isArray(query) && query.length > 0) {
      const lastMessage = query[query.length - 1];
      messageContent = lastMessage.content || '';
    }

    if (!messageContent) {
      await sendErrorMessage(res, new Error('No message content found'));
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
          content: messageContent
        }],
        stream: false,
        max_tokens: 1000 // 限制响应长度
      },
      timeout: 30000 // 30 秒超时
    });

    const responseText = xaiResponse.data?.choices?.[0]?.message?.content;

    if (!responseText) {
      await sendErrorMessage(res, new Error('No response from X.AI'));
      return;
    }

    // 发送完整响应
    const success = await sendSSEMessage(res, responseText);
    
    if (!success) {
      throw new Error('Failed to send complete response');
    }

  } catch (error) {
    console.error('Error occurred:', error);
    await sendErrorMessage(res, error);
  }
});

// 添加错误处理中间件
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  sendErrorMessage(res, error).catch(console.error);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API Key configured: ${!!XAI_API_KEY}`);
});
