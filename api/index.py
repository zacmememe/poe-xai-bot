from fastapi import FastAPI, Request

app = FastAPI()

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/")
async def handle_message(request: Request):
    try:
        data = await request.json()
        return {"response": "Hello! This is a test response."}
    except Exception as e:
        return {"response": f"Error: {str(e)}"}
