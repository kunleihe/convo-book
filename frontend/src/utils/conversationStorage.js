import { apiRequest } from './api';

export const storeConversationMessage = async (text, sender, bookId, pageNumber) => {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.warn('No auth token found, cannot store conversation');
            return;
        }

        const response = await apiRequest('/api/conversations/', {
            method: 'POST',
            body: JSON.stringify({
                book_id: bookId,
                page_number: pageNumber,
                sender: sender,
                text: text
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to store conversation: ${response.status}`);
        }

        console.log(`Stored ${sender} message for page ${pageNumber}:`, text.substring(0, 50) + '...');
    } catch (error) {
        console.error('Failed to store conversation message:', error);
        // Don't throw - storage failure shouldn't break the UI
    }
};

export const getConversationHistory = async (bookId, pageNumber) => {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) {
            console.warn('No auth token found, cannot retrieve conversations');
            return [];
        }

        const params = new URLSearchParams();
        if (bookId) params.append('book_id', bookId);
        if (pageNumber !== undefined) params.append('page_number', pageNumber);

        const response = await apiRequest(`/api/conversations/?${params.toString()}`);

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