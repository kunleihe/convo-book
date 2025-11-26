import sys
import os
import unittest
import requests
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.routes.books import scan_available_books, load_book_data


class TestBooksS3Urls(unittest.TestCase):
    
    def test_scan_books(self):
        """Test scanning books from local directory"""
        print("\n--- Testing Local Book Scan ---")
        books = scan_available_books()
        print(f"Found books: {books}")
        
        self.assertIsInstance(books, list)
        if len(books) > 0:
            print("✅ Successfully found local books.")
        else:
            print("⚠️  No local books found. Please check 'backend/data/books/'")

    def test_s3_urls(self):
        """Test that all S3 URLs in book data are valid (return 200)"""
        print("\n--- Testing S3 URL Validity ---")
        
        books = scan_available_books()
        if not books:
            self.skipTest("No books found to test")
        
        all_urls = []  # List of (url, description) tuples
        failed_urls = []
        
        for book_id in books:
            print(f"\n📖 Processing book: {book_id}")
            book_data = load_book_data(book_id)
            
            # 1. Cover image URL (from metadata)
            cover_url = book_data.get('coverImageUrl', '')
            if cover_url:
                all_urls.append((cover_url, f"{book_id}/coverImageUrl"))
            
            # 2. Page-level URLs
            pages = book_data.get('pages', [])
            for page in pages:
                page_num = page.get('pageNumber', '?')
                
                # Page image
                image_url = page.get('imageUrl', '')
                if image_url:
                    all_urls.append((image_url, f"{book_id}/page{page_num}/imageUrl"))
                
                # Page narration audio
                narration_url = page.get('narrationAudioUrl', '')
                if narration_url:
                    all_urls.append((narration_url, f"{book_id}/page{page_num}/narrationAudioUrl"))
                
                # 3. Question audio URLs
                questions = page.get('questions', [])
                for q in questions:
                    q_id = q.get('id', '?')
                    audio_url = q.get('audioUrl', '')
                    if audio_url:
                        all_urls.append((audio_url, f"{book_id}/page{page_num}/{q_id}/audioUrl"))
                
                # 4. TextBlocks audio URLs (if any)
                text_blocks = page.get('textBlocks', [])
                for i, block in enumerate(text_blocks):
                    block_audio = block.get('audioUrl', '')
                    if block_audio:
                        all_urls.append((block_audio, f"{book_id}/page{page_num}/textBlock{i}/audioUrl"))
        
        print(f"\n🔍 Checking {len(all_urls)} URLs...")
        
        for url, desc in all_urls:
            try:
                # Use GET with stream=True (presigned URLs may not support HEAD)
                response = requests.get(url, timeout=10, stream=True)
                response.close()  # Don't download the whole file
                if response.status_code == 200:
                    print(f"  ✅ {desc}")
                else:
                    print(f"  ❌ {desc} - Status: {response.status_code}")
                    failed_urls.append((url, desc, response.status_code))
            except requests.RequestException as e:
                print(f"  ❌ {desc} - Error: {e}")
                failed_urls.append((url, desc, str(e)))
        
        # Summary
        print(f"\n--- Summary ---")
        print(f"Total URLs: {len(all_urls)}")
        print(f"Passed: {len(all_urls) - len(failed_urls)}")
        print(f"Failed: {len(failed_urls)}")
        
        if failed_urls:
            print("\n❌ Failed URLs:")
            for url, desc, error in failed_urls:
                print(f"  - {desc}: {error}")
                print(f"    URL: {url[:100]}...")
        
        self.assertEqual(len(failed_urls), 0, f"{len(failed_urls)} URLs failed validation")


if __name__ == "__main__":
    unittest.main()
