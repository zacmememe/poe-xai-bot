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

// 验证请求内容
function validateRequest(body) {
    // 验证基本结构
    if (!body) {
        throw new Error('Empty request body');
    }
    debugLog('Request body', body);

    // 验证query字段
    if (!body.query) {
        throw new Error('Missing query field');
    }
    debugLog('Query field', body.query);

    // 验证是否为数组
    if (!Array.isArray(body.query)) {
        throw new Error(`Query is not an array: ${typeof body.query}`);
    }

    // 验证数组内容
    if (body.query.length === 0) {
        throw new Error('Query array is empty');
    }

    // 获取最后一条消息
    const lastMessage = body.query[body.query.length - 1];
    debugLog('Last message', lastMessage);

    if (!lastMessage || typeof lastMessage !== 'object') {
        throw new Error('Invalid last message format');
    }

    if (!lastMessage.content) {
        throw new Error('Missing content in last message');
    }

    return lastMessage.content.trim();
}

// API调用函数
async function callXAI(message) {
    debugLog('Calling API with message', message);
    
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
    debugLog(`Sending ${event} event`, data);
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.post('/', async (req, res) => {
    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let isCompleted = false;

    const complete = (error = null) => {
        if (isCompleted) return;
        isCompleted = true;

        try {
            if (error) {
                debugLog('Error in request', error);
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
        debugLog('Starting request processing', new Date().toISOString());

        // 验证并获取消息内容
        const messageContent = validateRequest(req.body);
        
        // 发送meta事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });

        // 调用API
        const response = await callXAI(messageContent);
        
        const responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('Empty response from X.AI');
        }

        // 发送响应
        sendSSE(res, 'text', { text: responseText });
        complete();

    } catch (error) {
        debugLog('Error occurred', error);
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
