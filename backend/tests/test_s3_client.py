import unittest
from unittest.mock import MagicMock, patch
import os
import sys

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# We need to patch boto3 client creation BEFORE importing s3_client
# to avoid actual AWS connection attempts during import if configured so.
# However, since we are importing the singleton 's3_client' which is already instantiated
# at the top level of 'app.s3_client', we need to be careful.
# If 'app.s3_client' was already imported elsewhere, patching here might be too late for the class init.
# But for a fresh test run, this usually works.
# More robustly, we can patch the instance attribute in setUp.

# For the import to work without AWS creds, we patch boto3.client
with patch('boto3.client'):
    from app.s3_client import s3_client, S3_BUCKET_NAME

class TestS3Client(unittest.TestCase):
    
    def setUp(self):
        # Ensure the internal boto3 client is a mock.
        # Since s3_client is a singleton, we can replace its internal client directly.
        self.mock_boto = MagicMock()
        s3_client.s3_client = self.mock_boto
        
    def test_check_file_exists(self):
        """Test checking if a file exists"""
        # Case 1: File exists
        # head_object returns normally (no exception)
        exists = s3_client.check_file_exists("existing_file.json")
        self.assertTrue(exists)
        self.mock_boto.head_object.assert_called_with(Bucket=S3_BUCKET_NAME, Key="existing_file.json")
        
        # Case 2: File does not exist (ClientError 404)
        from botocore.exceptions import ClientError
        # Create a mock response that resembles a 404 error
        error_response = {'Error': {'Code': '404', 'Message': 'Not Found'}}
        self.mock_boto.head_object.side_effect = ClientError(error_response, 'HeadObject')
        
        exists = s3_client.check_file_exists("missing_file.json")
        self.assertFalse(exists)

    def test_generate_download_url(self):
        """Test generating a presigned download URL"""
        expected_url = "https://s3.amazonaws.com/bucket/test.png?signature=fake"
        self.mock_boto.generate_presigned_url.return_value = expected_url
        
        url = s3_client.generate_download_url("test/book_cover.png")
        
        self.assertEqual(url, expected_url)
        self.mock_boto.generate_presigned_url.assert_called_with(
            'get_object',
            Params={'Bucket': S3_BUCKET_NAME, 'Key': 'test/book_cover.png'},
            ExpiresIn=3600
        )

    def test_generate_upload_url(self):
        """Test generating a presigned upload URL"""
        expected_url = "https://s3.amazonaws.com/bucket/upload?signature=fake"
        self.mock_boto.generate_presigned_url.return_value = expected_url
        
        url = s3_client.generate_upload_url("test/user_video.webm", "video/webm")
        
        self.assertEqual(url, expected_url)
        self.mock_boto.generate_presigned_url.assert_called_with(
            'put_object',
            Params={
                'Bucket': S3_BUCKET_NAME, 
                'Key': 'test/user_video.webm',
                'ContentType': 'video/webm'
            },
            ExpiresIn=3600
        )

if __name__ == '__main__':
    unittest.main()
