const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 流式发送响应
function startStream(res) {
    // 发送meta事件
    res.write('event: meta\ndata: {"content_type": "text/markdown"}\n\n');
}

function sendChunk(res, text) {
    res.write(`event: text\ndata: {"text": ${JSON.stringify(text)}}\n\n`);
}

function endStream(res) {
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
        timeout: 8000
    });
}

app.post('/', async (req, res) => {
    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        console.log('Request received:', new Date().toISOString());
        const message = req.body.query?.[0]?.content;
        
        if (!message) {
            throw new Error('No message content found');
        }

        // 立即开始流式响应
        startStream(res);

        // 发送等待消息
        sendChunk(res, "正在思考中...");

        // 调用API并处理响应
        let responseText;
        try {
            const response = await callXAI(message);
            responseText = response.data?.choices?.[0]?.message?.content;
        } catch (apiError) {
            console.error('API call failed, retrying once...', apiError);
            // 发送等待重试消息
            sendChunk(res, "\n重试中...");
            
            // 等待短暂时间后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            try {
                const response = await callXAI(message);
                responseText = response.data?.choices?.[0]?.message?.content;
            } catch (retryError) {
                throw new Error('API call failed after retry');
            }
        }

        if (!responseText) {
            throw new Error('Empty response from API');
        }

        // 清除等待消息
        sendChunk(res, "\n\n");

        // 分块发送实际响应
        const chunkSize = 50;
        for (let i = 0; i < responseText.length; i += chunkSize) {
            const chunk = responseText.slice(i, i + chunkSize);
            sendChunk(res, chunk);
            // 非常小的延迟以确保顺序
            await new Promise(resolve => setTimeout(resolve, 2));
        }

        // 完成响应
        endStream(res);

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
