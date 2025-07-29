# Text-to-Speech Audio Generation for Book Questions

This script generates audio files for questions found in the book pages using OpenAI's TTS API with the "shimmer" voice for child-friendly audio.

## Prerequisites

1. **OpenAI API Key**: You need an OpenAI API key with access to the TTS API
2. **Python Dependencies**: The script requires `openai` and `pyyaml` packages

## Setup

1. **Set your OpenAI API key**:
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements_tts.txt
   ```

## Usage

### Batch Generation (All Questions)

Generate audio for all questions in the book:

```bash
cd backend/scripts/tts
./generate_question_audio.sh
```

Or run the Python script directly:

```bash
cd backend/scripts/tts
python generate_question_audio.py
```

### Single Question Generation

Generate audio for a specific question by page number and question ID:

```bash
cd backend/scripts/tts
python generate_question_audio.py --page 12 --question-id q1
```

**Arguments:**
- `--page`: Page number (e.g., "1", "12", "23")
- `--question-id`: Question ID (e.g., "q1", "q2")

**Examples:**
```bash
# Generate audio for page 1, question q1
python generate_question_audio.py --page 1 --question-id q1

# Generate audio for page 12, question q2
python generate_question_audio.py --page 12 --question-id q2

# Generate audio for page 23, question q1
python generate_question_audio.py --page 23 --question-id q1
```

### Advanced Options

You can also specify custom paths and API key:

```bash
python generate_question_audio.py \
  --book-dir "../../data/books/speed-racer" \
  --output-dir "../../../frontend/public/sample_book/audios/questions" \
  --openai-key "your-api-key-here" \
  --page 12 \
  --question-id q1
```

## What the script does

1. **Scans book pages**: Looks for YAML files in the book directory that contain questions
2. **Extracts question text**: Reads the `questionText` field from each question
3. **Generates audio**: Uses OpenAI's TTS API with the "shimmer" voice to create child-friendly audio
4. **Saves files**: Stores the audio files in the specified output directory with the correct filenames

## Output

The script will generate `.mp3` audio files in the `frontend/public/sample_book/audios/questions/` directory with filenames matching those specified in the YAML files (e.g., `page2_q1.mp3`, `page7_q1.mp3`, etc.).

## Example

For a question in `page02.yaml`:
```yaml
questions:
  - id: "q1"
    questionText: "Parent and kid, let's take a moment to chat together! Did you ever ride in a car going really fast? How did it feel?"
    audioUrl: /sample_book/audios/questions/page2_q1.wav
```

The script will generate `page2_q1.mp3` in the output directory.

## Error Handling

When generating a single question, if the question ID is not found, the script will show all available questions on that page:

```
Error: Question q3 not found on page 12
Available questions on this page:
  - q1: Parent and kid, let's take a moment to chat together! Did you ever ride in a car going really fast? How did it feel?
  - q2: What do you think makes a car go fast?
```

## Troubleshooting

- **API Key Error**: Make sure your OpenAI API key is set correctly
- **Permission Error**: Ensure the output directory is writable
- **Empty Audio Files**: Check that the question text is not empty in the YAML files
- **Network Issues**: Ensure you have a stable internet connection for API calls
- **Page Not Found**: Verify the page number exists in the book directory
- **Question Not Found**: Check the question ID and use the error message to see available questions

## Cost Considerations

Each question will use one TTS API call. Check OpenAI's pricing for the TTS API to estimate costs based on the number of questions in your book. 