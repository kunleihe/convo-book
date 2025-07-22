from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from ..config import SQLALCHEMY_DATABASE_URL, ENVIRONMENT

# Configure engine based on database type
if ENVIRONMENT in ["staging", "production"] and SQLALCHEMY_DATABASE_URL.startswith("postgresql"):
    # PostgreSQL configuration for RDS
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
else:
    # SQLite configuration for local development
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()