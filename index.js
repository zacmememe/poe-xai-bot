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
    // Poe sends the message in this format
    const query = req.body.query || '';
    
    const response = await axios({
      method: 'post',
      url: 'https://api.x.ai/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        messages: [{
          role: 'user',
          content: query
        }]
      }
    });

    // Poe expects response in this format
    res.json({ 
      text: response.data.choices[0].message.content
    });
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.json({ 
      text: `Error: ${error.message}`
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
