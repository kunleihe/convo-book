from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import yaml
from .books import load_book_data

prompts_router = APIRouter()

class FormatMessageRequest(BaseModel):
    book_id: str
    page_number: int
    question_id: str
    child_response: str

class FormatMessageResponse(BaseModel):
    formatted_message: str

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

def find_page(book_data, page_number):
    """Find a specific page in book data"""
    for page in book_data.get("pages", []):
        if page.get("pageNumber") == page_number:
            return page
    return None

def find_question(page, question_id):
    """Find a specific question in page data"""
    if not page:
        return None
    
    for question in page.get("questions", []):
        if question.get("id") == question_id:
            return question
    return None

@prompts_router.post("/prompts/format-initial-message", response_model=FormatMessageResponse)
async def format_initial_message(request: FormatMessageRequest):
    """Format the initial message to send to OpenAI with story context"""
    try:
        # Load book data
        book_data = load_book_data(request.book_id)
        
        # Find the specific page
        page = find_page(book_data, request.page_number)
        if not page:
            raise HTTPException(status_code=404, detail=f"Page {request.page_number} not found in book {request.book_id}")
        
        # Find the specific question
        question = find_question(page, request.question_id)
        if not question:
            raise HTTPException(status_code=404, detail=f"Question '{request.question_id}' not found on page {request.page_number}")
        
        # Extract content for message formatting
        story_text = page.get("storyText", "")
        question_text = question.get("questionText", "")
        answer_text = question.get("answerText", "")
        follow_up = question.get("follow-up", [])
        
        # Build formatted message
        message_parts = [f"Story: {story_text}"]
        message_parts.append(f"Question: {question_text}")
        
        if answer_text:
            message_parts.append(f"Answer: {answer_text}")
        
        if follow_up:
            follow_up_text = "\n".join(f"- {q}" for q in follow_up)
            message_parts.append(f"Example follow-up questions:\n{follow_up_text}")
        
        message_parts.append(f"Child response: {request.child_response}")
        
        formatted_message = "\n\n".join(message_parts)
        
        return FormatMessageResponse(formatted_message=formatted_message)
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error formatting initial message: {str(e)}")

@prompts_router.get("/books/{book_id}/page/{page_number}/question/{question_id}/prompt")
async def get_question_prompt(book_id: str, page_number: int, question_id: str):
    """Generate context-aware prompt for a specific question"""
    try:
        # Load book data
        book_data = load_book_data(book_id)
        
        # Find the specific page
        page = find_page(book_data, page_number)
        if not page:
            raise HTTPException(status_code=404, detail=f"Page {page_number} not found in book {book_id}")
        
        # Check if page has questions
        questions = page.get("questions", [])
        if not questions:
            raise HTTPException(status_code=400, detail=f"Page {page_number} does not have any questions")
        
        # Find the specific question
        question = find_question(page, question_id)
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
        
        return template
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error generating question prompt: {str(e)}")