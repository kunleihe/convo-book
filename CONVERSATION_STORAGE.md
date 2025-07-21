# Conversation Storage Implementation

This document describes the conversation storage feature that automatically saves user-AI text interactions.

## Overview

The system now automatically stores all text conversations between users and the AI assistant, organized by:
- **User ID** (authenticated user)
- **Book ID** (which book is being read)
- **Page Number** (which page the conversation occurred on)
- **Sender** ("user" or "ai")
- **Text Content** (the actual message)
- **Timestamp** (when the message was sent)

## Backend Implementation

### Database Model
- **Table**: `conversations`
- **Fields**: `id`, `user_id`, `book_id`, `page_number`, `sender`, `text`, `timestamp`
- **Relationships**: Foreign key to `users` table

### API Endpoints
- **POST** `/api/conversations/` - Store a new conversation message
- **GET** `/api/conversations/` - Retrieve conversation history
  - Optional query params: `book_id`, `page_number`

### Authentication
- All endpoints require JWT token authentication
- Messages are automatically associated with the authenticated user

## Frontend Implementation

### Automatic Storage
The system automatically stores messages when:
1. **AI responses complete** - When `response.audio_transcript.done` is received
2. **User transcriptions complete** - When `conversation.item.input_audio_transcription.completed` is received

### Integration Points
- **usePageVoiceChat hook** - Stores AI messages
- **useTranscriptionWebSocket hook** - Stores user messages
- **InteractivePanel component** - Passes book/page context to hooks

### Storage Utility
- **File**: `frontend/src/utils/conversationStorage.js`
- **Functions**:
  - `storeConversationMessage(text, sender, bookId, pageNumber)` - Store a message
  - `getConversationHistory(bookId, pageNumber)` - Retrieve conversation history

## Usage

### Storing Messages (Automatic)
Messages are stored automatically when users interact with the AI. No manual intervention required.

### Retrieving Messages (Manual)
```javascript
import { getConversationHistory } from '../utils/conversationStorage';

// Get all conversations for a specific page
const conversations = await getConversationHistory('book1', 5);

// Get all conversations for a book
const bookConversations = await getConversationHistory('book1');

// Get all conversations for the user
const allConversations = await getConversationHistory();
```

## Database Migration

To set up the database with the new conversation table:
```bash
cd backend
python init_database.py
```

## Error Handling

- Storage failures are logged but don't interrupt the UI
- Authentication failures are handled gracefully
- Missing context (bookId/pageNumber) prevents storage but doesn't break functionality

## Future Cloud Migration

The implementation uses SQLAlchemy ORM, making it easy to migrate to cloud databases like AWS RDS by simply changing the database URL in the configuration. 