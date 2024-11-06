const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000;

// 日志函数
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = data ? 
        `[${timestamp}] ${message} ${JSON.stringify(data, null, 2)}` :
        `[${timestamp}] ${message}`;
    console.log(logMessage);
}

// SSE 发送函数
function sendSSE(res, event, data) {
    try {
        const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const success = res.write(eventString);
        log(`SSE sent: ${event}`, { success });
        return success;
    } catch (error) {
        log(`SSE error: ${event}`, { error: error.message });
        return false;
    }
}

// API调用函数
async function callXAIAPI(content) {
    log('Starting API call', { contentLength: content.length });
    
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
            max_tokens: 8000,
            temperature: 0.7
        },
        timeout: 30000,
        validateStatus: status => status < 500 // 只接受5xx以下的状态码
    };

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            log(`API attempt ${attempt}/5`);
            
            const startTime = Date.now();
            const response = await axios(config);
            const endTime = Date.now();
            
            log('API response received', { 
                duration: endTime - startTime,
                status: response.status,
                hasData: !!response.data
            });

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Invalid response structure');
            }

            return response.data.choices[0].message.content;

        } catch (error) {
            const errorInfo = {
                attempt,
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            };
            log('API error', errorInfo);

            if (attempt === 5) {
                throw new Error(`API失败: ${error.message}`);
            }

            // 计算退避时间
            const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function handleQuery(req, res) {
    let hasStarted = false;
    let hasEnded = false;

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        // 开始响应流
        hasStarted = true;
        log('Starting response stream');
        sendSSE(res, 'meta', { content_type: 'text/markdown' });

        // 调用API
        let updateCount = 0;
        const updateStatus = (text) => {
            updateCount++;
            sendSSE(res, 'replace_response', { 
                text: `${text} [${updateCount}]\n\n` 
            });
        };

        updateStatus('正在调用API...');
        const responseText = await callXAIAPI(message);
        
        log('Processing response', { length: responseText.length });

        // 截断过长的响应
        let finalText = responseText;
        if (responseText.length > POE_MAX_LENGTH) {
            const lastPeriod = responseText.lastIndexOf('。', POE_MAX_LENGTH);
            finalText = responseText.substring(0, 
                lastPeriod > POE_MAX_LENGTH * 0.8 ? lastPeriod + 1 : POE_MAX_LENGTH);
            log('Response truncated', { 
                originalLength: responseText.length,
                newLength: finalText.length 
            });
        }

        // 清除状态消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送
        log('Starting chunked response');
        const chunkSize = 1000;
        let position = 0;
        let chunkCount = 0;

        while (position < finalText.length) {
            const chunk = finalText.slice(position, position + chunkSize);
            sendSSE(res, 'text', { text: chunk });
            
            position += chunkSize;
            chunkCount++;
            
            log(`Sent chunk ${chunkCount}`, { 
                position,
                total: finalText.length 
            });

            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // 完成响应
        log('Completing response');
        sendSSE(res, 'done', {});
        hasEnded = true;
        res.end();

    } catch (error) {
        log('Error occurred', { error: error.message, hasStarted, hasEnded });
        
        if (!hasEnded && !res.writableEnded) {
            try {
                sendSSE(res, 'error', {
                    text: `错误: ${error.message}`,
                    allow_retry: true
                });
                sendSSE(res, 'done', {});
                res.end();
            } catch (finalError) {
                log('Error sending error response', { error: finalError.message });
            }
        }
    }
}

app.post('/', async (req, res) => {
    log('Received request', { type: req.body.type });

    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await handleQuery(req, res);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    log('Server started', { port, hasAPIKey: !!XAI_API_KEY });
});

// 错误处理
process.on('uncaughtException', error => {
    log('Uncaught Exception', { error: error.message });
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection', { error: error.message });
});
