from fastapi import APIRouter, HTTPException
import os
import yaml
from .books import load_book_data

prompts_router = APIRouter()

def get_prompt_templates():
    """Load prompt templates from YAML file"""
    current_file = os.path.abspath(__file__)
    backend_root = os.path.dirname(os.path.dirname(os.path.dirname(current_file)))
    templates_file = os.path.join(backend_root, "data", "prompts.yaml")
    
    try:
        with open(templates_file, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Prompts file not found")
    except yaml.YAMLError as e:
        raise HTTPException(status_code=500, detail=f"Invalid YAML in prompts file: {str(e)}")

@prompts_router.get("/books/{book_id}/page/{page_number}/question/{question_id}/prompt")
async def get_question_prompt(book_id: str, page_number: int, question_id: str):
    """Generate context-aware prompt for a specific question"""
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
        
        # Check if page has questions
        questions = page.get("questions", [])
        if not questions:
            raise HTTPException(status_code=400, detail=f"Page {page_number} does not have any questions")
        
        # Find the specific question by ID
        question = None
        for q in questions:
            if q.get("id") == question_id:
                question = q
                break
        
        if not question:
            raise HTTPException(status_code=404, detail=f"Question '{question_id}' not found on page {page_number}")
        
        # Get question type
        question_type = question.get("questionType")
        if not question_type:
            raise HTTPException(status_code=400, detail=f"Question '{question_id}' does not specify a questionType")
        
        # Validate question type
        if question_type not in ["open-ended", "definitive-answer"]:
            raise HTTPException(status_code=400, detail=f"Invalid questionType '{question_type}'. Must be 'open-ended' or 'definitive-answer'")
        
        # Load prompt templates
        templates = get_prompt_templates()
        
        if question_type not in templates:
            raise HTTPException(status_code=404, detail=f"Prompt template for questionType '{question_type}' not found")
        
        template = templates[question_type]
        
        return {
            "prompt": template,
            "question_type": question_type,
            "question_id": question_id,
            "page_number": page_number,
            "book_id": book_id,
            "question_data": {
                "questionText": question.get("questionText", ""),
                "answerText": question.get("answerText", ""),
                "follow_up": question.get("follow-up", [])
            },
            "story_text": page.get("storyText", "")
        }
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error generating question prompt: {str(e)}")

@prompts_router.get("/books/{book_id}/page/{page_number}/prompt")
async def get_page_prompt(book_id: str, page_number: int):
    """Generate context-aware prompt for a specific page (DEPRECATED - kept for backward compatibility)"""
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
        
        # Check if page has questions (new format)
        questions = page.get("questions", [])
        if questions:
            # Use the first question for backward compatibility
            first_question = questions[0]
            return await get_question_prompt(book_id, page_number, first_question.get("id"))
        
        # Check if page has a question (old format - for backward compatibility)
        if not page.get("question"):
            raise HTTPException(status_code=400, detail=f"Page {page_number} does not have a question")
        
        prompt_template_id = page.get("promptTemplate")
        if not prompt_template_id:
            raise HTTPException(status_code=400, detail=f"Page {page_number} does not specify a prompt template")
        
        # Load old prompt templates (this path should be deprecated)
        current_file = os.path.abspath(__file__)
        backend_root = os.path.dirname(os.path.dirname(os.path.dirname(current_file)))
        old_templates_file = os.path.join(backend_root, "data", "prompt-templates.yaml")
        
        try:
            with open(old_templates_file, 'r', encoding='utf-8') as f:
                old_templates = yaml.safe_load(f)
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="Old prompt templates file not found")
        
        if prompt_template_id not in old_templates:
            raise HTTPException(status_code=404, detail=f"Prompt template '{prompt_template_id}' not found")
        
        template = old_templates[prompt_template_id]
        
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