#!/usr/bin/env python3
"""
Simple User Addition Script
Adds users for the current environment without resetting database.
Usage: python add_users.py

cd backend
export ENVIRONMENT=development # or staging/production
python add_users.py
"""

import sys
from app.db.add_users import add_users
from app.config import ENVIRONMENT

def add_users_simple():
    """Add users for current environment"""
    
    print(f"👥 Adding users for environment: {ENVIRONMENT}")
    
    try:
        add_users()
        print("\n✅ User addition completed!")
        
    except Exception as e:
        print(f"❌ User addition failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    add_users_simple() 