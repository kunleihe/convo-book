from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import os
import yaml
import glob
from typing import List, Dict, Any

books_router = APIRouter()

def get_books_directory():
    """Get the path to the books data directory"""
    current_file = os.path.abspath(__file__)
    backend_root = os.path.dirname(os.path.dirname(os.path.dirname(current_file)))
    return os.path.join(backend_root, "data", "books")

def scan_available_books():
    """Scan the books directory and return list of available book IDs"""
    books_dir = get_books_directory()
    if not os.path.exists(books_dir):
        return []
    
    # Look for directories with metadata.yaml files
    book_dirs = []
    for item in os.listdir(books_dir):
        item_path = os.path.join(books_dir, item)
        if os.path.isdir(item_path):
            metadata_file = os.path.join(item_path, "metadata.yaml")
            if os.path.exists(metadata_file):
                book_dirs.append(item)
    
    return sorted(book_dirs)

def load_book_data(book_id: str):
    """Load book data from YAML files"""
    books_dir = get_books_directory()
    book_dir = os.path.join(books_dir, book_id)
    metadata_file = os.path.join(book_dir, "metadata.yaml")
    pages_dir = os.path.join(book_dir, "pages")
    
    if not os.path.exists(metadata_file) or not os.path.exists(pages_dir):
        raise HTTPException(status_code=404, detail=f"Book '{book_id}' not found")
    
    try:
        # Load metadata
        with open(metadata_file, 'r', encoding='utf-8') as f:
            book_data = yaml.safe_load(f)
        
        # Load all page files
        page_files = glob.glob(os.path.join(pages_dir, "page*.yaml"))
        pages = []
        
        for page_file in sorted(page_files):
            with open(page_file, 'r', encoding='utf-8') as f:
                page_data = yaml.safe_load(f)
                pages.append(page_data)
        
        # Combine metadata and pages
        book_data['pages'] = pages
        return book_data
        
    except yaml.YAMLError as e:
        raise HTTPException(status_code=500, detail=f"Invalid YAML in book '{book_id}': {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading book '{book_id}': {str(e)}")

@books_router.get("/books")
async def get_all_books():
    """Get list of all available books with metadata"""
    try:
        book_ids = scan_available_books()
        books_metadata = []
        
        for book_id in book_ids:
            try:
                book_data = load_book_data(book_id)
                # Return just the metadata for the library view
                metadata = {
                    "id": book_data.get("id", book_id),
                    "title": book_data.get("title", "Unknown Title"),
                    "coverImageUrl": book_data.get("coverImageUrl", ""),
                    "totalPages": book_data.get("totalPages", 0)
                }
                books_metadata.append(metadata)
            except HTTPException:
                # Skip books that fail to load
                continue
        
        return {"books": books_metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading books: {str(e)}")

@books_router.get("/books/{book_id}")
async def get_book_by_id(book_id: str):
    """Get full book data by ID"""
    book_data = load_book_data(book_id)
    return book_data

@books_router.get("/books/{book_id}/metadata")
async def get_book_metadata(book_id: str):
    """Get just the metadata for a specific book"""
    book_data = load_book_data(book_id)
    return {
        "id": book_data.get("id", book_id),
        "title": book_data.get("title", "Unknown Title"),
        "coverImageUrl": book_data.get("coverImageUrl", ""),
        "totalPages": book_data.get("totalPages", 0)
    } 