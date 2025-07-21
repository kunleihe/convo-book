from ..db.database import SessionLocal
from ..db.models import User
import bcrypt

users_to_add = [
    ("user1", "1234"),
    ("user2", "1234"),
    ("user3", "1234"),
]

def add_users():
    db = SessionLocal()
    for username, password in users_to_add:
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        # check if user already exists
        existing_user = db.query(User).filter(User.username == username).first()
        if existing_user:
            print(f"User {username} already exists")
            continue
        user = User(username=username, password_hash=password_hash.decode('utf-8'))
        db.add(user)
    db.commit()
    db.close()

if __name__ == "__main__":
    add_users()