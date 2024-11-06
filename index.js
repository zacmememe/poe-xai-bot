const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// SSE 事件发送函数
function sendSSE(res, event, data) {
    try {
        if (!res.writableEnded) {
            const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
            res.write(eventString);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Failed to send SSE event ${event}:`, error);
        return false;
    }
}

// 分块发送长文本
async function sendLongResponse(res, text) {
    try {
        // 发送 meta 事件
        sendSSE(res, 'meta', { content_type: 'text/markdown' });

        // 按照较小的块发送文本
        const chunkSize = 1000; // 每次发送1000字符
        let position = 0;

        while (position < text.length) {
            const chunk = text.slice(position, position + chunkSize);
            sendSSE(res, 'text', { text: chunk });
            position += chunkSize;
            // 小延迟以确保顺序发送
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // 发送完成事件
        sendSSE(res, 'done', {});
        res.end();
        return true;
    } catch (error) {
        console.error('Error in sendLongResponse:', error);
        return false;
    }
}

// 错误响应发送函数
function sendErrorResponse(res, errorMessage) {
    try {
        if (!res.writableEnded) {
            sendSSE(res, 'error', { 
                text: errorMessage,
                allow_retry: true 
            });
            sendSSE(res, 'done', {});
            res.end();
        }
    } catch (error) {
        console.error('Error sending error response:', error);
    }
}

app.post('/', async (req, res) => {
    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        console.log('Received request:', JSON.stringify(req.body, null, 2));

        const query = req.body.query;
        const lastMessage = Array.isArray(query) && query.length > 0 
            ? query[query.length - 1] 
            : null;

        if (!lastMessage?.content) {
            sendErrorResponse(res, 'No message content found');
            return;
        }

        // 调用 X.AI API，带重试机制
        let retries = 2;
        let xaiResponse;
        
        while (retries >= 0) {
            try {
                xaiResponse = await axios({
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
                            content: lastMessage.content
                        }],
                        stream: false,
                        max_tokens: 4000  // 增加到4000 tokens，约等于16000字符
                    },
                    timeout: 30000  // 增加超时时间到30秒
                });
                break;
            } catch (error) {
                if (retries === 0) throw error;
                retries--;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        const responseText = xaiResponse?.data?.choices?.[0]?.message?.content;

        if (!responseText) {
            sendErrorResponse(res, 'No response from X.AI');
            return;
        }

        // 使用分块发送长响应
        const success = await sendLongResponse(res, responseText);
        if (!success) {
            throw new Error('Failed to send complete response');
        }

    } catch (error) {
        console.error('Error occurred:', error);
        sendErrorResponse(res, `Error: ${error.message}`);
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok' });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`API Key configured: ${!!XAI_API_KEY}`);
});

// 错误处理
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});
