const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000; // 设置略小于100k的安全值

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

        // API 调用，设置较大的token限制以获取最长可能的响应
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
                max_tokens: 8000, // 大约对应32000个字符
                temperature: 0.7
            },
            timeout: 30000
        });

        let responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('Empty response from API');
        }

        log(`Initial response length: ${responseText.length} chars`);

        // 确保不超过Poe限制
        if (responseText.length > POE_MAX_LENGTH) {
            // 找到最后一个完整句子的结尾
            let cutoffIndex = POE_MAX_LENGTH;
            const lastPeriod = responseText.lastIndexOf('。', POE_MAX_LENGTH);
            if (lastPeriod > POE_MAX_LENGTH * 0.8) { // 至少保留80%的内容
                cutoffIndex = lastPeriod + 1;
            }
            responseText = responseText.substring(0, cutoffIndex);
        }

        log(`Final response length: ${responseText.length} chars`);

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 高效分块发送
        const chunkSize = 1000; // 较大的块大小以提高效率
        let position = 0;

        while (position < responseText.length) {
            const chunk = responseText.slice(position, position + chunkSize);
            const success = sendSSE(res, 'text', { text: chunk });
            
            if (!success) {
                throw new Error('Failed to send chunk');
            }

            position += chunkSize;
            
            // 最小延迟以确保顺序性
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // 发送完成事件
        sendSSE(res, 'done', {});
        res.end();
        log(`Successfully sent response of ${responseText.length} chars`);

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
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    // 设置较长的超时时间
    req.setTimeout(45000);
    res.setTimeout(45000);

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
