import boto3
import json
from botocore.exceptions import ClientError
from botocore.config import Config
from .config import settings

class S3Client:
    def __init__(self):
        # Create an S3 client with boto3
        # Explicitly set signature version to v4 to avoid issues with presigned URLs
        self.s3_client = boto3.client(
            's3', 
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
            region_name=settings.AWS_REGION,
            config=Config(signature_version='s3v4')
        )
        self.bucket_name = settings.S3_BUCKET_NAME
    
    def check_file_exists(self, key: str) -> bool:
        """
        Check if a file exists in the S3 bucket 
        """
        try:
            # Use head_object to check if the file exists
            self.s3_client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError as e:
            if e.response['Error']['Code'] in ['404', 'NoSuchKey']:
                return False
            else:
                print(f"Error checking file existence: {e}")
                return False
    
    def read_json(self, key: str) -> dict:
        """
        Read a JSON file from the S3 bucket and return the data as a dictionary
        """
        try:
            # TODO: read JSON file from S3
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=key)
            file_content = response['Body'].read().decode('utf-8')
            return json.loads(file_content)
        except ClientError as e:
            print(f"Error reading JSON file from S3: {e}")
            return None
        except json.JSONDecodeError:
            print(f"Error decoding JSON file: {e}")
            return None

    def generate_download_url(self, object_name: str, expiration=3600):
        """
        Generate a presigned URL to download a file from the S3 bucket
        """
        try:
            # Generate presigned URL for the file
            response = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': object_name
                },
                ExpiresIn=expiration
            )
            return response
        except ClientError as e:
            print(f"Error generating presigned URL for the file: {e}")
            return None

    def generate_upload_url(self, object_name: str, file_type: str, expiration=3600):
        """
        Generate a presigned URL to upload a file to the S3 bucket
        """
        try:
            # Generate presigned URL for the file
            response = self.s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': object_name,
                    'ContentType': file_type
                },
                ExpiresIn=expiration
            )
            return response
        except ClientError as e:
            print(f"Error generating presigned URL for the file: {e}")
            return None

# Create a singleton instance of the S3Client so that it can be used across the application
s3_client = S3Client()