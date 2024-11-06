const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000;

function log(msg, data = null) {
    console.log(`[${new Date().toISOString()}] ${msg}`, data ? JSON.stringify(data) : '');
}

function sendSSE(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch (error) {
        log(`SSE Error: ${error.message}`);
        return false;
    }
}

async function callXAIAPI(content) {
    try {
        log('Starting API call');
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
                    content: content
                }],
                max_tokens: 2000, // 减小token数以加快响应
                temperature: 0.7
            },
            timeout: 8000 // 设置更短的超时
        });

        return response.data?.choices?.[0]?.message?.content;
    } catch (error) {
        throw error;
    }
}

async function handleQuery(req, res) {
    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        // 立即发送初始事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在处理...\n' });

        // 设置API调用超时
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('API调用超时')), 8000);
        });

        // 使用Promise.race确保快速响应
        const responseText = await Promise.race([
            callXAIAPI(message),
            timeoutPromise
        ]);

        if (!responseText) {
            throw new Error('Empty response from API');
        }

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 快速分块发送
        const chunkSize = 2000; // 增大块大小
        let position = 0;

        while (position < responseText.length) {
            const chunk = responseText.slice(position, position + chunkSize);
            sendSSE(res, 'text', { text: chunk });
            position += chunkSize;
        }

        sendSSE(res, 'done', {});
        res.end();

    } catch (error) {
        log('Error:', error.message);
        
        if (!res.writableEnded) {
            sendSSE(res, 'error', {
                text: `错误: ${error.message}`,
                allow_retry: true
            });
            sendSSE(res, 'done', {});
            res.end();
        }
    }
}

app.post('/', async (req, res) => {
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await handleQuery(req, res);
});

app.get('/', (req, res) => {
    res.json({ status: 'ok' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    log('Server started', { port });
});

process.on('uncaughtException', error => {
    log('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error.message);
});
