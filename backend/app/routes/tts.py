from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import load_model_settings

tts_router = APIRouter()


class TTSRequest(BaseModel):
    text: str


@tts_router.post("/tts")
async def tts(request: TTSRequest):
    client = AsyncOpenAI()

    tts_cfg = load_model_settings()["ttsModel"]

    async def generate():
        async with client.audio.speech.with_streaming_response.create(
            model=tts_cfg["model"],
            voice=tts_cfg["voice"],
            input=request.text,
            response_format=tts_cfg["responseFormat"],
            # speed parameter is ignored by gpt-4o-mini-tts (known OpenAI bug);
            # use instructions to control speaking rate instead.
            instructions=tts_cfg["instructions"],
        ) as response:
            async for chunk in response.iter_bytes(1024):
                yield chunk

    return StreamingResponse(generate(), media_type="audio/mpeg")
