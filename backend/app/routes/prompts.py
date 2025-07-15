from fastapi import APIRouter, HTTPException
import os
import json
from .books import load_book_data

prompts_router = APIRouter()

def get_prompt_templates():
    """Load prompt templates from JSON file"""
    current_file = os.path.abspath(__file__)
    backend_root = os.path.dirname(os.path.dirname(os.path.dirname(current_file)))
    templates_file = os.path.join(backend_root, "data", "prompt-templates.json")
    
    try:
        with open(templates_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Prompt templates file not found")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid JSON in prompt templates file")

@prompts_router.get("/books/{book_id}/page/{page_number}/prompt")
async def get_page_prompt(book_id: str, page_number: int):
    """Generate context-aware prompt for a specific page"""
    try:
        # Load book data
        book_data = load_book_data(book_id)
        
        # Find the specific page
        page = None
        for p in book_data.get("pages", []):
            if p.get("pageNumber") == page_number:
                page = p
                break
        
        if not page:
            raise HTTPException(status_code=404, detail=f"Page {page_number} not found in book {book_id}")
        
        # Check if page has a question and prompt template
        if not page.get("question"):
            raise HTTPException(status_code=400, detail=f"Page {page_number} does not have a question")
        
        prompt_template_id = page.get("promptTemplate")
        if not prompt_template_id:
            raise HTTPException(status_code=400, detail=f"Page {page_number} does not specify a prompt template")
        
        # Load prompt templates
        templates = get_prompt_templates()
        
        if prompt_template_id not in templates:
            raise HTTPException(status_code=404, detail=f"Prompt template '{prompt_template_id}' not found")
        
        template = templates[prompt_template_id]
        
        # Extract content for template placeholders
        story_text = page.get("storyText", "")
        question_data = page.get("question", {})
        question_text = question_data.get("questionText", "")
        follow_up = question_data.get("follow-up", [])
        
        # Handle follow-up questions formatting
        follow_up_text = ""
        if follow_up:
            follow_up_text = "\n           ".join(f"- {q}" for q in follow_up)
        
        # Handle different template types
        if prompt_template_id == "template1":
            # Template 1 doesn't need answerText
            filled_prompt = template.format(
                storyText=story_text,
                questionText=question_text,
                **{"follow-up": follow_up_text}
            )
        elif prompt_template_id == "template2":
            # Template 2 requires answerText
            answer_text = question_data.get("answerText", "")
            if not answer_text:
                raise HTTPException(status_code=400, detail=f"Page {page_number} using template2 requires an 'answerText' field")
            
            filled_prompt = template.format(
                storyText=story_text,
                questionText=question_text,
                answerText=answer_text,
                **{"follow-up": follow_up_text}
            )
        else:
            # For any other template types, try to format with available fields
            filled_prompt = template.format(
                storyText=story_text,
                questionText=question_text,
                **{"follow-up": follow_up_text}
            )
        
        return {
            "prompt": filled_prompt,
            "template_id": prompt_template_id,
            "page_number": page_number,
            "book_id": book_id
        }
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error generating prompt: {str(e)}") 