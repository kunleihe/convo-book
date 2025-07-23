from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from ..db.database import SessionLocal
from ..db.models import User
from ..config import JWT_SECRET_KEY, JWT_ALGORITHM, JWT_ACCESS_TOKEN_EXPIRE_MINUTES
import jwt
import datetime

class LoginRequest(BaseModel):
    username: str
    password: str

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/login")
def login(login_request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == login_request.username).first()
    if not user or user.password != login_request.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = jwt.encode(
        {"sub": user.username, "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)},
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM
    )
    return {"access_token": token}