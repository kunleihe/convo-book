from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
import yaml
from pathlib import Path
from ..s3_client import s3_client

books_router = APIRouter()

BASE_DIR = Path(__file__).parent.parent.parent
LOCAL_BOOKS_DIR = BASE_DIR / "data" / "books"


def read_local_yaml(file_path: Path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except Exception as e:
        print(f"Error reading local YAML {file_path}: {e}")
        return None


def scan_available_books() -> List[str]:
    """Return sorted list of book IDs from single-file YAMLs in LOCAL_BOOKS_DIR."""
    try:
        if not LOCAL_BOOKS_DIR.exists():
            print(f"Local books directory not found: {LOCAL_BOOKS_DIR}")
            return []
        return sorted(
            item.stem
            for item in LOCAL_BOOKS_DIR.iterdir()
            if item.suffix in (".yaml", ".yml") and item.is_file()
        )
    except Exception as e:
        print(f"Error scanning books: {e}")
        return []


def _presign(s3_key: str) -> str:
    if not s3_key:
        return ""
    url = s3_client.generate_download_url(s3_key)
    return url if url else ""


def load_book_from_yaml(book_id: str, yaml_file: Path) -> Dict[str, Any]:
    raw = read_local_yaml(yaml_file)
    if not raw:
        raise HTTPException(status_code=500, detail=f"Failed to read YAML for '{book_id}'")

    meta = raw.get("metadata", {})
    uri_prefix = meta.get("uri_prefix", "")

    cover_s3_key = uri_prefix + meta.get("cover_uri", "")
    cover_url = _presign(cover_s3_key)

    pages_raw = raw.get("pages", [])
    pages = []
    for p in pages_raw:
        image_s3_key = uri_prefix + p.get("image_uri", "")
        narration_s3_key = uri_prefix + p.get("narration_uri", "")

        questions = []
        for q in p.get("questions", []):
            audio_s3_key = uri_prefix + q.get("audio_uri", "")
            questions.append({
                "id": q.get("id"),
                "questionText": q.get("text", ""),
                "audioUrl": _presign(audio_s3_key),
                "customPrompt": q.get("custom_prompt"),
            })

        pages.append({
            "pageNumber": p.get("page_number"),
            "imageUrl": _presign(image_s3_key),
            "narrationAudioUrl": _presign(narration_s3_key),
            "storyText": p.get("text", ""),
            "questions": questions,
        })

    return {
        "id": book_id,
        "title": meta.get("title", "Unknown Title"),
        "coverImageUrl": cover_url,
        "totalPages": len(pages),
        "pages": pages,
    }


def load_book_data(book_id: str) -> Dict[str, Any]:
    yaml_file = LOCAL_BOOKS_DIR / f"{book_id}.yaml"
    if not yaml_file.exists():
        raise HTTPException(status_code=404, detail=f"Book '{book_id}' not found")
    return load_book_from_yaml(book_id, yaml_file)


@books_router.get("/books")
async def get_all_books():
    """Get metadata for available books for library display."""
    try:
        books_metadata = []
        for book_id in scan_available_books():
            try:
                yaml_file = LOCAL_BOOKS_DIR / f"{book_id}.yaml"
                raw = read_local_yaml(yaml_file)
                if not raw:
                    continue
                meta = raw.get("metadata", {})
                uri_prefix = meta.get("uri_prefix", "")
                cover_s3_key = uri_prefix + meta.get("cover_uri", "")
                cover_url = _presign(cover_s3_key)
                books_metadata.append({
                    "id": book_id,
                    "title": meta.get("title", "Unknown Title"),
                    "coverImageUrl": cover_url,
                    "totalPages": len(raw.get("pages", [])),
                })
            except Exception:
                continue
        return {"books": books_metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading books: {str(e)}")


@books_router.get("/books/{book_id}")
async def get_book_by_id(book_id: str):
    """Get complete book data including all pages."""
    return load_book_data(book_id)
