# Convo Book

An interactive digital reading platform that combines traditional book reading with AI-powered voice interactions. Built with React frontend and FastAPI backend, featuring real-time voice communication through OpenAI's Realtime API.

## Key Features

- Interactive book library with progress tracking
- Digital book reader with page navigation and illustrations
- Real-time AI voice assistant using OpenAI Realtime API
- AI-generated interactive questions
- Family discussion prompts
- User authentication

## Project Structure

```
convo-book/
├── backend/
│   ├── app/
│   │   ├── routes/          # API endpoints
│   │   ├── main.py          # FastAPI application
│   │   ├── config.py        # Configuration
│   │   ├── auth.py          # Authentication
│   │   └── s3_client.py     # S3 integration
│   ├── data/
│   │   ├── books/           # Book data (YAML files)
│   │   ├── prompts.yaml     # Prompt templates
│   │   └── users/           # User data
│   ├── scripts/             # Utility scripts
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── BookLibrary/ # Book selection
│   │   │   ├── BookReader/  # Reading experience
│   │   │   ├── Login/       # Authentication
│   │   │   └── Common/      # Shared components
│   │   ├── hooks/           # Custom React hooks
│   │   └── utils/           # Utilities
│   └── package.json
└── README.md
```

## Setup and Installation

### Prerequisites

- Python 3.8+
- Node.js 16+
- OpenAI API Key with Realtime API access

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd convo-book
   ```

2. Set up Python environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   cd backend && pip install -r requirements.txt
   ```

3. Set up React environment:
   ```bash
   cd frontend && npm install
   ```

4. Create environment configuration:

   Create `.env` file in `backend/app/`:
   ```env
   OPENAI_API_KEY=your-openai-api-key
   OPENAI_REALTIME_URL=wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01
   ENVIRONMENT=development
   
   # S3 configuration (required for user authentication)
   AWS_ACCESS_KEY_ID=your-aws-access-key
   AWS_SECRET_ACCESS_KEY=your-aws-secret-key
   AWS_REGION=your-region
   S3_BUCKET_NAME=your-bucket-name
   ```

   User credentials are stored in S3 at `config/users.json`. See [Environment Variables](#environment-variables) for all available options.

## Quick Start

Run frontend and backend in separate terminals:

```bash
# Terminal 1 - Backend
cd backend
./start_server.sh

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Access the application:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

## Adding New Books

1. Create a directory in `backend/data/books/` with the book ID as folder name
2. Add `metadata.yaml` with book information
3. Create `pages/` subdirectory with page YAML files (page01.yaml, page02.yaml, etc.)
4. Add images to `frontend/public/<book-id>/images/`
5. Add audio files for questions as needed

Refer to existing books in `backend/data/books/` for structure examples.

## Configuration

### Voice Settings

Configure the AI assistant voice in `backend/app/config.py`:

```python
SESSION_CONFIG = {
    "voice": "shimmer",  # Options: alloy, echo, fable, onyx, nova, shimmer
    ...
}
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| OPENAI_API_KEY | OpenAI API key | Yes |
| OPENAI_REALTIME_URL | OpenAI Realtime WebSocket URL | Yes |
| ENVIRONMENT | development/staging/production | No (default: development) |
| JWT_SECRET_KEY | Secret for JWT tokens | Production only |
| AWS_* | AWS credentials for S3 | Production only |

## Architecture

**Frontend (React + Vite)**
- Book library and reader interface
- Real-time voice communication via WebSocket
- Progress tracking and state management

**Backend (FastAPI)**
- REST API for book data and authentication
- WebSocket relay to OpenAI Realtime API
- S3 integration for file storage (production)

**Data Flow**
1. User authenticates and selects a book
2. Frontend loads book data from backend API
3. Voice interactions are relayed through backend to OpenAI
4. AI responses stream back to frontend for playback
