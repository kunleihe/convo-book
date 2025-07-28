#!/usr/bin/env python3
"""
Script to generate text-to-speech audio for questions in book pages.
Uses OpenAI's TTS API with the shimmer voice for child-friendly audio.
"""

import os
import yaml
from pathlib import Path
from openai import OpenAI
import argparse
from typing import List, Dict, Any

def load_yaml_file(file_path: Path) -> Dict[str, Any]:
    """Load and parse a YAML file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return yaml.safe_load(file)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return {}

def find_pages_with_questions(book_dir: Path) -> List[Path]:
    """Find all YAML files that contain questions."""
    pages_with_questions = []
    
    for yaml_file in book_dir.glob("pages/*.yaml"):
        data = load_yaml_file(yaml_file)
        if data and 'questions' in data:
            pages_with_questions.append(yaml_file)
    
    return pages_with_questions

def extract_questions_from_page(page_data: Dict[str, Any], page_number: str) -> List[Dict[str, Any]]:
    """Extract questions from a page's data."""
    questions = []
    
    if 'questions' not in page_data:
        return questions
    
    for i, question in enumerate(page_data['questions'], 1):
        question_info = {
            'id': question.get('id', f'q{i}'),
            'questionText': question.get('questionText', ''),
            'audioUrl': question.get('audioUrl', ''),
            'pageNumber': page_number
        }
        questions.append(question_info)
    
    return questions

def generate_audio_for_question(client: OpenAI, question_text: str, output_path: Path) -> bool:
    """Generate TTS audio for a question using OpenAI's API."""
    try:
        # Clean up the question text (remove extra whitespace and newlines)
        cleaned_text = ' '.join(question_text.strip().split())
        
        if not cleaned_text:
            print(f"Warning: Empty question text for {output_path}")
            return False
        
        print(f"Generating audio for: {cleaned_text[:50]}...")
        
        with client.audio.speech.with_streaming_response.create(
            model="gpt-4o-mini-tts",
            voice="shimmer",
            input=cleaned_text
        ) as response:
            response.stream_to_file(output_path)
        
        print(f"✓ Generated: {output_path}")
        return True
        
    except Exception as e:
        print(f"Error generating audio for {output_path}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Generate TTS audio for book questions")
    parser.add_argument("--book-dir", type=str, 
                       default="../../data/books/speed-racer",
                       help="Path to the book directory containing pages")
    parser.add_argument("--output-dir", type=str,
                       default="../../../frontend/public/sample_book/audios/questions",
                       help="Output directory for audio files")
    parser.add_argument("--openai-key", type=str,
                       help="OpenAI API key (or set OPENAI_API_KEY environment variable)")
    
    args = parser.parse_args()
    
    # Setup paths
    script_dir = Path(__file__).parent
    book_dir = script_dir / args.book_dir
    output_dir = script_dir / args.output_dir
    
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Setup OpenAI client
    api_key = args.openai_key or os.getenv('OPENAI_API_KEY')
    if not api_key:
        print("Error: OpenAI API key required. Set OPENAI_API_KEY environment variable or use --openai-key")
        return
    
    client = OpenAI(api_key=api_key)
    
    # Find pages with questions
    print(f"Searching for pages with questions in: {book_dir}")
    pages_with_questions = find_pages_with_questions(book_dir)
    
    if not pages_with_questions:
        print("No pages with questions found!")
        return
    
    print(f"Found {len(pages_with_questions)} pages with questions")
    
    # Process each page
    total_questions = 0
    successful_generations = 0
    
    for page_file in pages_with_questions:
        print(f"\nProcessing: {page_file.name}")
        
        page_data = load_yaml_file(page_file)
        if not page_data:
            continue
        
        page_number = page_data.get('pageNumber', page_file.stem.replace('page', ''))
        questions = extract_questions_from_page(page_data, str(page_number))
        
        for question in questions:
            total_questions += 1
            
            # Extract filename from audioUrl
            audio_url = question['audioUrl']
            if not audio_url:
                print(f"Warning: No audioUrl specified for question {question['id']} on page {page_number}")
                continue
            
            # Extract filename from the audioUrl path
            filename = Path(audio_url).name
            if not filename:
                print(f"Warning: Invalid audioUrl format: {audio_url}")
                continue
            
            # Ensure the filename has .mp3 extension for OpenAI TTS
            if not filename.endswith('.mp3'):
                filename = filename.replace('.wav', '.mp3')
            
            output_path = output_dir / filename
            
            # Generate audio
            if generate_audio_for_question(client, question['questionText'], output_path):
                successful_generations += 1
    
    print(f"\n=== Summary ===")
    print(f"Total questions found: {total_questions}")
    print(f"Successfully generated: {successful_generations}")
    print(f"Failed: {total_questions - successful_generations}")
    print(f"Audio files saved to: {output_dir}")

if __name__ == "__main__":
    main() 