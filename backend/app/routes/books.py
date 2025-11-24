from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
import os
import yaml
from pathlib import Path
from ..s3_client import s3_client

books_router = APIRouter()

# 书本在 S3 上的根目录前缀
BOOKS_PREFIX = "books/"

# Local storage path - 指向 backend/data/books
BASE_DIR = Path(__file__).parent.parent.parent
LOCAL_BOOKS_DIR = BASE_DIR / "data" / "books"

def process_urls_in_data(data: Any) -> Any:
    """
    递归遍历数据，将所有本地相对路径 (以 / 开头) 转换为 S3 的预签名下载 URL。
    例如: /speed-racer/images/cover.png -> https://s3.../books/speed-racer/images/cover.png
    """
    if isinstance(data, dict):
        return {k: process_urls_in_data(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [process_urls_in_data(item) for item in data]
    elif isinstance(data, str):
        # 检查是否为本地相对路径 (以 / 开头，且包含扩展名)
        if data.startswith("/") and "." in data.split("/")[-1]:
            # 移除开头的 /
            # 原路径: /speed-racer/images/cover.png
            # 清理后: speed-racer/images/cover.png
            relative_path = data.lstrip("/")
            
            # 拼接 S3 完整 Key
            # 结果: books/speed-racer/images/cover.png
            s3_key = f"{BOOKS_PREFIX}{relative_path}"
            
            # 生成预签名 URL
            # 注意：generate_download_url 不检查文件是否存在于 S3，直接生成签名
            # 这样即便是私有 Bucket，前端也能在有效期内访问
            url = s3_client.generate_download_url(s3_key)
            return url if url else data
        return data
    else:
        return data

def scan_available_books() -> List[str]:
    """
    扫描本地 'backend/data/books/' 目录下的子文件夹，返回书本 ID 列表。
    """
    try:
        if not LOCAL_BOOKS_DIR.exists():
            print(f"Local books directory not found: {LOCAL_BOOKS_DIR}")
            return []
            
        book_ids = [
            d.name for d in LOCAL_BOOKS_DIR.iterdir() 
            if d.is_dir() and not d.name.startswith('.')
        ]
        
        return sorted(book_ids)
    except Exception as e:
        print(f"Error scanning books locally: {e}")
        return []

def read_local_yaml(file_path: Path):
    try:
        if not file_path.exists():
            return None
        with open(file_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    except Exception as e:
        print(f"Error reading local YAML {file_path}: {e}")
        return None

def load_book_data(book_id: str) -> Dict:
    """
    从本地文件系统加载书本数据：
    1. 读取 metadata.yaml
    2. 扫描 pages/ 目录并读取所有 pageX.yaml
    3. 替换所有资源 URL 为 S3 链接
    """
    try:
        book_dir = LOCAL_BOOKS_DIR / book_id
        
        # 1. 读取 Metadata
        metadata_path = book_dir / "metadata.yaml"
        metadata = read_local_yaml(metadata_path)
        
        if not metadata:
            raise HTTPException(status_code=404, detail=f"Book metadata not found for '{book_id}' locally")
            
        # 2. 扫描并读取 Pages
        pages_dir = book_dir / "pages"
        pages = []
        
        if pages_dir.exists():
            # 过滤出 yaml 文件，确保按文件名排序 (page01, page02...)
            page_files = sorted([
                f for f in pages_dir.iterdir() 
                if f.is_file() and f.suffix in ('.yaml', '.yml')
            ])
            
            for page_file in page_files:
                page_data = read_local_yaml(page_file)
                if page_data:
                    pages.append(page_data)
        
        # 组合数据
        metadata['pages'] = pages
        
        # 3. 处理 URL (依然转换为 S3 链接)
        processed_data = process_urls_in_data(metadata)
        
        return processed_data

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error loading book {book_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error loading book '{book_id}'")

@books_router.get("/books")
async def get_all_books():
    """获取所有可用书本的列表 (仅元数据)"""
    try:
        book_ids = scan_available_books()
        books_metadata = []
        
        for book_id in book_ids:
            try:
                # 读取本地 metadata.yaml
                metadata_path = LOCAL_BOOKS_DIR / book_id / "metadata.yaml"
                book_data = read_local_yaml(metadata_path)
                
                if book_data:
                    # 同样需要处理封面图片的 URL
                    book_data = process_urls_in_data(book_data)
                    
                    metadata = {
                        "id": book_data.get("id", book_id),
                        "title": book_data.get("title", "Unknown Title"),
                        "coverImageUrl": book_data.get("coverImageUrl", ""),
                        "totalPages": book_data.get("totalPages", 0)
                    }
                    books_metadata.append(metadata)
            except Exception:
                continue
        
        return {"books": books_metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading books: {str(e)}")

@books_router.get("/books/{book_id}")
async def get_book_by_id(book_id: str):
    """获取完整的书本数据 (包含所有页面)"""
    book_data = load_book_data(book_id)
    return book_data

@books_router.get("/books/{book_id}/metadata")
async def get_book_metadata(book_id: str):
    """仅获取特定书本的元数据"""
    try:
        metadata_path = LOCAL_BOOKS_DIR / book_id / "metadata.yaml"
        book_data = read_local_yaml(metadata_path)
        
        if not book_data:
            raise HTTPException(status_code=404, detail="Book not found")
            
        book_data = process_urls_in_data(book_data)
        
        return {
            "id": book_data.get("id", book_id),
            "title": book_data.get("title", "Unknown Title"),
            "coverImageUrl": book_data.get("coverImageUrl", ""),
            "totalPages": book_data.get("totalPages", 0)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading metadata: {str(e)}")
