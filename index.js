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

// 创建流式API调用
function createStreamingAPI(content) {
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
                content: content
            }],
            max_tokens: 4000,
            temperature: 0.7,
            stream: true  // 启用流式响应
        },
        responseType: 'stream',
        timeout: 30000
    });
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
            throw new Error('No message content');
        }

        // 发送初始事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在生成回应...\n' });

        let fullText = '';
        let buffer = '';
        let lastSendTime = Date.now();

        // 创建流式响应
        const response = await createStreamingAPI(message);
        
        response.data.on('data', chunk => {
            try {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));
                        if (data.choices?.[0]?.delta?.content) {
                            buffer += data.choices[0].delta.content;
                            fullText += data.choices[0].delta.content;
                            
                            // 每100ms或缓冲区超过50字符时发送
                            const now = Date.now();
                            if (now - lastSendTime > 100 || buffer.length > 50) {
                                sendSSE(res, 'text', { text: buffer });
                                buffer = '';
                                lastSendTime = now;
                            }
                        }
                    }
                }
            } catch (error) {
                log(`Error processing chunk: ${error.message}`);
            }
        });

        response.data.on('end', () => {
            // 发送剩余的缓冲区内容
            if (buffer.length > 0) {
                sendSSE(res, 'text', { text: buffer });
            }
            
            log(`Generated response length: ${fullText.length}`);
            sendSSE(res, 'done', {});
            res.end();
        });

    } catch (error) {
        log(`Error: ${error.message}`);
        sendSSE(res, 'error', {
            text: `生成响应时出错: ${error.message}`,
            allow_retry: true
        });
        sendSSE(res, 'done', {});
        res.end();
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    log(`Express error: ${err.message}`);
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error',
            message: err.message
        });
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

// 全局错误处理
process.on('uncaughtException', error => {
    log(`Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', error => {
    log(`Unhandled Rejection: ${error.message}`);
});
