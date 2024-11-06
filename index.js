const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;
const POE_MAX_LENGTH = 95000; // Poe 文档指定的最大长度限制

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

// 根据 Poe 文档添加建议回复
function getSuggestedResponses(context) {
    return [
        {
            text: "继续描写下去",
            message: "请继续描写春天的故事。"
        },
        {
            text: "加入更多细节",
            message: "能否添加一些关于春天的具体细节描写？"
        }
    ];
}

async function streamResponse(res, message) {
    let streamEnded = false;
    let accumulatedText = '';
    let lastSentLength = 0;

    try {
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

        // 清除等待消息
        sendSSE(res, 'replace_response', { text: '' });

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                if (!streamEnded) {
                    streamEnded = true;
                    
                    // 检查是否超过 POE 长度限制
                    if (accumulatedText.length > POE_MAX_LENGTH) {
                        const truncateIndex = accumulatedText.lastIndexOf('。', POE_MAX_LENGTH);
                        accumulatedText = accumulatedText.substring(0, truncateIndex + 1);
                        
                        // 添加截断提示
                        accumulatedText += '\n\n[内容较长已截断]';
                    }

                    // 发送剩余内容
                    if (accumulatedText.length > lastSentLength) {
                        const remainingText = accumulatedText.slice(lastSentLength);
                        sendSSE(res, 'text', { text: remainingText });
                    }

                    // 发送建议回复
                    const suggestions = getSuggestedResponses(accumulatedText);
                    sendSSE(res, 'suggested_responses', suggestions);

                    sendSSE(res, 'done', {});
                    resolve();
                }
            };

            response.data.on('data', chunk => {
                try {
                    const lines = chunk.toString().split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices?.[0]?.delta?.content) {
                                const content = data.choices[0].delta.content;
                                accumulatedText += content;

                                // 累积一定量的文本再发送
                                if (accumulatedText.length - lastSentLength >= 500) {
                                    const textToSend = accumulatedText.slice(lastSentLength);
                                    if (sendSSE(res, 'text', { text: textToSend })) {
                                        lastSentLength = accumulatedText.length;
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    log('Chunk processing error:', error.message);
                }
            });

            response.data.on('end', cleanup);
            response.data.on('error', error => {
                log('Stream error:', error.message);
                cleanup();
                reject(error);
            });
        });

    } catch (error) {
        log('API error:', error.message);
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

        // 发送初始设置
        sendSSE(res, 'meta', {
            content_type: "text/markdown",
            suggested_replies: true,
            allow_attachments: true,
            allow_retry: true,
            markdown_rendering_policy: {
                allow_font_families: true,
                allow_images: true,
                allow_lists: true,
                allow_tables: true
            }
        });

        // 初始提示
        sendSSE(res, 'text', { text: '正在生成回应...\n' });

        // 流式响应
        await streamResponse(res, message);

    } catch (error) {
        log('Request error:', error.message);
        
        if (!res.writableEnded) {
            sendSSE(res, 'error', {
                text: `生成回应时出错: ${error.message}`,
                allow_retry: true,
                error_type: error.response?.status === 429 ? 'rate_limit' : 'unknown'
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
