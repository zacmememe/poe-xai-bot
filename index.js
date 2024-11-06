const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000;

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

// 处理对话历史
function formatMessages(query) {
    if (!Array.isArray(query)) return [];
    
    return query.map(msg => ({
        role: msg.role || 'user',
        content: msg.content
    }));
}

async function streamResponse(res, messages) {
    try {
        log('Starting streaming API call with messages:', messages);

        const response = await axios({
            method: 'post',
            url: 'https://api.x.ai/v1/chat/completions',
            headers: {
                'Authorization': `Bearer ${XAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                model: "grok-beta",
                messages: messages,
                stream: true,
                temperature: 0.7
            },
            responseType: 'stream'
        });

        sendSSE(res, 'replace_response', { text: '' });

        return new Promise((resolve, reject) => {
            let buffer = '';
            let totalResponse = '';
            
            response.data.on('data', chunk => {
                try {
                    buffer += chunk.toString();
                    
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
                                    const content = parsed.choices[0].delta.content;
                                    totalResponse += content;
                                    
                                    // 检查总长度
                                    if (totalResponse.length > POE_MAX_LENGTH) {
                                        cleanup(true);
                                        return;
                                    }
                                    
                                    sendSSE(res, 'text', { text: content });
                                }
                            } catch (e) {
                                log('JSON parse error:', e.message);
                            }
                        }
                    }
                } catch (error) {
                    log('Chunk processing error:', error.message);
                }
            });

            const cleanup = (truncated = false) => {
                if (truncated) {
                    sendSSE(res, 'text', { text: '\n\n[回复过长，已截断]' });
                }
                sendSSE(res, 'done', {});
                resolve();
            };

            response.data.on('end', () => cleanup(false));
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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // 处理查询和对话历史
        const query = req.body.query;
        if (!Array.isArray(query) || query.length === 0) {
            throw new Error('Invalid query format');
        }

        log('Received query:', {
            messageCount: query.length,
            lastMessage: query[query.length - 1]?.content
        });

        // 格式化完整的对话历史
        const messages = formatMessages(query);
        
        // 发送初始设置
        sendSSE(res, 'meta', {
            content_type: 'text/markdown',
            suggested_replies: true,
            allow_attachments: true,
            markdown_rendering_policy: {
                allow_font_families: true,
                allow_images: true,
                allow_lists: true,
                allow_tables: true
            }
        });

        // 开始流式响应
        await streamResponse(res, messages);

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

// 添加对话历史处理中间件
app.use((req, res, next) => {
    if (req.body.type === 'query') {
        log('Conversation history length:', req.body.query?.length);
    }
    next();
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
