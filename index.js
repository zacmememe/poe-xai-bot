const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const XAI_API_KEY = process.env.XAI_API_KEY;

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res) => {
  try {
    console.log('Received request:', JSON.stringify(req.body));

    const query = req.body.query;
    let messageContent = '';
    
    if (Array.isArray(query)) {
      const lastMessage = query[query.length - 1];
      messageContent = lastMessage.content || '';
    } else {
      messageContent = query || '';
    }

    if (!messageContent) {
      return res.json({ text: 'No query provided' });
    }

    const xaiResponse = await axios({
      method: 'post',
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: "default", // 改用 default 作为模型名称
        messages: [{
          role: 'user',
          content: messageContent
        }],
        stream: false
      }
    });

    console.log('X.AI Response:', JSON.stringify(xaiResponse.data));

    if (!xaiResponse.data?.choices?.[0]?.message?.content) {
      return res.json({ text: 'No response content from X.AI' });
    }

    return res.json({
      text: xaiResponse.data.choices[0].message.content
    });

  } catch (error) {
    console.error('Error details:', {
      message: error.message,
      data: error.response?.data,
      status: error.response?.status,
      request: error.config?.data
    });

    return res.json({
      text: `Error: ${error.message}. ${error.response?.data?.error || ''}`
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log(`API Key present: ${!!XAI_API_KEY}`);
});
