import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import load_model_settings

chat_router = APIRouter()


class ChatRequest(BaseModel):
    transcript: str
    page_text: str
    question_text: str
    custom_prompt: Optional[str] = None
    round_number: int = 1
    conversation_history: List[dict] = []


def _normalize_is_final(raw) -> bool:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str) and raw.lower() == "true":
        return True
    if raw is None:
        return True
    return False


@chat_router.post("/chat")
async def chat(request: ChatRequest):
    settings = load_model_settings()

    if request.round_number == 1:
        template = settings["round1PromptTemplate"]
    else:
        template = settings["round2PromptTemplate"]

    if request.custom_prompt:
        custom_prompt_block = (
            f"{request.custom_prompt}\n\n"
            f"You may also refer to the reference passage below:"
        )
    else:
        custom_prompt_block = "the reference passage below:"

    system_prompt = (
        template
        .replace("${pageText}", request.page_text)
        .replace("${questionText}", request.question_text)
        .replace("${CUSTOM_PROMPT_BLOCK}", custom_prompt_block)
    )

    messages = [
        {"role": "system", "content": system_prompt},
        *request.conversation_history,
        {"role": "user", "content": request.transcript},
    ]

    temperature = settings["textModel"]["temperature"]
    model = settings["textModel"]["model"]

    client = AsyncOpenAI()
    completion = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        response_format={"type": "json_object"},
    )

    raw_content = completion.choices[0].message.content
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {raw_content}")

    response_text = parsed.get("response", "")
    if not response_text:
        raise HTTPException(status_code=502, detail="Model response missing 'response' field")

    if request.round_number >= 2:
        is_final = True
    else:
        is_final = _normalize_is_final(parsed.get("is_final"))

    return {"response": response_text, "is_final": is_final}
