const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

function log(msg, data = null) {
    console.log(`[${new Date().toISOString()}] ${msg}`, data ? JSON.stringify(data) : '');
}

function sendSSE(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch (error) {
        log(`SSE Error: ${error.message}`);
        return false;
    }
}

async function streamResponse(res, message) {
    try {
        log('Starting streaming API call');

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
                stream: true,
                temperature: 0.7
            },
            responseType: 'stream'
        });

        // 清除初始等待消息
        sendSSE(res, 'replace_response', { text: '' });

        return new Promise((resolve, reject) => {
            let buffer = '';
            
            response.data.on('data', chunk => {
                try {
                    // 将新的数据添加到缓冲区
                    buffer += chunk.toString();
                    
                    // 处理缓冲区中的完整数据行
                    while (true) {
                        const newlineIndex = buffer.indexOf('\n');
                        if (newlineIndex === -1) break;
                        
                        const line = buffer.slice(0, newlineIndex);
                        buffer = buffer.slice(newlineIndex + 1);
                        
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;
                            
                            try {
                                const parsed = JSON.parse(data);
                                if (parsed.choices?.[0]?.delta?.content) {
                                    // 立即发送每个字符
                                    sendSSE(res, 'text', { 
                                        text: parsed.choices[0].delta.content 
                                    });
                                }
                            } catch (e) {
                                log('JSON parse error:', e.message);
                                log('Problematic data:', data);
                            }
                        }
                    }
                } catch (error) {
                    log('Chunk processing error:', error.message);
                }
            });

            response.data.on('end', () => {
                // 处理缓冲区中剩余的数据
                if (buffer.length > 0) {
                    const lines = buffer.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line.length > 6) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.choices?.[0]?.delta?.content) {
                                    sendSSE(res, 'text', { 
                                        text: data.choices[0].delta.content 
                                    });
                                }
                            } catch (e) {
                                log('Final JSON parse error:', e.message);
                            }
                        }
                    }
                }

                // 完成流式传输
                sendSSE(res, 'done', {});
                resolve();
                log('Stream completed successfully');
            });

            response.data.on('error', error => {
                log('Stream error:', error.message);
                reject(error);
            });
        });

    } catch (error) {
        log('Streaming error:', error.message);
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

    try {
        const message = req.body.query?.[req.body.query.length - 1]?.content;
        if (!message) {
            throw new Error('No message content');
        }

        // 发送初始事件
        sendSSE(res, 'meta', {
            content_type: 'text/markdown',
            suggested_replies: true,
            allow_attachments: true,
            markdown_rendering_policy: {
                allow_font_families: true,
                allow_images: true
            }
        });
        
        // 开始流式响应
        await streamResponse(res, message);

    } catch (error) {
        log('Error:', error.message);
        
        if (!res.writableEnded) {
            sendSSE(res, 'error', {
                text: `错误: ${error.message}`,
                allow_retry: true
            });
            sendSSE(res, 'done', {});
        }
        res.end();
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'ok' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    log('Server started', { port });
});

// 错误处理
process.on('uncaughtException', error => {
    log('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', error => {
    log('Unhandled Rejection:', error.message);
});
