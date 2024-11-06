from fastapi import FastAPI, Request
import xai
import os
from typing import Dict

app = FastAPI()
xai_client = xai.Client(os.getenv('XAI_API_KEY'))

@app.post("/")
async def handle_message(request: Request) -> Dict:
    try:
        data = await request.json()
        message = data.get("message", "")
        
        response = xai_client.completions.create(
            model="xai-chat-beta",
            prompt=message,
            max_tokens=1000
        )
        
        return {"response": response.choices[0].text}
    except Exception as e:
        return {"response": f"Error: {str(e)}"}

@app.get("/")
async def health_check():
    return {"status": "ok"}
