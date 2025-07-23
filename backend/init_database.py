#!/usr/bin/env python3
"""
Database initialization script for different environments

To run this script:
export ENVIRONMENT=staging
export DATABASE_URL=your_rds_connection_string
python init_database.py
"""
import os
import sys
from app.db.database import Base, engine
from app.db.add_users import add_users
from app.config import ENVIRONMENT, SQLALCHEMY_DATABASE_URL

def init_database():
    """Initialize database for current environment"""
    print(f"Initializing database for environment: {ENVIRONMENT}")
    print(f"Database URL: {SQLALCHEMY_DATABASE_URL}")
    
    try:
        # Create all tables
        Base.metadata.create_all(bind=engine)
        print("✅ Database tables created successfully")
        
        # Add default users
        add_users()
        print("✅ Default users added successfully")
        
        print(f"🎉 Database initialized for {ENVIRONMENT} environment!")
        
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    init_database() 