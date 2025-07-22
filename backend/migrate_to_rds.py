#!/usr/bin/env python3
"""
Migration script to transfer data from SQLite to RDS (PostgreSQL)
Usage:
1. Set source SQLite database path
2. Set target RDS connection via DATABASE_URL environment variable
3. Run: python migrate_to_rds.py
"""

import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.models import User, Conversation

def migrate_data():
    """Migrate data from SQLite to RDS"""
    
    # Source: SQLite database
    sqlite_path = os.getenv("SOURCE_SQLITE_PATH", "./app_dev.db")
    if not os.path.exists(sqlite_path):
        print(f"❌ Source SQLite database not found: {sqlite_path}")
        sys.exit(1)
    
    sqlite_url = f"sqlite:///{sqlite_path}"
    sqlite_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    SQLiteSession = sessionmaker(bind=sqlite_engine)
    
    # Target: RDS PostgreSQL
    rds_url = os.getenv("DATABASE_URL")
    if not rds_url:
        print("❌ DATABASE_URL environment variable not set")
        sys.exit(1)
    
    if not rds_url.startswith("postgresql"):
        print("❌ DATABASE_URL must be a PostgreSQL connection string")
        sys.exit(1)
    
    rds_engine = create_engine(rds_url)
    RDSSession = sessionmaker(bind=rds_engine)
    
    print(f"🔄 Migrating data from {sqlite_path} to RDS...")
    
    try:
        # Create sessions
        sqlite_session = SQLiteSession()
        rds_session = RDSSession()
        
        # Migrate Users
        print("👥 Migrating users...")
        users = sqlite_session.query(User).all()
        
        for user in users:
            # Check if user already exists in RDS
            existing_user = rds_session.query(User).filter(User.username == user.username).first()
            if existing_user:
                print(f"   ⚠️  User {user.username} already exists, skipping...")
                continue
            
            # Create new user in RDS
            new_user = User(
                username=user.username,
                email=user.email,
                password_hash=user.password_hash
            )
            rds_session.add(new_user)
            print(f"   ✅ Migrated user: {user.username}")
        
        rds_session.commit()
        
        # Migrate Conversations
        print("💬 Migrating conversations...")
        conversations = sqlite_session.query(Conversation).all()
        
        for conv in conversations:
            # Get user ID from RDS (may be different from SQLite)
            sqlite_user = sqlite_session.query(User).filter(User.id == conv.user_id).first()
            if not sqlite_user:
                print(f"   ⚠️  User for conversation {conv.id} not found, skipping...")
                continue
            
            rds_user = rds_session.query(User).filter(User.username == sqlite_user.username).first()
            if not rds_user:
                print(f"   ⚠️  User {sqlite_user.username} not found in RDS, skipping conversation...")
                continue
            
            # Create new conversation in RDS
            new_conv = Conversation(
                user_id=rds_user.id,  # Use RDS user ID
                book_id=conv.book_id,
                page_number=conv.page_number,
                sender=conv.sender,
                text=conv.text,
                timestamp=conv.timestamp
            )
            rds_session.add(new_conv)
            print(f"   ✅ Migrated conversation: {conv.id}")
        
        rds_session.commit()
        
        # Summary
        users_migrated = rds_session.query(User).count()
        conversations_migrated = rds_session.query(Conversation).count()
        
        print(f"\n🎉 Migration completed successfully!")
        print(f"   👥 Users: {users_migrated}")
        print(f"   💬 Conversations: {conversations_migrated}")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        rds_session.rollback()
        sys.exit(1)
    
    finally:
        sqlite_session.close()
        rds_session.close()

if __name__ == "__main__":
    migrate_data() 