import csv
import os
from ..db.database import SessionLocal
from ..db.models import User
from ..config import settings

def get_users():
    if settings.ENVIRONMENT == "development":
        from .users.development_users import USERS
        return USERS
    elif settings.ENVIRONMENT == "staging":
        from .users.staging_users import USERS
        return USERS
    elif settings.ENVIRONMENT == "production":
        csv_path = os.path.join(os.path.dirname(__file__), "users", "production_users.csv")
        users = []
        with open(csv_path, 'r') as file:
            reader = csv.DictReader(file)
            for row in reader:
                users.append((row['username'], row['password']))
        return users

def add_users():
    users = get_users()
    db = SessionLocal()
    
    for username, password in users:
        existing = db.query(User).filter(User.username == username).first()
        if not existing:
            user = User(username=username, password=password)
            db.add(user)
            print(f"Added: {username}")
        else:
            print(f"Skipped: {username} (exists)")
    
    db.commit()
    db.close()

if __name__ == "__main__":
    add_users()