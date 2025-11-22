#!/usr/bin/env python3
"""
Database Setup Script
Resets database and adds users for the current environment.
Usage: python setup_database.py

cd backend
export ENVIRONMENT=development  # or staging/production
python setup_database.py
"""

import os
import sys
from app.db.database import Base, engine
from app.db.add_users import add_users
from app.config import settings

def setup_database():
    """Reset database and add users"""
    
    print(f"🔄 Setting up database for environment: {settings.ENVIRONMENT}")
    print(f"📂 Database URL: {settings.SQLALCHEMY_DATABASE_URL}")
    
    # Safety check for production
    if settings.ENVIRONMENT == "production":
        confirm = input("⚠️  You are about to reset the PRODUCTION database. Type 'YES' to confirm: ")
        if confirm != "YES":
            print("❌ Database setup cancelled")
            return
    
    try:
        # Drop all tables
        print("🗑️  Dropping all existing tables...")
        Base.metadata.drop_all(bind=engine)
        print("   ✅ All tables dropped")
        
        # Create all tables with new schema
        print("🏗️  Creating tables with new schema...")
        Base.metadata.create_all(bind=engine)
        print("   ✅ All tables created")
        
        # Add users
        print("👥 Adding users...")
        add_users()
        print("   ✅ Users added")
        
        print("\n🎉 Database setup completed successfully!")
        
    except Exception as e:
        print(f"❌ Database setup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    setup_database() 