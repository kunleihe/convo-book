from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from .database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String)

class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    book_id = Column(String, nullable=False)
    page_number = Column(Integer, nullable=False)
    sender = Column(String, nullable=False)  # "user" or "ai"
    text = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())