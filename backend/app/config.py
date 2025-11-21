import os
from dotenv import load_dotenv

# Determine environment and load appropriate .env file
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
env_file = f".env.{ENVIRONMENT}"
env_path = os.path.join(os.path.dirname(__file__), env_file)

# Fallback to .env if environment-specific file doesn't exist
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(__file__), '.env')

load_dotenv(env_path)

# Re-read environment after loading the file (in case it was set in the .env file)
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# Configuration variables
VENDOR_WS_URL = os.getenv("OPENAI_REALTIME_URL")
API_KEY = os.getenv("OPENAI_API_KEY")
USE_AZURE_OPENAI = bool(os.getenv("USE_AZURE_OPENAI"))

# Transcription-specific configuration
OPENAI_REST_BASE_URL = "https://api.openai.com/v1"
OPENAI_TRANSCRIPTION_WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription"

# CORS Configuration - Environment Aware
def get_cors_origins():
    """Get CORS allowed origins based on environment"""
    # 无论是 production 还是 staging，都优先尝试从环境变量读取
    if ENVIRONMENT in ["production", "staging"]:
        origins = []
        
        # 1. 从环境变量获取 
        frontend_url = os.getenv("FRONTEND_URL")
        if frontend_url:
            # 如果包含逗号，分割成列表；否则作为单个 URL
            if "," in frontend_url:
                origins.extend([url.strip() for url in frontend_url.split(",")])
            else:
                origins.append(frontend_url)
        
        # 2. 对于 Staging，保留一些默认值方便调试 (可选)
        if ENVIRONMENT == "staging":
            origins.append("http://localhost:5173")
            # 你也可以保留旧的硬编码地址，也可以删掉
            
        return origins
        
    else:
        # Development origins (default)
        return [
            "http://localhost:5173",
            "http://localhost:8000",
        ]

CORS_ORIGINS = get_cors_origins()

# Session Configuration for OpenAI Realtime API
SESSION_CONFIG = {
    "instructions": "You are a helpful voice assistant. Please respond with both text and audio. Always provide an audio response.",
    "voice": "shimmer",  # Options: alloy, echo, fable, onyx, nova, shimmer
    "input_audio_format": "pcm16",
    "output_audio_format": "pcm16",
    "modalities": ["text", "audio"],
    "input_audio_transcription": {
        "model": "whisper-1"
    },
    "turn_detection": None
}

# Transcription Configuration for OpenAI Transcription API
TRANSCRIPTION_CONFIG = {
    "input_audio_format": "pcm16",
    "input_audio_transcription": {
        "model": "gpt-4o-transcribe",
        "prompt": "",
        "language": "en"
    },
    "turn_detection": None,
    "input_audio_noise_reduction": {
        "type": "near_field"
    },
    "include": [
        "item.input_audio_transcription.logprobs"
    ]
}

# Database Configuration - Environment Aware
def get_database_url():
    """Get database URL based on environment"""
    if ENVIRONMENT == "production":
        # Will use RDS for production later
        db_url = os.getenv("DATABASE_URL")
        if db_url:
            return db_url
        else:
            # Fallback to SQLite for now (will be migrated to RDS later)
            return "sqlite:///./app_prod.db"
    elif ENVIRONMENT == "staging":
        # Use RDS for staging
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable must be set for staging environment")
        return db_url
    else:
        # Keep SQLite for local development
        return "sqlite:///./app_dev.db"

SQLALCHEMY_DATABASE_URL = get_database_url()

# JWT Configuration
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# Configuration Validation
def validate_environment_config():
    """Validate that all required environment variables are set"""
    required_vars = {
        'development': ['OPENAI_API_KEY'],
        'staging': ['OPENAI_API_KEY', 'DATABASE_URL', 'JWT_SECRET_KEY'],
        'production': ['OPENAI_API_KEY', 'DATABASE_URL', 'JWT_SECRET_KEY']
    }
    
    missing_vars = []
    for var in required_vars.get(ENVIRONMENT, []):
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        raise ValueError(f"Missing required environment variables for {ENVIRONMENT}: {missing_vars}")

# Validate JWT_SECRET_KEY and generate for development
if ENVIRONMENT == "production" and not JWT_SECRET_KEY:
    raise ValueError("JWT_SECRET_KEY environment variable must be set in production")
elif not JWT_SECRET_KEY:
    # Generate a random key for development (will change on restart)
    import secrets
    JWT_SECRET_KEY = secrets.token_urlsafe(64)
    print("⚠️  Using auto-generated JWT secret key for development. Set JWT_SECRET_KEY in .env for persistence.")

# Run validation
validate_environment_config()

# Print environment info for debugging
print(f"🔧 Environment: {ENVIRONMENT}")
print(f"📂 Config file: {env_path}")
print(f"🗄️  Database: {SQLALCHEMY_DATABASE_URL}")
print(f"🌐 CORS Origins: {CORS_ORIGINS}")