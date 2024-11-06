const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 分块发送响应
async function streamResponse(res, text, chunkSize = 50) {
    // 1. 发送meta事件
    res.write('event: meta\ndata: {"content_type": "text/markdown"}\n\n');
    
    // 2. 分块发送文本
    for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        res.write(`event: text\ndata: {"text": ${JSON.stringify(chunk)}}\n\n`);
        // 减少延迟时间
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    // 3. 发送完成事件
    res.write('event: done\ndata: {}\n\n');
    res.end();
}

// API调用函数
async function callXAI(message) {
    return axios({
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
            stream: false,
            max_tokens: 1000,
            temperature: 0.7
        },
        timeout: 10000 // 10秒超时
    });
}

app.post('/', async (req, res) => {
    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 设置响应超时
    res.setTimeout(15000);

    try {
        console.log('Request received:', new Date().toISOString());
        console.log('Request body:', JSON.stringify(req.body, null, 2));

        // 获取消息内容
        const message = req.body.query?.[0]?.content;
        if (!message) {
            throw new Error('No message content found');
        }

        // 添加超时控制
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 12000)
        );

        // 带重试的API调用
        const apiCallWithRetry = async () => {
            for (let i = 0; i < 2; i++) {
                try {
                    const response = await callXAI(message);
                    return response.data?.choices?.[0]?.message?.content;
                } catch (error) {
                    if (i === 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        };

        // 竞争Promise
        const responseText = await Promise.race([
            apiCallWithRetry(),
            timeoutPromise
        ]);

        if (!responseText) {
            throw new Error('Empty response from API');
        }

        console.log('Response length:', responseText.length);
        await streamResponse(res, responseText);

    } catch (error) {
        console.error('Error occurred:', error);
        
        try {
            if (!res.writableEnded) {
                res.write('event: error\n');
                res.write(`data: {"text": "Error: ${error.message}", "allow_retry": true}\n\n`);
                res.write('event: done\ndata: {}\n\n');
                res.end();
            }
        } catch (finalError) {
            console.error('Error sending error response:', finalError);
        }
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
