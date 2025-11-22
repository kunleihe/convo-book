from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
import uuid
import datetime
from ..s3_client import s3_client

router = APIRouter()

class UploadRequest(BaseModel):
    # Frontend sends the original filename (e.g. "blob.webm"), but we will ignore it 
    # and generate a structured name on the backend.
    filename: str          
    content_type: str
    
    # Metadata for structured storage
    # book_id: e.g. "speed-racer"
    book_id: str
    
    # page_number: e.g. 1
    page_number: int
    
    # stage: e.g. "read", "answer"
    stage: str
    
    # Optional: Associated username. 
    # In production, this should be parsed from JWT. For now, allow explicit pass.
    username: Optional[str] = "guest" 

@router.post("/upload-url")
async def generate_upload_url(request: UploadRequest):
    """
    Generate a pre-signed S3 URL for file upload with structured path.
    
    Path Format (Kebab Case):
    user-data/{username}/{book-id}/page-{num}/{stage}-{timestamp}-{uuid}.{ext}
    """
    try:
        # 1. Prepare components for the path
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        unique_id = str(uuid.uuid4())[:6]
        
        # Extract extension from original filename, default to webm
        extension = request.filename.split('.')[-1] if '.' in request.filename else "webm"
        
        # Ensure stage is kebab-case friendly (e.g. "read_aloud" -> "read-aloud")
        safe_stage = request.stage.replace("_", "-").lower()
        
        # 2. Construct S3 Key
        s3_key = (
            f"user-data/{request.username}/{request.book_id}/"
            f"page-{request.page_number:02d}/"
            f"{safe_stage}-{timestamp}-{unique_id}.{extension}"
        )
        
        # 3. Generate pre-signed URL
        upload_url = s3_client.generate_upload_url(
            object_name=s3_key,
            file_type=request.content_type,
            expiration=3600
        )
        
        if not upload_url:
            raise HTTPException(status_code=500, detail="Failed to generate upload URL")
            
        return {
            "upload_url": upload_url,
            "key": s3_key,
            "expires_in": 3600
        }
        
    except Exception as e:
        print(f"Error generating upload URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))