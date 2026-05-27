from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from typing import List, Any, Optional
import json
import uuid
from ..s3_client import s3_client

class EventsLog(BaseModel):
    username: str
    book_id: str
    page_number: int
    recording_started_at: Optional[str] = None
    events: List[Any] = []

router = APIRouter()

@router.post("/events/")
async def store_events(payload: EventsLog):
    """
    Store a session event log as JSON in S3.
    Path: user-data/{username}/{book_id}/page-{num}/events/{timestamp}-events-{uuid}.json
    """
    try:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        unique_id = str(uuid.uuid4())[:6]
        s3_key = (
            f"user-data/{payload.username}/{payload.book_id}/"
            f"page-{payload.page_number:02d}/events/"
            f"{timestamp}-events-{unique_id}.json"
        )
        s3_client.s3_client.put_object(
            Bucket=s3_client.bucket_name,
            Key=s3_key,
            Body=json.dumps(payload.model_dump(), indent=2),
            ContentType='application/json',
        )
        return {"s3_key": s3_key}
    except Exception as e:
        print(f"Error storing events: {e}")
        raise HTTPException(status_code=500, detail=str(e))
