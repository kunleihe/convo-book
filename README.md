# Convo Book

An interactive digital reading platform that combines traditional book reading with AI-powered voice interactions. Built with **React** frontend and **FastAPI** backend, featuring real-time voice communication through OpenAI's Realtime API.

## 📋 Table of Contents

- [✨ Key Features](#-key-features)
- [🏗️ Project Structure](#️-project-structure)
- [📦 Setup and Installation](#-setup-and-installation)
- [🚀 Quick Start](#-quick-start)
- [📚 How It Works](#-how-it-works)
- [⚙️ Configuration](#️-configuration)
- [🏗️ Architecture](#️-architecture)

## ✨ Key Features

- **📚 Interactive Book Library** - Browse and select from available books
- **📖 Digital Book Reader** - Page-by-page reading with beautiful illustrations
- **🎤 AI Voice Assistant** - Real-time voice conversations with OpenAI's Realtime API
- **❓ Interactive Questions** - AI-generated questions to engage readers
- **👨‍👩‍👧‍👦 Family Discussions** - Audio prompts for family conversations
- **📱 Responsive Design** - Works on desktop and mobile devices
- **💾 Reading Progress** - Automatic progress tracking and resume functionality

## 🏗️ Project Structure 

```
convo-book/
├── backend/                    # FastAPI server
│   ├── app/
│   │   ├── routes/            # API endpoints (books, realtime, prompts)
│   │   ├── main.py           # FastAPI application
│   │   └── config.py         # Configuration
│   ├── data/
│   │   ├── books/            # Book JSON files
│   │   └── prompt-templates.json
│   └── requirements.txt       # Python dependencies
├── frontend/                   # React application
│   ├── src/
│   │   ├── components/
│   │   │   ├── BookLibrary/   # Book selection interface
│   │   │   ├── BookReader/    # Interactive reading experience
│   │   │   └── VoiceClient/   # AI voice assistant
│   │   ├── hooks/            # Custom React hooks
│   │   └── utils/            # Utilities and data loaders
│   └── package.json          # Node.js dependencies
└── start_dev.sh              # Development script
```

## 📦 Setup and Installation

### Prerequisites
- Python 3.8+
- Node.js 16+
- OpenAI API Key with Realtime API access

### Installation

1. **Clone and navigate to the repository:**
   ```bash
   git clone <repository-url>
   cd convo-book
   ```

2. **Set up Python environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   cd backend && pip install -r requirements.txt
   ```

3. **Set up React environment:**
   ```bash
   cd frontend && npm install
   ```

4. **Create environment configuration:**
   
   Create `.env` file in `/backend/app/`:
   ```env
   OPENAI_API_KEY="your-openai-api-key"
   OPENAI_REALTIME_URL="wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"
   USE_AZURE_OPENAI=False
   ENVIRONMENT=development
   ```

## 🚀 Quick Start

### Development Mode (Recommended)
```bash
./start_dev.sh
```

This starts:
- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://localhost:8000`
- **API Docs**: `http://localhost:8000/docs`

### Production Mode
```bash
cd frontend && npm run build
cd ../backend && ./start_server.sh
```

## 📚 How It Works

### 1. Book Library
- Browse available books with covers and titles
- Enable/disable narration features
- Automatic progress tracking

### 2. Interactive Reading
- **Page Navigation**: Use arrow keys or buttons to navigate
- **Story Content**: Read text and view illustrations
- **Interactive Elements**: 
  - Questions appear on specific pages
  - Family discussion prompts
  - AI voice assistant integration

### 3. Voice Features
- **Hold-to-Talk**: Press and hold microphone button to speak
- **Real-time AI Responses**: Get instant voice responses from OpenAI
- **Audio Playback**: Automatic audio responses

### 4. Reading Flow
1. Select a book from the library
2. Read through pages with story text and images
3. Encounter interactive questions and discussions
4. Use voice assistant for additional help
5. Progress is automatically saved

## ⚙️ Configuration

### Voice Settings
Customize the AI assistant in `frontend/src/config/sessionConfig.js`:

```javascript
export const sessionConfig = {
    instructions: "You are a helpful reading assistant...",
    voice: "alloy", // Options: alloy, echo, fable, onyx, nova, shimmer
    input_audio_format: "pcm16",
    output_audio_format: "pcm16",
    modalities: ["text", "audio"],
    turn_detection: null // Manual control via UI
};
```

### Adding New Books
1. Create a JSON file in `backend/data/books/`
2. Follow the structure of existing books (see `book1.json`)
3. Include page images in `frontend/public/sample_book/images/`
4. Add audio files for questions and discussions

### Environment Configuration
The app automatically adjusts CORS settings based on your `ENVIRONMENT` variable:
- **Development**: Allows `localhost:5173` and `localhost:8000`
- **Staging/Production**: Configure domains in `backend/app/config.py`

## 🏗️ Architecture

**Frontend (React)**
- Book library and reader interface
- Real-time voice communication
- Progress tracking and state management

**Backend (FastAPI)**
- Book data API endpoints
- WebSocket relay to OpenAI Realtime API
- Prompt template management

**Data Flow**
1. Frontend loads book data from backend API
2. User interacts with voice assistant via WebSocket
3. Backend relays messages to OpenAI Realtime API
4. AI responses are streamed back to frontend
5. Audio playback and text display handled client-side

## 🤝 Acknowledgments

- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [FastAPI](https://fastapi.tiangolo.com/) 
- [React](https://react.dev/)
- [Bootstrap](https://getbootstrap.com/)
- [Vite](https://vite.dev/)