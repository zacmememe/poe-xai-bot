const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 调试函数
function debugLog(label, data) {
    console.log(`=== ${label} ===`);
    console.log(JSON.stringify(data, null, 2));
    console.log('='.repeat(50));
}

// 验证并处理查询请求
function processQueryRequest(body) {
    if (!body.query || !Array.isArray(body.query) || body.query.length === 0) {
        throw new Error('Invalid query format');
    }

    const lastMessage = body.query[body.query.length - 1];
    if (!lastMessage || !lastMessage.content) {
        throw new Error('Invalid message format');
    }

    return lastMessage.content.trim();
}

// 发送 SSE 事件
function sendSSE(res, event, data) {
    debugLog(`Sending ${event} event`, data);
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// 完成响应
function completeResponse(res, error = null) {
    try {
        if (error) {
            sendSSE(res, 'error', {
                text: error.message,
                allow_retry: true
            });
        }
        sendSSE(res, 'done', {});
        res.end();
    } catch (e) {
        console.error('Error in completeResponse:', e);
    }
}

app.post('/', async (req, res) => {
    debugLog('Received request', req.body);

    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // 检查请求类型
        const requestType = req.body.type;
        debugLog('Request type', requestType);

        // 如果是错误报告类型，直接发送完成事件
        if (requestType === 'report_error') {
            debugLog('Processing error report', req.body.message);
            completeResponse(res);
            return;
        }

        // 如果不是查询类型，返回错误
        if (requestType !== 'query') {
            throw new Error(`Unsupported request type: ${requestType}`);
        }

        // 处理查询请求
        const messageContent = processQueryRequest(req.body);
        debugLog('Processed message content', messageContent);

        // 发送meta事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });

        // 调用API
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
                    content: messageContent
                }],
                max_tokens: 800,
                temperature: 0.7
            },
            timeout: 25000
        });

        const responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('Empty response from X.AI');
        }

        // 发送响应
        sendSSE(res, 'text', { text: responseText });
        completeResponse(res);

    } catch (error) {
        debugLog('Error occurred', error);
        completeResponse(res, error);
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
