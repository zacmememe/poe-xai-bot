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
        return true;
    } catch (error) {
        log(`SSE Error: ${error.message}`);
        return false;
    }
}

async function streamResponse(res, message) {
    try {
        log('Starting streaming API call');

        const response = await axios({
            method: 'post',
            url: 'https://api.x.ai/v1/chat/completions',
            headers: {
                'Authorization': `Bearer ${XAI_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            data: {
                model: "grok-beta",
                messages: [{
                    role: 'user',
                    content: message
                }],
                stream: true,
                temperature: 0.7
            },
            responseType: 'stream'
        });

        let responseStarted = false;

        response.data.on('data', chunk => {
            try {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));
                        if (data.choices?.[0]?.delta?.content) {
                            if (!responseStarted) {
                                // 清除等待消息
                                sendSSE(res, 'replace_response', { text: '' });
                                responseStarted = true;
                            }
                            sendSSE(res, 'text', { text: data.choices[0].delta.content });
                        }
                    }
                }
            } catch (error) {
                log('Error processing chunk:', error.message);
            }
        });

        response.data.on('end', () => {
            sendSSE(res, 'done', {});
            res.end();
            log('Stream completed');
        });

        response.data.on('error', error => {
            throw error;
        });

    } catch (error) {
        throw error;
    }
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
        sendSSE(res, 'text', { text: '正在生成回应...\n' });

        // 开始流式响应
        await streamResponse(res, message);

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
