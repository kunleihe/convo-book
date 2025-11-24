import sys
import os
import unittest
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.routes.books import scan_available_books, load_book_data, process_urls_in_data

class TestBooksLocal(unittest.TestCase):
    
    def test_1_scan_books(self):
        """Test scanning books from local directory"""
        print("\n--- 1. Testing Local Book Scan ---")
        books = scan_available_books()
        print(f"Found books: {books}")
        
        self.assertIsInstance(books, list)
        if len(books) > 0:
            print("✅ Successfully found local books.")
        else:
            print("⚠️  No local books found. Please check 'backend/data/books/'")

    def test_2_load_book_data(self):
        """Test loading specific book data and checking URL conversion"""
        print("\n--- 2. Testing Book Data Loading & URL Conversion ---")
        
        books = scan_available_books()
        if not books:
            self.skipTest("No books found to test loading")
            
        # Use the first available book (e.g., 'speed-racer')
        target_book = books[0] 
        print(f"👉 Testing with book: {target_book}")
        
        try:
            book_data = load_book_data(target_book)
            
            # Check basic metadata
            self.assertIn('id', book_data)
            self.assertIn('title', book_data)
            self.assertIn('pages', book_data)
            print(f"✅ Loaded metadata for '{book_data['title']}'")
            
            # Check Pages
            pages = book_data.get('pages', [])
            self.assertTrue(len(pages) > 0, "Book should have pages")
            print(f"✅ Loaded {len(pages)} pages")

            # Check URL Conversion (The core requirement)
            # We expect coverImageUrl to be converted to a full S3 URL
            cover_url = book_data.get('coverImageUrl', '')
            print(f"Cover URL: {cover_url}")
            
            if cover_url:
                # Should NOT start with slash (local path)
                self.assertFalse(cover_url.startswith('/'), "URL should not be a relative path")
                # Should contain http (presigned url)
                self.assertTrue(cover_url.startswith('http'), "URL should be a full HTTP link")
                # Should contain the S3 host (flexible check)
                self.assertTrue('s3' in cover_url or 'amazonaws' in cover_url, "URL should point to S3")
                print("✅ Cover URL successfully converted to S3 link")
                
            # Check a page image
            first_page = pages[0]
            page_img = first_page.get('imageUrl', '')
            print(f"Page 1 Image: {page_img}")
            
            if page_img:
                self.assertTrue(page_img.startswith('http'), "Page image should be a full HTTP link")
                print("✅ Page image URL successfully converted to S3 link")

        except Exception as e:
            self.fail(f"Failed to load book data: {e}")

if __name__ == "__main__":
    unittest.main()

