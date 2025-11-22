import os
import secrets
from typing import List, Optional
from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

# --- Determine environment and load appropriate .env file ---
# We perform this before instantiating Settings to ensure environment variables are set
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
env_file = f".env.{ENVIRONMENT}"
env_path = os.path.join(os.path.dirname(__file__), env_file)

# Fallback to .env if environment-specific file doesn't exist
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(__file__), '.env')

load_dotenv(env_path, override=True)

class Settings(BaseSettings):
    # Application Environment
    ENVIRONMENT: str = Field(default="development", validation_alias="ENVIRONMENT")
    
    # OpenAI Configuration
    VENDOR_WS_URL: Optional[str] = Field(default=None, validation_alias="OPENAI_REALTIME_URL")
    API_KEY: Optional[str] = Field(default=None, validation_alias="OPENAI_API_KEY")
    USE_AZURE_OPENAI: bool = Field(default=False, validation_alias="USE_AZURE_OPENAI")
    
    OPENAI_REST_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_TRANSCRIPTION_WS_URL: str = "wss://api.openai.com/v1/realtime?intent=transcription"
    
    # Database Configuration
    DATABASE_URL: Optional[str] = None
    
    # JWT Configuration
    JWT_SECRET_KEY: Optional[str] = None
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    
    # AWS S3 Configuration
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: Optional[str] = None
    S3_BUCKET_NAME: Optional[str] = None
    
    # Frontend Configuration (for CORS)
    FRONTEND_URL: Optional[str] = None

    model_config = SettingsConfigDict(extra="ignore")

    @computed_field
    def SQLALCHEMY_DATABASE_URL(self) -> str:
        """Get database URL based on environment"""
        if self.ENVIRONMENT == "production":
            # Will use RDS for production later
            if self.DATABASE_URL:
                return self.DATABASE_URL
            else:
                # Fallback to SQLite for now (will be migrated to RDS later)
                return "sqlite:///./app_prod.db"
        elif self.ENVIRONMENT == "staging":
            # Use RDS for staging
            if not self.DATABASE_URL:
                raise ValueError("DATABASE_URL environment variable must be set for staging environment")
            return self.DATABASE_URL
        else:
            # Keep SQLite for local development
            return "sqlite:///./app_dev.db"

    @computed_field
    def CORS_ORIGINS(self) -> List[str]:
        """Get CORS allowed origins based on environment"""
        if self.ENVIRONMENT in ["production", "staging"]:
            origins = []
            
            # 1. Get from environment variable
            if self.FRONTEND_URL:
                if "," in self.FRONTEND_URL:
                    origins.extend([url.strip() for url in self.FRONTEND_URL.split(",")])
                else:
                    origins.append(self.FRONTEND_URL)
            
            # 2. For Staging, keep some defaults for debugging (optional)
            if self.ENVIRONMENT == "staging":
                origins.append("http://localhost:5173")
                
            return origins
        else:
            # Development origins (default)
            return [
                "http://localhost:5173",
                "http://localhost:8000",
            ]

    def model_post_init(self, __context):
        """Validate environment and handle dynamic defaults"""
        # Validation logic
        required_vars = {
            'staging': ['API_KEY', 'DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET_NAME'],
            'production': ['API_KEY', 'DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET_NAME']
        }
        
        # Check required vars for current environment
        missing_vars = []
        # Note: We check against 'self' attributes, but we need the field names.
        # Since we mapped alias, we need to check the attribute names.
        # Let's map the checking logic manually to attribute names.
        
        # Map concept to attribute
        var_map = {
            'API_KEY': self.API_KEY,
            'DATABASE_URL': self.DATABASE_URL,
            'AWS_ACCESS_KEY_ID': self.AWS_ACCESS_KEY_ID,
            'AWS_SECRET_ACCESS_KEY': self.AWS_SECRET_ACCESS_KEY,
            'AWS_REGION': self.AWS_REGION,
            'S3_BUCKET_NAME': self.S3_BUCKET_NAME,
            'JWT_SECRET_KEY': self.JWT_SECRET_KEY
        }

        if self.ENVIRONMENT in required_vars:
            for var_name in required_vars[self.ENVIRONMENT]:
                if not var_map.get(var_name):
                    missing_vars.append(var_name)
            
            if self.ENVIRONMENT == "production" and not self.JWT_SECRET_KEY:
                 missing_vars.append("JWT_SECRET_KEY")

        if missing_vars:
            raise ValueError(f"Missing required environment variables for {self.ENVIRONMENT}: {missing_vars}")

        # Handle JWT Secret for Development
        if not self.JWT_SECRET_KEY:
            if self.ENVIRONMENT == "production":
                 # Already caught above, but safety check
                 pass 
            else:
                # Generate a random key for development
                self.JWT_SECRET_KEY = secrets.token_urlsafe(64)
                print("⚠️  Using auto-generated JWT secret key for development. Set JWT_SECRET_KEY in .env for persistence.")

# --- Configuration Constants (non-sensitive) ---
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

# Instantiate settings
settings = Settings()

# Print environment info for debugging (optional, kept for consistency with old behavior)
print(f"🔧 Environment: {settings.ENVIRONMENT}")
print(f"📂 Config file: {env_path}")
print(f"🗄️  Database: {settings.SQLALCHEMY_DATABASE_URL}")
print(f"🌐 CORS Origins: {settings.CORS_ORIGINS}")
