import sys
import os
import asyncio
from fastapi.testclient import TestClient

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.main import app
from app.routes.books import scan_available_books, load_book_data

def test_books_integration():
    """
    Integration test that actually connects to S3 to verify:
    1. Scanning books works
    2. Loading book data works
    3. URL replacement works
    """
    print("🚀 Starting Books API Integration Test (Connecting to S3)...")
    
    # 1. Test Scan
    print("\n--- 1. Scanning Available Books ---")
    books = scan_available_books()
    print(f"Found {len(books)} books: {books}")
    
    if not books:
        print("⚠️  No books found! Please check if 'books/' folder exists in your Bucket.")
        return

    target_book = books[0]
    print(f"👉 Selected book for detail test: {target_book}")

    # 2. Test Load Details
    print(f"\n--- 2. Loading Details for '{target_book}' ---")
    try:
        book_data = load_book_data(target_book)
        
        print(f"Title: {book_data.get('title')}")
        print(f"Pages: {len(book_data.get('pages', []))}")
        
        # 3. Verify URL Replacement
        print("\n--- 3. Verifying URL Replacement ---")
        cover_url = book_data.get('coverImageUrl', '')
        print(f"Cover URL: {cover_url}")
        
        if "http" in cover_url and "s3" in cover_url:
            print("✅ Cover URL is successfully converted to S3 link!")
        elif cover_url.startswith("/"):
            print("❌ Cover URL is still a relative path! Conversion failed.")
        else:
            print(f"⚠️  Cover URL format unexpected: {cover_url}")
            
        # Check a page image if available
        if book_data.get('pages'):
            first_page = book_data['pages'][0]
            page_img = first_page.get('imageUrl', '')
            print(f"Page 1 Image: {page_img}")
            if "http" in page_img:
                print("✅ Page Image URL converted successfully!")
            else:
                print("❌ Page Image URL not converted.")

    except Exception as e:
        print(f"❌ Error loading book details: {e}")

if __name__ == "__main__":
    # Run the test
    test_books_integration()
