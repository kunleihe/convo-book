import csv
import json
import sys
import os

# Add backend directory to sys.path to allow importing app modules
# Assuming this script is located at backend/scripts/manage_s3_users.py
# We need to go up one level to 'backend' to import 'app'
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.s3_client import s3_client
from app.config import settings

S3_BUCKET_NAME = settings.S3_BUCKET_NAME

def sync_users_to_s3(csv_file_path):
    """
    Reads users from a CSV file and updates the 'config/users.json' file in S3.
    It merges new users with existing ones, preventing duplicates based on username.
    Existing users in S3 are preserved.
    """
    s3_key = "config/users.json"
    
    # 1. Validate CSV file existence
    if not os.path.exists(csv_file_path):
        print(f"❌ Error: CSV file not found at {csv_file_path}")
        return

    print(f"📂 Reading new users from {csv_file_path}...")
    new_users = []
    try:
        with open(csv_file_path, mode='r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Ensure CSV contains required columns
                if 'username' in row and 'password' in row:
                    new_users.append({
                        "username": row['username'].strip(),
                        "password": row['password'].strip()
                    })
    except Exception as e:
        print(f"❌ Error reading CSV: {e}")
        return

    if not new_users:
        print("⚠️  No users found in CSV.")
        return
        
    print(f"   Found {len(new_users)} users in CSV.")

    # 2. Fetch existing users from S3
    print(f"☁️  Fetching existing users from S3 ({s3_key})...")
    existing_users = s3_client.read_json(s3_key)
    
    if existing_users is None:
        existing_users = []
        print("   No existing config found on S3. Starting fresh.")
    else:
        print(f"   Found {len(existing_users)} existing users on S3.")

    # 3. Merge and deduplicate data
    # Use a dictionary keyed by username to handle deduplication.
    # Strategy: If user already exists, SKIP adding (preserve old password/data).
    user_map = {u['username']: u for u in existing_users}
    
    added_count = 0
    for user in new_users:
        if user['username'] not in user_map:
            user_map[user['username']] = user
            added_count += 1
        else:
            # User exists. skipping update to preserve existing data.
            # If password updates are required, uncomment the line below:
            # user_map[user['username']] = user
            pass 

    if added_count == 0:
        print("✅ All users from CSV already exist in S3. Nothing to update.")
        return

    # 4. Convert back to list and upload to S3
    final_user_list = list(user_map.values())
    
    print(f"📤 Uploading {len(final_user_list)} users to S3 (Added {added_count} new)...")
    try:
        updated_json = json.dumps(final_user_list, indent=2)
        s3_client.s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            Body=updated_json,
            ContentType='application/json'
        )
        print("✅ Successfully updated S3 user config!")
        
    except Exception as e:
        print(f"❌ Failed to upload to S3: {e}")

if __name__ == "__main__":
    # Default CSV path: backend/data/users/prod_users.csv
    # Assuming script is run from backend root or backend/scripts
    
    # Try to find the default file relative to this script
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # backend/
    default_csv_path = os.path.join(base_dir, "data", "users", "prod_users.csv")
    
    csv_path = default_csv_path
    
    # Allow overriding via command line argument
    if len(sys.argv) > 1:
        csv_path = sys.argv[1]
        
    sync_users_to_s3(csv_path)

