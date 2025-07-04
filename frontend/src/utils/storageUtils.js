// Local storage utilities for reading progress

export const saveReadingProgress = (bookId, pageNumber) => {
    try {
        localStorage.setItem(`reading_progress_${bookId}`, pageNumber.toString());
    } catch (error) {
        console.error('Failed to save reading progress:', error);
    }
};

export const getReadingProgress = (bookId) => {
    try {
        const savedPage = localStorage.getItem(`reading_progress_${bookId}`);
        return savedPage ? parseInt(savedPage, 10) : 1;
    } catch (error) {
        console.error('Failed to get reading progress:', error);
        return 1;
    }
};

export const clearReadingProgress = (bookId) => {
    try {
        localStorage.removeItem(`reading_progress_${bookId}`);
    } catch (error) {
        console.error('Failed to clear reading progress:', error);
    }
}; 