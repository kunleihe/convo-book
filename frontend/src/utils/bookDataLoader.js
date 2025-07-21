// Book data loading utilities

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const loadBookData = async (bookId) => {
    try {
        const response = await fetch(`${API_BASE_URL}/api/books/${bookId}`);
        if (!response.ok) {
            throw new Error(`Failed to load book: ${bookId}`);
        }
        const bookData = await response.json();
        return bookData;
    } catch (error) {
        console.error('Error loading book data:', error);
        throw new Error(`Failed to load book: ${bookId}`);
    }
};

export const loadAllBooks = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/api/books`);
        if (!response.ok) {
            throw new Error('Failed to fetch books from API');
        }
        const data = await response.json();
        return data.books;
    } catch (error) {
        console.error('Error loading all books:', error);
        throw new Error('Failed to load book library');
    }
};

export const getPageData = (bookData, pageNumber) => {
    if (!bookData || !bookData.pages) {
        return null;
    }

    const page = bookData.pages.find(p => p.pageNumber === parseInt(pageNumber));
    return page || null;
}; 