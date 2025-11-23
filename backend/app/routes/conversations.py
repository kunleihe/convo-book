from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
import json
import uuid
from ..s3_client import s3_client

class ConversationCreate(BaseModel):
    book_id: str
    page_number: int
    question_id: str
    sender: str  # "user" or "ai"
    text: str
    username: str # Explicitly passed by frontend for MVP

class ConversationResponse(BaseModel):
    # Simply mirror what was saved
    book_id: str
    page_number: int
    question_id: str
    sender: str
    text: str
    timestamp: str
    s3_key: str

router = APIRouter()

@router.post("/conversations/", response_model=ConversationResponse)
async def store_conversation(conversation: ConversationCreate):
    """
    Store a conversation message as a JSON file in S3.
    Path: user-data/{username}/{book_id}/page-{num}/conversations/{timestamp}-{sender}-{uuid}.json
    """
    try:
        # 1. Generate Timestamp and ID
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        unique_id = str(uuid.uuid4())[:6]
        
        # 2. Construct S3 Key
        s3_key = (
            f"user-data/{conversation.username}/{conversation.book_id}/"
            f"page-{conversation.page_number:02d}/conversations/"
            f"{timestamp}-{conversation.sender}-{unique_id}.json"
        )
        
        # 3. Prepare Data Payload
        data = {
            "book_id": conversation.book_id,
            "page_number": conversation.page_number,
            "question_id": conversation.question_id,
            "sender": conversation.sender,
            "text": conversation.text,
            "username": conversation.username,
            "timestamp": datetime.now().isoformat(), # Store ISO format in file
            "client_timestamp": timestamp
        }
        
        # 4. Upload to S3
        s3_client.s3_client.put_object(
            Bucket=s3_client.bucket_name,
            Key=s3_key,
            Body=json.dumps(data, indent=2),
            ContentType='application/json'
        )
        
        return {
            "book_id": conversation.book_id,
            "page_number": conversation.page_number,
            "question_id": conversation.question_id,
            "sender": conversation.sender,
            "text": conversation.text,
            "timestamp": data["timestamp"],
            "s3_key": s3_key
        }
        
    except Exception as e:
        print(f"Error storing conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations/")
def get_conversations():
    """
    Get conversations. 
    NOTE: For MVP with S3 storage, listing and aggregating individual JSON files 
    is inefficient and complex. 
    
    Frontend should manage session history in local state.
    This endpoint is disabled/placeholder for now.
    """
    return []