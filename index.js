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

// 简单的 SSE 发送函数
function sendSSE(res, event, data) {
    const eventString = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    log(`Sending ${event} event`);
    return res.write(eventString);
}

async function handleQuery(req, res) {
    try {
        const lastMessage = req.body.query?.[req.body.query.length - 1];
        
        if (!lastMessage?.content) {
            throw new Error('Invalid message content');
        }

        // 发送初始元数据
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        
        // 发送等待消息
        sendSSE(res, 'text', { text: '正在生成回应...\n\n' });

        // 调用 API
        log('Calling X.AI API');
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
                    content: lastMessage.content
                }],
                max_tokens: 8000,
                temperature: 0.7
            },
            timeout: 30000
        });

        const responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('Empty API response');
        }

        log(`Received response of length: ${responseText.length}`);

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送响应
        const chunkSize = 100;
        for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            sendSSE(res, 'text', { text: chunk });
            // 最小延迟以确保顺序
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        // 发送完成事件
        sendSSE(res, 'done', {});
        res.end();

    } catch (error) {
        log('Error in handleQuery:', error.message);
        sendSSE(res, 'error', { 
            text: `Error: ${error.message}`,
            allow_retry: true
        });
        sendSSE(res, 'done', {});
        res.end();
    }
}

app.post('/', async (req, res) => {
    // 记录请求
    log('Received request', { type: req.body.type });

    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 根据请求类型处理
    switch (req.body.type) {
        case 'query':
            await handleQuery(req, res);
            break;
        case 'report_error':
            log('Received error report', req.body);
            res.json({ status: 'ok' });
            break;
        case 'report_feedback':
            log('Received feedback', req.body);
            res.json({ status: 'ok' });
            break;
        default:
            log('Received unknown request type', req.body);
            res.json({ status: 'ok' });
    }
});

// 健康检查端点
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
