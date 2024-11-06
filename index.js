const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

function log(msg, data = null) {
    console.log(`[${new Date().toISOString()}] ${msg}`, data ? JSON.stringify(data) : '');
}

function sendSSE(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
        log('SSE Error:', error.message);
    }
}

async function makeAPICall(content) {
    try {
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
                temperature: 0.7,
                max_tokens: 2000
            },
            timeout: 30000
        });

        log('API Response:', {
            status: response.status,
            hasData: !!response.data
        });

        return response.data?.choices?.[0]?.message?.content || null;
    } catch (error) {
        log('API Error:', {
            message: error.message,
            response: error.response?.data
        });
        throw error;
    }
}

app.post('/', async (req, res) => {
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('没有找到消息内容');
        }

        log('Processing query:', { content: message });

        // 发送初始消息
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在处理请求...' });

        // 先发送一个测试消息确认连接正常
        sendSSE(res, 'text', { text: '\n\n连接测试: 正在调用API...\n' });

        // API调用
        const responseText = await makeAPICall(message);
        
        if (!responseText) {
            throw new Error('API返回为空');
        }

        // 清除之前的消息
        sendSSE(res, 'replace_response', { text: '' });

        // 发送实际响应
        log('Sending response');
        sendSSE(res, 'text', { text: responseText });

        // 完成响应
        sendSSE(res, 'done', {});
        res.end();
        log('Response completed');

    } catch (error) {
        log('Error:', error.message);
        
        try {
            sendSSE(res, 'error', {
                text: `发生错误: ${error.message}`,
                allow_retry: true
            });
            sendSSE(res, 'done', {});
            res.end();
        } catch (finalError) {
            log('Final error:', finalError.message);
        }
    }
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
