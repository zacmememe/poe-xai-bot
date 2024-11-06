const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const MAX_RESPONSE_LENGTH = 90000; // 设置一个安全的最大长度

// 日志函数
function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// SSE 发送函数
function sendSSE(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch (error) {
        log(`Error sending SSE: ${error.message}`);
        return false;
    }
}

async function handleQuery(req, res) {
    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        // 发送初始事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在生成回应...\n\n' });

        // API 调用
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
                    content: message
                }],
                max_tokens: 2000,
                temperature: 0.7
            },
            timeout: 15000
        });

        let responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('Empty response from API');
        }

        // 如果响应太长，截断它
        if (responseText.length > MAX_RESPONSE_LENGTH) {
            responseText = responseText.substring(0, MAX_RESPONSE_LENGTH) + '\n\n[响应被截断以确保稳定性]';
        }

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送完整响应
        let totalSent = 0;
        const chunkSize = 500;
        const chunks = [];

        // 将响应分割成块
        for (let i = 0; i < responseText.length; i += chunkSize) {
            chunks.push(responseText.slice(i, i + chunkSize));
        }

        // 发送所有块
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const success = sendSSE(res, 'text', { text: chunk });
            
            if (!success) {
                throw new Error('Failed to send chunk');
            }

            totalSent += chunk.length;
            log(`Sent chunk ${i + 1}/${chunks.length} (${totalSent} chars total)`);

            // 每个块之间添加小延迟
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // 发送完成事件
        sendSSE(res, 'done', {});
        res.end();
        log(`Successfully sent complete response (${totalSent} chars)`);

    } catch (error) {
        log(`Error in handleQuery: ${error.message}`);
        try {
            if (!res.writableEnded) {
                sendSSE(res, 'error', {
                    text: `生成响应时出错: ${error.message}`,
                    allow_retry: true
                });
                sendSSE(res, 'done', {});
                res.end();
            }
        } catch (finalError) {
            log(`Error sending error response: ${finalError.message}`);
        }
    }
}

app.post('/', async (req, res) => {
    // 检查请求类型
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    // 设置响应头
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
    log(`Server running on port ${port}`);
    log(`API Key configured: ${!!XAI_API_KEY}`);
});

// 错误处理
process.on('uncaughtException', error => {
    log(`Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', error => {
    log(`Unhandled Rejection: ${error.message}`);
});
