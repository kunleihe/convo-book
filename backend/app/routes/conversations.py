from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional
from ..db.database import SessionLocal
from ..db.models import Conversation, User
from ..auth import get_current_user

class ConversationCreate(BaseModel):
    book_id: str
    page_number: int
    sender: str  # "user" or "ai"
    text: str

class ConversationResponse(BaseModel):
    id: int
    book_id: str
    page_number: int
    sender: str
    text: str
    timestamp: datetime

    class Config:
        from_attributes = True

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/conversations/", response_model=ConversationResponse)
def store_conversation(
    conversation: ConversationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Store a new conversation message"""
    db_conversation = Conversation(
        user_id=current_user.id,
        book_id=conversation.book_id,
        page_number=conversation.page_number,
        sender=conversation.sender,
        text=conversation.text
    )
    db.add(db_conversation)
    db.commit()
    db.refresh(db_conversation)
    return db_conversation

@router.get("/conversations/", response_model=List[ConversationResponse])
def get_conversations(
    book_id: Optional[str] = None,
    page_number: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get conversation history for a user, optionally filtered by book/page"""
    query = db.query(Conversation).filter(Conversation.user_id == current_user.id)
    
    if book_id:
        query = query.filter(Conversation.book_id == book_id)
    if page_number is not None:
        query = query.filter(Conversation.page_number == page_number)
    
    return query.order_by(Conversation.timestamp).all() 