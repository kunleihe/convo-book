import unittest
from unittest.mock import MagicMock, patch, mock_open
import os
import sys
import json

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# We need to patch boto3 BEFORE importing the script to prevent
# the S3Client from trying to connect to AWS during module import.
with patch('boto3.client'):
    from scripts.manage_s3_users import sync_users_to_s3

class TestManageS3Users(unittest.TestCase):

    def setUp(self):
        # We need to patch the 's3_client' OBJECT that was imported into manage_s3_users.
        # Since we already imported the function, the module is loaded.
        # We can patch 'scripts.manage_s3_users.s3_client'.
        
        self.s3_client_patcher = patch('scripts.manage_s3_users.s3_client')
        self.mock_s3_wrapper = self.s3_client_patcher.start()
        
        # The script uses s3_client.read_json and s3_client.s3_client.put_object
        # So we need to ensure our mock structure matches that.
        
        # Mock the internal boto3 client inside the wrapper
        self.mock_s3_wrapper.s3_client = MagicMock()
        
        # Mock S3_BUCKET_NAME
        self.bucket_patcher = patch('scripts.manage_s3_users.S3_BUCKET_NAME', 'test-bucket')
        self.bucket_patcher.start()

    def tearDown(self):
        self.s3_client_patcher.stop()
        self.bucket_patcher.stop()

    def test_sync_users_initial_upload(self):
        """Test uploading users when S3 is empty (First run)"""
        
        # Mock CSV content
        csv_content = "username,password\ntest1,pass1\ntest2,pass2"
        
        # Mock read_json to return None (simulating file not found/empty)
        self.mock_s3_wrapper.read_json.return_value = None
        
        # Mock file opening
        with patch("builtins.open", mock_open(read_data=csv_content)):
            with patch("scripts.manage_s3_users.os.path.exists", return_value=True):
                # Run the function
                sync_users_to_s3("dummy_path.csv")
            
            # Verify read_json was called
            self.mock_s3_wrapper.read_json.assert_called_once_with("config/users.json")
            
            # Verify put_object was called
            # The script calls: s3_client.s3_client.put_object(...)
            call_args = self.mock_s3_wrapper.s3_client.put_object.call_args
            self.assertIsNotNone(call_args, "put_object should have been called")
            
            _, kwargs = call_args
            uploaded_data = json.loads(kwargs['Body'])
            
            # Assertions
            self.assertEqual(len(uploaded_data), 2)
            self.assertEqual(uploaded_data[0]['username'], 'test1')
            self.assertEqual(uploaded_data[1]['username'], 'test2')
            self.assertEqual(kwargs['Bucket'], 'test-bucket')
            self.assertEqual(kwargs['Key'], 'config/users.json')

    def test_sync_users_merge_update(self):
        """Test merging new users with existing ones (Update run)"""
        
        # Mock CSV content (one new user, one existing)
        csv_content = "username,password\ntest1,pass1\nnew_user,new_pass"
        
        # Mock S3 existing data (test1 already exists)
        existing_data = [{"username": "test1", "password": "old_pass"}]
        self.mock_s3_wrapper.read_json.return_value = existing_data
        
        with patch("builtins.open", mock_open(read_data=csv_content)):
            with patch("scripts.manage_s3_users.os.path.exists", return_value=True):
                sync_users_to_s3("dummy_path.csv")
            
            # Verify upload
            _, kwargs = self.mock_s3_wrapper.s3_client.put_object.call_args
            uploaded_data = json.loads(kwargs['Body'])
            
            # Should now have 2 users
            self.assertEqual(len(uploaded_data), 2)
            
            # Check deduplication: test1 should keep OLD password (skipped update)
            user_map = {u['username']: u for u in uploaded_data}
            self.assertEqual(user_map['test1']['password'], 'old_pass')
            self.assertEqual(user_map['new_user']['password'], 'new_pass')

    def test_sync_users_no_change(self):
        """Test when all users in CSV already exist (Idempotency)"""
        
        # Mock CSV content
        csv_content = "username,password\ntest1,pass1"
        
        # Mock S3 existing data
        existing_data = [{"username": "test1", "password": "pass1"}]
        self.mock_s3_wrapper.read_json.return_value = existing_data
        
        with patch("builtins.open", mock_open(read_data=csv_content)):
            with patch("scripts.manage_s3_users.os.path.exists", return_value=True):
                sync_users_to_s3("dummy_path.csv")
            
            # Verify put_object was NOT called
            self.mock_s3_wrapper.s3_client.put_object.assert_not_called()

if __name__ == '__main__':
    unittest.main()
