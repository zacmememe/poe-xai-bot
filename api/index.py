from fastapi import FastAPI, Request
from typing import Dict
import os

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/")
async def handle_message(request: Request) -> Dict:
    try:
        data = await request.json()
        return {"response": "test message"}  # 先测试基本功能
    except Exception as e:
        return {"response": f"Error: {str(e)}"}
