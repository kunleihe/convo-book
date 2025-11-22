import sys
import os
import requests
from fastapi.testclient import TestClient

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.main import app

def test_upload_flow():
    print("🚀 Starting Upload Flow Integration Test...")
    
    client = TestClient(app)
    
    # 1. Request Upload URL
    # ---------------------
    print("\n--- 1. Requesting Upload URL ---")
    payload = {
        "filename": "test_recording.webm",
        "content_type": "video/webm",
        "book_id": "speed-racer",
        "page_number": 1,
        "stage": "read",
        "username": "test_user"
    }
    
    response = client.post("/api/upload-url", json=payload)
    
    if response.status_code != 200:
        print(f"❌ API Error: {response.text}")
        return

    data = response.json()
    upload_url = data['upload_url']
    s3_key = data['key']
    print(f"✅ Got Upload URL!")
    print(f"🔑 S3 Key: {s3_key}")
    print(f"🔗 URL: {upload_url[:50]}...")

    # 2. Perform Actual Upload (Simulate Frontend)
    # --------------------------------------------
    print("\n--- 2. Simulating Frontend Upload ---")
    
    # Create dummy video content
    dummy_content = b"FAKE VIDEO CONTENT"
    
    # PUT request to S3
    # Important: Headers must match what was signed (Content-Type)
    s3_response = requests.put(
        upload_url, 
        data=dummy_content,
        headers={"Content-Type": "video/webm"}
    )
    
    if s3_response.status_code == 200:
        print("✅ Upload Successful! (S3 returned 200 OK)")
        print(f"🎉 File should now be at: s3://{s3_key}")
    else:
        print(f"❌ Upload Failed: {s3_response.status_code}")
        print(s3_response.text)

if __name__ == "__main__":
    test_upload_flow()