const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 日志函数
function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// SSE 发送函数
function sendSSE(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// API调用函数
async function callXAIAPI(content) {
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
            max_tokens: 4000,
            temperature: 0.7
        },
        timeout: 8000 // 减少到8秒
    });
    
    return response.data?.choices?.[0]?.message?.content;
}

app.post('/', async (req, res) => {
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 设置更短的超时
    req.setTimeout(15000);
    res.setTimeout(15000);

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        // 立即开始响应
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在生成回应...' });

        // 使用 Promise.race 来处理超时
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('API Timeout')), 8000)
        );

        // API调用带重试
        const apiCallWithRetry = async () => {
            for (let i = 0; i < 2; i++) {
                try {
                    const response = await callXAIAPI(message);
                    if (!response) throw new Error('Empty response');
                    return response;
                } catch (error) {
                    if (i === 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        };

        // 竞争Promise
        const responseText = await Promise.race([
            apiCallWithRetry(),
            timeoutPromise
        ]);

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 快速分块发送
        const chunkSize = 100;
        let position = 0;
        
        while (position < responseText.length) {
            const chunk = responseText.slice(position, position + chunkSize);
            sendSSE(res, 'text', { text: chunk });
            position += chunkSize;
            // 最小延迟
            await new Promise(resolve => setTimeout(resolve, 1));
        }

        // 完成响应
        sendSSE(res, 'done', {});
        res.end();

    } catch (error) {
        log(`Error: ${error.message}`);
        try {
            sendSSE(res, 'error', {
                text: error.message === 'API Timeout' ? 
                    '响应超时，请重试' : 
                    `Error: ${error.message}`,
                allow_retry: true
            });
            sendSSE(res, 'done', {});
            res.end();
        } catch (finalError) {
            log(`Final error: ${finalError.message}`);
        }
    }
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
