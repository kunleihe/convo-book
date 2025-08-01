#!/bin/bash

# Script to generate TTS audio for book questions
# Make sure you have your OpenAI API key set as an environment variable
# cd backend/scripts/tts
# Usage: ./generate_question_audio.sh --book <book_name>
# Help: ./generate_question_audio.sh --help

# Default book name
DEFAULT_BOOK="speed-racer"

# Parse command line arguments
BOOK_NAME=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --book)
            BOOK_NAME="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--book <book_name>]"
            echo ""
            echo "Options:"
            echo "  --book <name>           Specify the book name to generate audio for"
            echo "                          (default: $DEFAULT_BOOK)"
            echo "  --help, -h              Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                      # Use default book (speed-racer)"
            echo "  $0 --book practice      # Generate for practice book"
            echo "  $0 --book speed-racer   # Generate for speed-racer book"
            echo ""
            echo "Available books:"
            echo "  - practice"
            echo "  - speed-racer"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Use default if no book name specified
if [ -z "$BOOK_NAME" ]; then
    BOOK_NAME="$DEFAULT_BOOK"
fi

# Construct the full book directory path
BOOK_DIR="../../data/books/$BOOK_NAME"

# Map book names to their frontend directory names
case "$BOOK_NAME" in
    "speed-racer")
        FRONTEND_DIR="speed_racer"
        ;;
    "practice")
        FRONTEND_DIR="practice"
        ;;
    *)
        echo "Error: Unknown book name '$BOOK_NAME'"
        echo "Available books:"
        echo "  - practice"
        echo "  - speed-racer"
        exit 1
        ;;
esac

# Construct the output directory path
OUTPUT_DIR="../../../frontend/public/$FRONTEND_DIR/audios/questions"

# Check if book directory exists
if [ ! -d "$BOOK_DIR" ]; then
    echo "Error: Book directory '$BOOK_DIR' does not exist"
    echo "Available books:"
    echo "  - practice"
    echo "  - speed-racer"
    exit 1
fi

# Check if OpenAI API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY environment variable is not set"
    echo "Please set it with: export OPENAI_API_KEY='your-api-key-here'"
    exit 1
fi

# Install dependencies if needed
echo "Installing dependencies..."
pip install -r requirements_tts.txt

# Run the TTS generation script with the specified book directory and output directory
echo "Starting TTS generation for questions in book: $BOOK_NAME"
echo "Book directory: $BOOK_DIR"
echo "Output directory: $OUTPUT_DIR"
python generate_question_audio.py --book-dir "$BOOK_DIR" --output-dir "$OUTPUT_DIR"

echo "Done!" 