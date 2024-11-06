const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 详细日志
function log(msg, data = null) {
    const logMsg = data ? `${msg} ${JSON.stringify(data)}` : msg;
    console.log(`[${new Date().toISOString()}] ${logMsg}`);
}

// SSE发送
function sendSSE(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function makeAPICall(content) {
    const config = {
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
                content: content
            }],
            temperature: 0.7,
            max_tokens: 4000
        },
        timeout: 20000
    };

    log('API Request Config:', {
        url: config.url,
        method: config.method,
        headers: {
            ...config.headers,
            'Authorization': 'Bearer [HIDDEN]'
        },
        data: config.data
    });

    const response = await axios(config);
    
    log('API Response:', {
        status: response.status,
        headers: response.headers,
        data: response.data
    });

    return response.data?.choices?.[0]?.message?.content;
}

app.post('/', async (req, res) => {
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    log('Received Query Request:', {
        type: req.body.type,
        queryLength: req.body.query?.length
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        log('Processing message:', { content: message });

        // 发送初始事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'replace_response', { text: '正在处理请求...\n\n' });

        // API调用
        log('Making API call');
        const responseText = await makeAPICall(message);
        log('API response length:', { length: responseText?.length });

        if (!responseText) {
            throw new Error('Empty response from API');
        }

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送响应
        const chunkSize = 1000;
        let position = 0;

        while (position < responseText.length) {
            const chunk = responseText.slice(position, position + chunkSize);
            sendSSE(res, 'text', { text: chunk });
            position += chunkSize;
            log('Sent chunk:', { position, total: responseText.length });
        }

        sendSSE(res, 'done', {});
        res.end();
        log('Response completed');

    } catch (error) {
        log('Error occurred:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });

        sendSSE(res, 'error', {
            text: `Error: ${error.message}`,
            allow_retry: true
        });
        sendSSE(res, 'done', {});
        res.end();
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    log('Server started', { port });
});

// 错误处理
process.on('uncaughtException', error => {
    log('Uncaught Exception:', {
        message: error.message,
        stack: error.stack
    });
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', {
        message: error.message,
        stack: error.stack
    });
});
