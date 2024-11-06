const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000;

// 日志函数
function log(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`, data ? JSON.stringify(data) : '');
}

// SSE 发送函数
function sendSSE(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch (error) {
        log('SSE Error:', error.message);
        return false;
    }
}

// 超时Promise
function timeoutPromise(ms, message) {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
    });
}

// API调用函数
async function callXAIAPI(content, updateStatus) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            updateStatus(`API调用尝试 ${attempt}/3`);
            log('API Call Attempt', { attempt, contentLength: content.length });

            // 使用Promise.race来添加超时控制
            const response = await Promise.race([
                axios({
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
                    }
                }),
                timeoutPromise(15000, '请求超时')
            ]);

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('无效的API响应格式');
            }

            return response.data.choices[0].message.content;

        } catch (error) {
            log('API Error', { attempt, error: error.message });
            
            if (attempt === 3) {
                throw error;
            }

            updateStatus(`API调用失败，正在重试(${attempt}/3)...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function handleQuery(req, res) {
    const cleanup = (error = null) => {
        try {
            if (error) {
                sendSSE(res, 'error', {
                    text: `错误: ${error.message}`,
                    allow_retry: true
                });
            }
            sendSSE(res, 'done', {});
            res.end();
        } catch (e) {
            log('Cleanup Error:', e.message);
        }
    };

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('未找到消息内容');
        }

        // 发送初始事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        
        // 状态更新函数
        const updateStatus = (text) => {
            sendSSE(res, 'replace_response', { text: `${text}\n\n` });
        };

        // 设置整体超时
        const timeoutId = setTimeout(() => {
            cleanup(new Error('请求处理超时'));
        }, 25000);

        try {
            // 调用API
            const responseText = await callXAIAPI(message, updateStatus);
            
            // 清除总超时
            clearTimeout(timeoutId);

            // 处理响应长度
            let finalText = responseText;
            if (responseText.length > POE_MAX_LENGTH) {
                const lastPeriod = responseText.lastIndexOf('。', POE_MAX_LENGTH);
                finalText = responseText.substring(0, 
                    lastPeriod > POE_MAX_LENGTH * 0.8 ? lastPeriod + 1 : POE_MAX_LENGTH);
            }

            // 清除状态消息
            sendSSE(res, 'replace_response', { text: '' });

            // 分块发送
            const chunkSize = 500;
            for (let i = 0; i < finalText.length; i += chunkSize) {
                const chunk = finalText.slice(i, i + chunkSize);
                sendSSE(res, 'text', { text: chunk });
                await new Promise(resolve => setTimeout(resolve, 5));
            }

            cleanup();

        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }

    } catch (error) {
        log('Handler Error:', error.message);
        cleanup(error);
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
        await handleQuery(req, res);
    } catch (error) {
        log('Request Handler Error:', error.message);
        if (!res.writableEnded) {
            res.json({ error: error.message });
        }
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    log('Server Started', { port, hasAPIKey: !!XAI_API_KEY });
});

process.on('uncaughtException', error => {
    log('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error.message);
});
