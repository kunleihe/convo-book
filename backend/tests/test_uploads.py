import sys
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.main import app

class TestUploadsAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        
    @patch('app.routes.uploads.s3_client')
    def test_generate_upload_url_success(self, mock_s3_client):
        """
        Test successful generation of upload URL with correct path structure.
        """
        # 1. Mock the s3_client response
        mock_url = "https://s3.amazonaws.com/fake-presigned-url"
        mock_s3_client.generate_upload_url.return_value = mock_url
        
        # 2. Prepare valid payload
        payload = {
            "filename": "test_recording.webm",
            "content_type": "video/webm",
            "book_id": "Speed-Racer", 
            "page_number": 1,
            "stage": "read", 
            "username": "test_user"
        }
        
        # 3. Call the API
        response = self.client.post("/api/upload-url", json=payload)
        
        # 4. Assertions
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertEqual(data['upload_url'], mock_url)
        
        # Verify the S3 Key structure (Now including 'media/')
        # Expected: user-data/test_user/Speed-Racer/page-01/media/read-{timestamp}-{uuid}.webm
        generated_key = data['key']
        expected_prefix = "user-data/test_user/Speed-Racer/page-01/media/read-"
        
        self.assertTrue(generated_key.startswith(expected_prefix), 
                        f"Key '{generated_key}' does not start with '{expected_prefix}'")
        self.assertTrue(generated_key.endswith(".webm"))
        
        print("\n✅ Upload URL Generation Test Passed!")

    def test_missing_fields_validation(self):
        """
        Test that the API rejects requests missing required fields.
        """
        # Missing 'book_id', 'stage', etc.
        payload = {
            "filename": "test.webm",
            "content_type": "video/webm"
        }
        
        response = self.client.post("/api/upload-url", json=payload)
        
        # FastAPI/Pydantic should return 422 Unprocessable Entity
        self.assertEqual(response.status_code, 422)
        print("✅ Missing Fields Validation Test Passed!")

if __name__ == '__main__':
    unittest.main()