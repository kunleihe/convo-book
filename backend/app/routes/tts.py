from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

tts_router = APIRouter()


class TTSRequest(BaseModel):
    text: str


@tts_router.post("/tts")
async def tts(request: TTSRequest):
    client = AsyncOpenAI()

    async def generate():
        async with client.audio.speech.with_streaming_response.create(
            model="gpt-4o-mini-tts",
            voice="sage",
            input=request.text,
            response_format="mp3",
            # speed parameter is ignored by gpt-4o-mini-tts (known OpenAI bug);
            # use instructions to control speaking rate instead.
            instructions="Speak slowly and clearly, suitable for young children aged 6-8.",
        ) as response:
            async for chunk in response.iter_bytes(1024):
                yield chunk

    return StreamingResponse(generate(), media_type="audio/mpeg")
