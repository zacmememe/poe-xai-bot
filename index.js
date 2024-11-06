const express = require('express');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

function log(msg, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`, data ? JSON.stringify(data) : '');
}

function sendSSE(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch (error) {
        log('SSE Error:', error.message);
        return false;
    }
}

async function makeAPICall(content) {
    log('Starting API call with fetch');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${XAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "grok-beta",
                messages: [{
                    role: 'user',
                    content: content
                }],
                temperature: 0.7,
                max_tokens: 2000
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        log('API Response status:', response.status);

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        log('API Response received:', { 
            hasChoices: !!data.choices,
            choicesLength: data.choices?.length
        });

        return data.choices?.[0]?.message?.content || '抱歉，API返回了空响应。';

    } catch (error) {
        clearTimeout(timeout);
        log('API Call Error:', error.message);
        throw error;
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

    let responseStarted = false;

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('未找到消息内容');
        }

        log('Processing request:', { content: message });

        // 发送初始消息
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'replace_response', { text: '正在处理请求...\n\n' });
        responseStarted = true;

        // 发送连接测试消息
        sendSSE(res, 'text', { text: '连接测试成功，正在调用API...\n\n' });

        // 设置超时保护
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('请求超时')), 20000);
        });

        // API调用
        const responseText = await Promise.race([
            makeAPICall(message),
            timeoutPromise
        ]);

        log('Response received:', { length: responseText.length });

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送响应
        const chunkSize = 500;
        for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            if (!sendSSE(res, 'text', { text: chunk })) {
                throw new Error('发送响应块失败');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        sendSSE(res, 'done', {});
        res.end();
        log('Response completed successfully');

    } catch (error) {
        log('Request handler error:', error.message);

        if (!res.writableEnded) {
            try {
                if (!responseStarted) {
                    sendSSE(res, 'meta', { content_type: 'text/markdown' });
                }
                sendSSE(res, 'error', {
                    text: `处理请求时出错: ${error.message}`,
                    allow_retry: true
                });
                sendSSE(res, 'done', {});
                res.end();
            } catch (finalError) {
                log('Error sending error response:', finalError.message);
            }
        }
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    log('Server started', { port, hasAPIKey: !!XAI_API_KEY });
});

process.on('uncaughtException', error => {
    log('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error.message);
});
