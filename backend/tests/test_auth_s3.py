import sys
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

# Add the backend directory to sys.path to allow importing app modules
# This assumes the test file is located at backend/tests/test_auth_s3.py
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.main import app

class TestAuthS3(unittest.TestCase):
    def setUp(self):
        # Create a TestClient to make requests to the FastAPI app
        self.client = TestClient(app)
        
    # Mock s3_client.read_json method
    # This allows us to test the auth logic without making actual network calls to S3
    @patch('app.routes.auth.s3_client.read_json')
    def test_login_success(self, mock_read_json):
        """
        Test successful login scenario.
        """
        # 1. Mock the user data returned from S3
        mock_read_json.return_value = [
            {"username": "test_user", "password": "password123", "role": "user"},
            {"username": "admin", "password": "admin_pass", "role": "admin"}
        ]

        # 2. Send login request
        payload = {
            "username": "test_user",
            "password": "password123"
        }
        # Note: The URL prefix might vary depending on your main.py router inclusion.
        # Assuming it's included as /api/auth or similar. Let's try the likely path.
        # If main.py includes it as app.include_router(auth.router, prefix="/api/auth")
        response = self.client.post("/api/auth/login", json=payload)

        # 3. Verify response
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("access_token", data)
        print("\n✅ Login Success Test Passed!")

    @patch('app.routes.auth.s3_client.read_json')
    def test_login_failure_wrong_password(self, mock_read_json):
        """
        Test login failure due to incorrect password.
        """
        mock_read_json.return_value = [
            {"username": "test_user", "password": "password123"}
        ]

        payload = {
            "username": "test_user",
            "password": "wrong_password"
        }
        response = self.client.post("/api/auth/login", json=payload)

        self.assertEqual(response.status_code, 401)
        print("✅ Wrong Password Test Passed!")

    @patch('app.routes.auth.s3_client.read_json')
    def test_login_failure_user_not_found(self, mock_read_json):
        """
        Test login failure due to non-existent user.
        """
        mock_read_json.return_value = [
            {"username": "test_user", "password": "password123"}
        ]

        payload = {
            "username": "ghost_user",
            "password": "password123"
        }
        response = self.client.post("/api/auth/login", json=payload)

        self.assertEqual(response.status_code, 401)
        print("✅ User Not Found Test Passed!")

    @patch('app.routes.auth.s3_client.read_json')
    def test_s3_failure(self, mock_read_json):
        """
        Test handling of S3 unavailability (e.g., file missing or read error).
        """
        # Mock read_json returning None (indicating failure)
        mock_read_json.return_value = None

        payload = {"username": "test", "password": "123"}
        response = self.client.post("/api/auth/login", json=payload)

        # Expecting 500 Internal Server Error as per our implementation
        self.assertEqual(response.status_code, 500)
        print("✅ S3 Failure Handling Test Passed!")

if __name__ == '__main__':
    unittest.main()
