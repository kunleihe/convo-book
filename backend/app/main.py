from contextlib import asynccontextmanager
from fastapi import FastAPI
# from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.routes.health_check import health_check_router
from app.routes.realtime import realtime_router
from app.routes.books import books_router
from app.routes.prompts import prompts_router
from app.routes.auth import router as auth_router
from app.routes.conversations import router as conversations_router
from app.routes.uploads import router as uploads_router
from app.routes.chat import chat_router
from app.config import settings, env_path

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    print(f"🔧 Environment: {settings.ENVIRONMENT}")
    print(f"📂 Config file: {env_path}")
    print(f"🌐 CORS Origins: {settings.CORS_ORIGINS}")
    yield
    # Shutdown logic

app = FastAPI(
    title="Convo Book API", 
    description="Real-time communication hub",
    lifespan=lifespan
)

# Add CORS middleware - dynamically configured based on environment
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(health_check_router, prefix="/health")
app.include_router(realtime_router)
app.include_router(books_router, prefix="/api")
app.include_router(prompts_router, prefix="/api")
app.include_router(auth_router, prefix="/api/auth")
app.include_router(conversations_router, prefix="/api", tags=["conversations"])
app.include_router(uploads_router, prefix="/api", tags=["uploads"])
app.include_router(chat_router, prefix="/api")

# Root API endpoint
@app.get("/")
async def root():
    return {"message": "Convo Book API", "status": "running", "docs": "/docs"}