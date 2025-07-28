#!/bin/bash

# Script to generate TTS audio for book questions
# Make sure you have your OpenAI API key set as an environment variable

# Check if OpenAI API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY environment variable is not set"
    echo "Please set it with: export OPENAI_API_KEY='your-api-key-here'"
    exit 1
fi

# Install dependencies if needed
echo "Installing dependencies..."
pip install -r requirements_tts.txt

# Run the TTS generation script
echo "Starting TTS generation for questions..."
python generate_question_audio.py

echo "Done!" 