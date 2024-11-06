const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 日志函数
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

// SSE 发送函数
function sendSSE(res, event, data) {
    try {
        const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        log(`Sending ${event} event`);
        return res.write(eventString);
    } catch (error) {
        log(`Error sending SSE event: ${error.message}`);
        return false;
    }
}

// API 调用函数
async function callXAIAPI(content, attempt = 1) {
    log(`API call attempt ${attempt}`);
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
                max_tokens: 8000,
                temperature: 0.7
            },
            timeout: 30000
        });

        if (!response.data?.choices?.[0]?.message?.content) {
            throw new Error('Empty API response');
        }

        return response.data.choices[0].message.content;
    } catch (error) {
        log(`API call error (attempt ${attempt}):`, error.message);
        if (attempt < 3) {
            log('Retrying...');
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            return callXAIAPI(content, attempt + 1);
        }
        throw error;
    }
}

async function handleQuery(req, res) {
    let hasStarted = false;
    let hasEnded = false;

    const cleanup = (error = null) => {
        if (hasEnded) return;
        hasEnded = true;

        try {
            if (error) {
                log('Sending error response:', error.message);
                sendSSE(res, 'error', {
                    text: `Error: ${error.message}`,
                    allow_retry: true
                });
            }
            sendSSE(res, 'done', {});
            res.end();
        } catch (finalError) {
            log('Error during cleanup:', finalError.message);
        }
    };

    try {
        const lastMessage = req.body.query?.[req.body.query.length - 1];
        
        if (!lastMessage?.content) {
            throw new Error('Invalid message content');
        }

        // 开始响应流
        hasStarted = true;
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在生成回应...\n\n' });

        // 调用 API
        const responseText = await callXAIAPI(lastMessage.content);
        log(`Received response of length: ${responseText.length}`);

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送响应
        const chunks = responseText.match(/.{1,100}/g) || [];
        for (const chunk of chunks) {
            sendSSE(res, 'text', { text: chunk });
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        cleanup();

    } catch (error) {
        log('Error in handleQuery:', error.message);
        cleanup(error);
    }
}

app.post('/', async (req, res) => {
    log('Received request', { type: req.body.type });

    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 设置超时
    req.setTimeout(60000);
    res.setTimeout(60000);

    // 根据请求类型处理
    switch (req.body.type) {
        case 'query':
            await handleQuery(req, res);
            break;
        case 'report_error':
        case 'report_feedback':
            log(`Received ${req.body.type}`, req.body);
            res.json({ status: 'ok' });
            break;
        default:
            log('Received unknown request type', req.body);
            res.json({ status: 'ok' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
    log(`Server running on port ${port}`);
    log(`API Key configured: ${!!XAI_API_KEY}`);
});

// 错误处理
process.on('uncaughtException', (error) => {
    log('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    log('Unhandled rejection:', error);
});
