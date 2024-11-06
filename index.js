const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 详细日志函数
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    if (data) {
        console.log(`[${timestamp}] ${message}`, JSON.stringify(data, null, 2));
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
}

// SSE 发送函数带确认
function sendSSE(res, event, data) {
    try {
        const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const success = res.write(eventString);
        log(`Sent ${event} event`, { success });
        return success;
    } catch (error) {
        log(`Error sending SSE event: ${event}`, error);
        return false;
    }
}

// API 调用函数
async function callXAIAPI(content) {
    log('Starting API call');
    
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            log(`API attempt ${attempt}`);
            
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
                timeout: 20000
            });

            log('API response received', {
                status: response.status,
                hasChoices: !!response.data?.choices,
                choicesLength: response.data?.choices?.length
            });

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Empty response from API');
            }

            return response.data.choices[0].message.content;
        } catch (error) {
            log(`API error on attempt ${attempt}`, {
                message: error.message,
                code: error.code,
                response: error.response?.data
            });

            if (attempt === 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

async function handleQuery(req, res) {
    let cleanup = null;

    try {
        log('Starting query handler');

        // 设置清理函数
        cleanup = (error = null) => {
            try {
                if (error) {
                    log('Sending error in cleanup', error);
                    sendSSE(res, 'error', {
                        text: `Error: ${error.message}`,
                        allow_retry: true
                    });
                }
                sendSSE(res, 'done', {});
                if (!res.writableEnded) {
                    res.end();
                }
            } catch (cleanupError) {
                log('Error during cleanup', cleanupError);
            }
        };

        // 验证消息内容
        const lastMessage = req.body.query?.[req.body.query.length - 1];
        if (!lastMessage?.content) {
            throw new Error('No valid message content');
        }

        // 发送初始事件
        log('Sending initial events');
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在生成回应...' });

        // 调用 API
        log('Calling API');
        const responseText = await callXAIAPI(lastMessage.content);
        log('API call successful', { responseLength: responseText.length });

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送响应
        const chunkSize = 50;
        let position = 0;

        while (position < responseText.length) {
            const chunk = responseText.slice(position, position + chunkSize);
            const success = sendSSE(res, 'text', { text: chunk });
            
            if (!success) {
                throw new Error('Failed to send response chunk');
            }

            position += chunkSize;
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // 完成响应
        cleanup();

    } catch (error) {
        log('Error in query handler', error);
        if (cleanup) cleanup(error);
    }
}

app.post('/', async (req, res) => {
    const requestType = req.body.type;
    log('Received request', { type: requestType });

    if (requestType !== 'query') {
        return res.json({ status: 'ok' });
    }

    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 设置超时
    req.setTimeout(30000);
    res.setTimeout(30000);

    await handleQuery(req, res);
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
    log('Uncaught exception', error);
});

process.on('unhandledRejection', (error) => {
    log('Unhandled rejection', error);
});
