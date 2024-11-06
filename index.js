const express = require('express');
const axios = require('axios');
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

// 模拟API响应以测试流程
function getFallbackResponse(error) {
    return `抱歉，API暂时无法访问。错误信息：${error.message}\n\n这是一个测试响应，用于验证消息传递系统是否正常工作。`;
}

async function makeAPICall(content) {
    try {
        log('Starting API call');
        
        // 添加请求拦截器记录请求信息
        axios.interceptors.request.use(config => {
            log('API Request:', {
                url: config.url,
                method: config.method,
                headers: {
                    ...config.headers,
                    'Authorization': 'Bearer [HIDDEN]'
                }
            });
            return config;
        });

        // 添加响应拦截器记录响应信息
        axios.interceptors.response.use(
            response => {
                log('API Response received:', {
                    status: response.status,
                    headers: response.headers
                });
                return response;
            },
            error => {
                log('API Response error:', {
                    message: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                });
                throw error;
            }
        );

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
                temperature: 0.7,
                max_tokens: 2000
            },
            timeout: 15000,
            validateStatus: status => status === 200
        });

        const responseText = response.data?.choices?.[0]?.message?.content;
        if (!responseText) {
            throw new Error('API返回数据格式无效');
        }

        return responseText;

    } catch (error) {
        log('API Error details:', {
            message: error.message,
            code: error.code,
            response: error.response?.data
        });

        // 返回一个应急响应
        return getFallbackResponse(error);
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

    let responseSent = false;

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('未找到消息内容');
        }

        log('Starting request processing');

        // 发送初始消息
        sendSSE(res, 'meta', { content_type: 'text/markdown' });
        sendSSE(res, 'replace_response', { text: '正在处理请求...\n\n' });
        
        // 发送连接测试消息
        sendSSE(res, 'text', { text: '连接测试成功，正在调用API...\n\n' });
        
        // API调用
        log('Calling API');
        const responseText = await makeAPICall(message);
        log('API call completed', { responseLength: responseText.length });

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        // 分块发送响应
        const chunkSize = 500;
        let position = 0;
        while (position < responseText.length) {
            const chunk = responseText.slice(position, position + chunkSize);
            if (!sendSSE(res, 'text', { text: chunk })) {
                throw new Error('发送响应块失败');
            }
            position += chunkSize;
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        responseSent = true;
        sendSSE(res, 'done', {});
        res.end();
        log('Response completed successfully');

    } catch (error) {
        log('Error in request handler:', error.message);

        if (!responseSent && !res.writableEnded) {
            try {
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

// 全局错误处理
process.on('uncaughtException', error => {
    log('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error.message);
});
