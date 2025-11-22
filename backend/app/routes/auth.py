from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..s3_client import s3_client
from ..config import settings
import jwt
import datetime

class LoginRequest(BaseModel):
    username: str
    password: str

router = APIRouter()

@router.post("/login")
def login(login_request: LoginRequest):
    # 1. Fetch users from S3
    users = s3_client.read_json("config/users.json")
    if not users:
        # Fallback or error if users file is missing/empty
        raise HTTPException(status_code=500, detail="Authentication system unavailable")

    # 2. Find matching user
    user = next((u for u in users if u["username"] == login_request.username), None)
    
    # 3. Validate credentials (plain text comparison as requested)
    if not user or user["password"] != login_request.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # 4. Generate Token
    token = jwt.encode(
        {"sub": user["username"], "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM
    )
    return {"access_token": token}