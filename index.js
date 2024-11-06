const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000;

// 详细的日志函数
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

// SSE 发送函数带确认
function sendSSE(res, event, data) {
    try {
        const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const success = res.write(eventString);
        log(`Sent ${event} event - success: ${success}`);
        return success;
    } catch (error) {
        log(`Error sending SSE: ${error.message}`);
        return false;
    }
}

// API 调用函数带重试
async function callXAIAPI(content) {
    log('Starting API call with content length:', content.length);
    
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            log(`API attempt ${attempt}/3`);
            
            const startTime = Date.now();
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
            
            const endTime = Date.now();
            log(`API response received in ${endTime - startTime}ms`);

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Empty response data structure');
            }

            return response.data.choices[0].message.content;
        } catch (error) {
            log(`API error on attempt ${attempt}:`, {
                message: error.message,
                code: error.code,
                response: error.response?.data,
                status: error.response?.status
            });

            if (attempt === 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

async function handleQuery(req, res) {
    let isDone = false;

    try {
        log('Processing query request', { 
            type: req.body.type,
            queryLength: req.body.query?.length 
        });

        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content found in request');
        }

        // 初始响应
        log('Sending initial events');
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'text', { text: '正在生成回应，请稍候...\n\n' });

        // 调用API
        log('Calling API');
        const responseText = await callXAIAPI(message);
        log('API response received', { length: responseText.length });

        // 处理响应
        let finalText = responseText;
        if (responseText.length > POE_MAX_LENGTH) {
            const lastPeriod = responseText.lastIndexOf('。', POE_MAX_LENGTH);
            finalText = responseText.substring(0, lastPeriod > 0 ? lastPeriod + 1 : POE_MAX_LENGTH);
            log('Response truncated', { 
                originalLength: responseText.length,
                newLength: finalText.length 
            });
        }

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送
        const chunkSize = 1000;
        let position = 0;
        let chunkCount = 0;

        while (position < finalText.length) {
            const chunk = finalText.slice(position, position + chunkSize);
            const success = sendSSE(res, 'text', { text: chunk });
            
            if (!success) {
                throw new Error(`Failed to send chunk ${chunkCount + 1}`);
            }

            position += chunkSize;
            chunkCount++;
            
            log(`Sent chunk ${chunkCount}/${Math.ceil(finalText.length / chunkSize)}`);
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // 完成
        log('Sending done event');
        sendSSE(res, 'done', {});
        isDone = true;
        res.end();

    } catch (error) {
        log('Error in handleQuery:', error);
        
        if (!isDone && !res.writableEnded) {
            try {
                sendSSE(res, 'error', {
                    text: `生成响应时出错: ${error.message}`,
                    allow_retry: true
                });
                sendSSE(res, 'done', {});
                res.end();
            } catch (finalError) {
                log('Error sending error response:', finalError);
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

    // 设置超时
    req.setTimeout(45000);
    res.setTimeout(45000);

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
    log('Uncaught Exception:', error);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error);
});
