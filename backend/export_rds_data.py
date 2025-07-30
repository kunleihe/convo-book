#!/usr/bin/env python3
"""
Export data from RDS (PostgreSQL) to CSV files
Usage:
1. Set RDS connection via DATABASE_URL environment variable
2. Run: python export_rds_data.py
"""

import os
import sys
import csv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.models import User, Conversation

def export_to_csv():
    """Export data from RDS to CSV files"""
    
    # Target: RDS PostgreSQL
    rds_url = os.getenv("DATABASE_URL")
    if not rds_url:
        print("❌ DATABASE_URL environment variable not set")
        sys.exit(1)
    
    if not rds_url.startswith("postgresql"):
        print("❌ DATABASE_URL must be a PostgreSQL connection string")
        sys.exit(1)
    
    # Create database connection
    try:
        rds_engine = create_engine(rds_url)
        RDSSession = sessionmaker(bind=rds_engine)
        session = RDSSession()
        
        print("🔄 Connecting to RDS database...")
        
        # Export Users table
        print("👥 Exporting users to CSV...")
        users = session.query(User).all()
        
        with open('users.csv', 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            # Write header
            writer.writerow(['id', 'username', 'password'])
            
            # Write data
            for user in users:
                writer.writerow([user.id, user.username, user.password])
        
        print(f"   ✅ Exported {len(users)} users to users.csv")
        
        # Export Conversations table
        print("💬 Exporting conversations to CSV...")
        conversations = session.query(Conversation).all()
        
        with open('conversations.csv', 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            # Write header
            writer.writerow(['id', 'user_id', 'book_id', 'page_number', 'question_id', 'sender', 'text', 'timestamp'])
            
            # Write data
            for conv in conversations:
                writer.writerow([
                    conv.id, 
                    conv.user_id, 
                    conv.book_id, 
                    conv.page_number, 
                    conv.question_id,
                    conv.sender, 
                    conv.text, 
                    conv.timestamp
                ])
        
        print(f"   ✅ Exported {len(conversations)} conversations to conversations.csv")
        
        # Summary
        print(f"\n🎉 Export completed successfully!")
        print(f"   📁 Files created:")
        print(f"     - users.csv ({len(users)} records)")
        print(f"     - conversations.csv ({len(conversations)} records)")
        
    except Exception as e:
        print(f"❌ Export failed: {e}")
        sys.exit(1)
    
    finally:
        session.close()

if __name__ == "__main__":
    export_to_csv() 