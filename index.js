const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 调试函数
function debugLog(label, data) {
    console.log(`${label}:`, JSON.stringify(data, null, 2));
}

// API调用函数
async function callXAI(message) {
    console.log('Calling X.AI API with message:', message);
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
            max_tokens: 800,
            temperature: 0.7
        },
        timeout: 25000
    });
}

// SSE事件发送函数
function sendSSE(res, event, data) {
    console.log(`Sending ${event} event with data:`, data);
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.post('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let isCompleted = false;

    const complete = (error = null) => {
        if (isCompleted) return;
        isCompleted = true;

        try {
            if (error) {
                console.log('Sending error:', error.message);
                sendSSE(res, 'error', {
                    text: error.message,
                    allow_retry: true
                });
            }
            sendSSE(res, 'done', {});
            res.end();
        } catch (e) {
            console.error('Error in complete:', e);
        }
    };

    try {
        debugLog('Received request body', req.body);

        // 请求内容验证
        if (!req.body) {
            throw new Error('Empty request body');
        }

        const query = req.body.query;
        debugLog('Query content', query);

        if (!Array.isArray(query) || query.length === 0) {
            throw new Error('Invalid query format');
        }

        const lastMessage = query[query.length - 1];
        debugLog('Last message', lastMessage);

        if (!lastMessage || typeof lastMessage.content !== 'string') {
            throw new Error('Invalid message content');
        }

        const messageContent = lastMessage.content.trim();
        if (!messageContent) {
            throw new Error('Empty message content');
        }

        // 发送meta事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });

        // 调用API
        console.log('Calling API with content:', messageContent);
        const response = await callXAI(messageContent);
        
        const responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('Empty response from X.AI');
        }

        // 发送响应
        sendSSE(res, 'text', { text: responseText });
        complete();

    } catch (error) {
        console.error('Error occurred:', error);
        complete(error);
    }
});

// 健康检查路由
app.get('/', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务器
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

// 优雅退出
process.on('SIGTERM', () => {
    console.log('SIGTERM received');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
