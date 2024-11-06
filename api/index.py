from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/")
async def handle_message():
    return {"response": "test response"}
