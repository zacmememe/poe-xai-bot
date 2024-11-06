const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

// 流式响应处理
async function streamResponse(res, responseText) {
    try {
        // 1. 发送 meta 事件
        res.write('event: meta\ndata: {"content_type": "text/markdown"}\n\n');
        
        // 2. 开始发送文本，每25个字符一个块
        const chunks = responseText.match(/.{1,25}/g) || [];
        
        for (const chunk of chunks) {
            res.write(`event: text\ndata: {"text": ${JSON.stringify(chunk)}}\n\n`);
            // 使用极小的延迟确保顺序发送
            await new Promise(resolve => setTimeout(resolve, 1));
        }

        // 3. 发送完成事件
        res.write('event: done\ndata: {}\n\n');
        res.end();
        
        return true;
    } catch (error) {
        console.error('Error in streamResponse:', error);
        return false;
    }
}

app.post('/', async (req, res) => {
    // 设置响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // 设置更长的超时时间
    req.setTimeout(60000);
    res.setTimeout(60000);

    try {
        const query = req.body.query;
        const lastMessage = Array.isArray(query) && query.length > 0 
            ? query[query.length - 1] 
            : null;

        if (!lastMessage?.content) {
            throw new Error('No message content found');
        }

        // 配置API调用
        const apiConfig = {
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
                max_tokens: 8000,  // 显著增加token限制
                temperature: 0.7
            },
            timeout: 45000  // 45秒超时
        };

        // 开始立即发送初始响应
        res.write('event: text\ndata: {"text": "正在生成响应..."}\n\n');

        // 执行API调用
        let response;
        try {
            response = await axios(apiConfig);
        } catch (error) {
            console.error('First API call failed, retrying...');
            // 等待1秒后重试
            await new Promise(resolve => setTimeout(resolve, 1000));
            response = await axios(apiConfig);
        }

        const responseText = response?.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('No response content from API');
        }

        // 清除初始消息
        res.write('event: replace_response\ndata: {"text": ""}\n\n');

        // 流式发送实际响应
        const success = await streamResponse(res, responseText);
        if (!success) {
            throw new Error('Failed to stream response');
        }

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
