from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.config import settings

health_check_router = APIRouter()

@health_check_router.get("/")
async def health_check():
    return {
        "status": "healthy",
        "message": "API is running",
        "environment": settings.ENVIRONMENT,
        "cors_origins": settings.CORS_ORIGINS
    }