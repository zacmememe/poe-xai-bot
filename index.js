const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000;

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
        return res.write(eventString);
    } catch (error) {
        log(`Error sending SSE: ${error.message}`);
        return false;
    }
}

// 指数退避重试
async function exponentialBackoff(attempt) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 8000); // 最大8秒
    await new Promise(resolve => setTimeout(resolve, delay));
}

// API 调用函数
async function callXAIAPI(content, updateStatus) {
    let lastError = null;
    const maxAttempts = 5; // 增加重试次数

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            updateStatus(`尝试调用 API (${attempt}/${maxAttempts})...`);
            log(`API attempt ${attempt}/${maxAttempts}`);

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
                timeout: 20000
            });

            const responseText = response.data?.choices?.[0]?.message?.content;
            if (!responseText) {
                throw new Error('Empty response from API');
            }

            return responseText;

        } catch (error) {
            lastError = error;
            log(`API error on attempt ${attempt}:`, {
                status: error.response?.status,
                message: error.message,
                data: error.response?.data
            });

            // 对于503错误使用更长的重试时间
            if (error.response?.status === 503) {
                updateStatus(`服务暂时不可用，正在重试 (${attempt}/${maxAttempts})...`);
                await exponentialBackoff(attempt);
            } else if (attempt < maxAttempts) {
                updateStatus(`API调用失败，正在重试 (${attempt}/${maxAttempts})...`);
                await exponentialBackoff(attempt - 1);
            } else {
                throw new Error(`API调用失败: ${error.message}`);
            }
        }
    }

    throw lastError || new Error('所有重试都失败了');
}

async function handleQuery(req, res) {
    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content found');
        }

        // 发送初始事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        
        // 状态更新函数
        const updateStatus = (status) => {
            sendSSE(res, 'replace_response', { text: `${status}\n\n` });
        };

        updateStatus('正在初始化请求...');

        // 调用 API
        const responseText = await callXAIAPI(message, updateStatus);
        log(`Received response of length: ${responseText.length}`);

        // 处理响应长度
        let finalText = responseText;
        if (responseText.length > POE_MAX_LENGTH) {
            const lastPeriod = responseText.lastIndexOf('。', POE_MAX_LENGTH);
            finalText = responseText.substring(0, lastPeriod > 0 ? lastPeriod + 1 : POE_MAX_LENGTH);
        }

        // 清除状态消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送
        const chunkSize = 1000;
        for (let i = 0; i < finalText.length; i += chunkSize) {
            const chunk = finalText.slice(i, i + chunkSize);
            sendSSE(res, 'text', { text: chunk });
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // 完成
        sendSSE(res, 'done', {});
        res.end();

    } catch (error) {
        log('Error in handleQuery:', error);
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
            log('Error sending error response:', finalError);
        }
    }
}

app.post('/', async (req, res) => {
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

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
    log('Uncaught Exception:', error);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error);
});
