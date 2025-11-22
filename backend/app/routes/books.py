from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from ..s3_client import s3_client

books_router = APIRouter()

# 书本在 S3 上的根目录前缀
BOOKS_PREFIX = "books/"

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
            url = s3_client.generate_download_url(s3_key)
            return url if url else data
        return data
    else:
        return data

def scan_available_books() -> List[str]:
    """
    扫描 S3 'books/' 目录下的子文件夹，返回书本 ID 列表。
    """
    try:
        # 列出 books/ 下的对象，使用 '/' 作为分隔符来模拟目录
        response = s3_client.s3_client.list_objects_v2(
            Bucket=s3_client.bucket_name,
            Prefix=BOOKS_PREFIX,
            Delimiter='/'
        )
        
        book_ids = []
        # CommonPrefixes 包含了子目录
        if 'CommonPrefixes' in response:
            for prefix in response['CommonPrefixes']:
                # prefix['Prefix'] 类似 'books/speed-racer/'
                # 我们需要提取 'speed-racer'
                dir_name = prefix['Prefix'].rstrip('/').split('/')[-1]
                if dir_name:
                    book_ids.append(dir_name)
        
        return sorted(book_ids)
    except Exception as e:
        print(f"Error scanning books: {e}")
        return []

def load_book_data(book_id: str) -> Dict:
    """
    从 S3 加载书本数据：
    1. 读取 metadata.yaml
    2. 扫描 pages/ 目录并读取所有 pageX.yaml
    3. 替换所有资源 URL 为 S3 链接
    """
    try:
        book_root = f"{BOOKS_PREFIX}{book_id}/"
        
        # 1. 读取 Metadata
        metadata_key = f"{book_root}metadata.yaml"
        metadata = s3_client.read_yaml(metadata_key)
        
        if not metadata:
            raise HTTPException(status_code=404, detail=f"Book metadata not found for '{book_id}'")
            
        # 2. 扫描并读取 Pages
        pages_prefix = f"{book_root}pages/"
        response = s3_client.s3_client.list_objects_v2(
            Bucket=s3_client.bucket_name,
            Prefix=pages_prefix
        )
        
        pages = []
        if 'Contents' in response:
            # 过滤出 yaml 文件
            page_files = [
                obj['Key'] for obj in response['Contents'] 
                if obj['Key'].endswith(('.yaml', '.yml')) and obj['Key'] != pages_prefix
            ]
            
            # 按文件名排序 (page01, page02...)
            for page_key in sorted(page_files):
                page_data = s3_client.read_yaml(page_key)
                if page_data:
                    pages.append(page_data)
        
        # 组合数据
        metadata['pages'] = pages
        
        # 3. 处理 URL
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
                # 只读取 metadata.yaml，不读 pages 以提高速度
                # 优化：如果我们能不读 pages 最好，但现在的 process_urls 需要数据结构
                # 这里我们只读 metadata.yaml
                metadata_key = f"{BOOKS_PREFIX}{book_id}/metadata.yaml"
                book_data = s3_client.read_yaml(metadata_key)
                
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
        metadata_key = f"{BOOKS_PREFIX}{book_id}/metadata.yaml"
        book_data = s3_client.read_yaml(metadata_key)
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