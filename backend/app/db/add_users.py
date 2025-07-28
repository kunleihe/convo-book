from ..db.database import SessionLocal
from ..db.models import User

users_to_add = [
    ("user1", "1234"),
    ("user2", "1234"),
    ("user3", "1234"),
    ("user4", "1234"),
    ("user5", "1234"),
    ("user6", "1234"),
    ("user7", "1234"),
    ("user8", "1234"),
    ("user9", "1234"),
    ("user10", "1234"),
]

def add_users():
    db = SessionLocal()
    for username, password in users_to_add:
        # check if user already exists
        existing_user = db.query(User).filter(User.username == username).first()
        if existing_user:
            print(f"User {username} already exists")
            continue
        user = User(username=username, password=password)
        db.add(user)
    db.commit()
    db.close()

if __name__ == "__main__":
    add_users()


# run this in the terminal in /backend to add users 
# export ENVIRONMENT=staging
# python -c "from app.db.add_users import add_users; add_users()"