import { apiRequest } from './api';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const storeConversationMessage = async (text, sender, bookId, pageNumber, questionId) => {
    try {
        const token = localStorage.getItem('authToken');
        const username = localStorage.getItem('username') || 'guest'; // Get username from storage
        
        if (!token) {
            console.warn('No auth token found, cannot store conversation');
            return;
        }

        const response = await apiRequest(`${API_BASE_URL}/api/conversations/`, {
            method: 'POST',
            body: JSON.stringify({
                book_id: bookId,
                page_number: pageNumber,
                question_id: questionId,
                sender: sender,
                text: text,
                username: username
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to store conversation: ${response.status}`);
        }

        console.log(`Stored ${sender} message for page ${pageNumber}, question ${questionId}:`, text.substring(0, 50) + '...');
    } catch (error) {
        console.error('Failed to store conversation message:', error);
        // Don't throw - storage failure shouldn't break the UI
    }
};

export const getConversationHistory = async (bookId, pageNumber, questionId) => {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.warn('No auth token found, cannot retrieve conversations');
            return [];
        }

        const params = new URLSearchParams();
        if (bookId) params.append('book_id', bookId);
        if (pageNumber !== undefined) params.append('page_number', pageNumber);
        if (questionId) params.append('question_id', questionId);

        const response = await apiRequest(`${API_BASE_URL}/api/conversations/?${params.toString()}`);

        if (!response.ok) {
            throw new Error(`Failed to retrieve conversations: ${response.status}`);
        }

        const conversations = await response.json();
        return conversations;
    } catch (error) {
        console.error('Failed to retrieve conversation history:', error);
        return [];
    }
}; 