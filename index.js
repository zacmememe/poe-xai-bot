const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

function log(msg, data = null) {
    const logMsg = data ? `${msg} ${JSON.stringify(data)}` : msg;
    console.log(`[${new Date().toISOString()}] ${logMsg}`);
}

function sendSSE(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function makeAPICall(content, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            log(`API attempt ${attempt}/${retries}`);
            
            const response = await axios({
                method: 'post',
                url: 'https://api.x.ai/v1/chat/completions',
                headers: {
                    'Authorization': `Bearer ${XAI_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                data: {
                    model: "grok-beta",
                    messages: [{
                        role: 'user',
                        content: content
                    }],
                    temperature: 0.7,
                    max_tokens: 2000
                },
                validateStatus: null, // 允许任何状态码
                timeout: 10000
            });

            log('API Response Status:', response.status);

            if (response.status !== 200) {
                throw new Error(`API returned status ${response.status}: ${JSON.stringify(response.data)}`);
            }

            const responseText = response.data?.choices?.[0]?.message?.content;
            if (!responseText) {
                throw new Error('API response missing content');
            }

            return responseText;

        } catch (error) {
            log('API Error:', {
                attempt,
                error: error.message,
                response: error.response?.data
            });

            if (attempt === retries) {
                throw error;
            }

            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

app.post('/', async (req, res) => {
    if (req.body.type !== 'query') {
        return res.json({ status: 'ok' });
    }

    log('Query received:', { type: req.body.type });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let responseStarted = false;

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        // 初始响应
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'replace_response', { text: '正在处理请求...\n\n' });
        responseStarted = true;

        // 调用API
        const responseText = await makeAPICall(message);
        log('API call successful, response length:', responseText.length);

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 发送测试消息
        const testResponse = '测试响应：我收到了你的请求，正在处理中。API调用已完成，这是一个测试消息。';
        sendSSE(res, 'text', { text: testResponse });

        sendSSE(res, 'done', {});
        res.end();
        log('Response completed');

    } catch (error) {
        log('Error occurred:', {
            message: error.message,
            responseStarted
        });

        if (!res.writableEnded) {
            if (!responseStarted) {
                sendSSE(res, 'meta', { content_type: 'text/markdown' });
            }
            sendSSE(res, 'error', {
                text: `处理请求时出错: ${error.message}`,
                allow_retry: true
            });
            sendSSE(res, 'done', {});
            res.end();
        }
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    log('Server started on port:', port);
});

// 错误处理
process.on('uncaughtException', error => {
    log('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error.message);
});
