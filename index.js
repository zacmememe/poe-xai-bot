const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 简单日志
function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 发送SSE消息
function sendSSE(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function makeAPICall(content) {
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
            temperature: 0.7
        },
        timeout: 20000
    });
    
    return response.data?.choices?.[0]?.message?.content;
}

app.post('/', async (req, res) => {
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        // 发送初始事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'replace_response', { text: '正在处理请求...\n\n' });

        // API调用
        log('Making API call');
        const responseText = await makeAPICall(message);
        log('API call completed');

        if (!responseText) {
            throw new Error('Empty response from API');
        }

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 发送响应
        sendSSE(res, 'text', { text: responseText });
        sendSSE(res, 'done', {});
        res.end();

    } catch (error) {
        log(`Error: ${error.message}`);
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
    log(`Server running on port ${port}`);
});
