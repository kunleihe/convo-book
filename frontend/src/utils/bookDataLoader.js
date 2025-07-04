// Book data loading utilities

export const loadBookData = async (bookId) => {
    try {
        const response = await fetch(`/data/books/${bookId}.json`);
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
        // For now, we'll manually list the available books
        // In the future, this could come from an API endpoint
        const availableBooks = ['book1']; // Add more book IDs as needed

        const bookPromises = availableBooks.map(async (bookId) => {
            try {
                const bookData = await loadBookData(bookId);
                // Return just the metadata for the library view
                return {
                    id: bookData.id,
                    title: bookData.title,
                    coverImageUrl: bookData.coverImageUrl,
                    totalPages: bookData.totalPages
                };
            } catch (error) {
                console.error(`Failed to load book ${bookId}:`, error);
                return null;
            }
        });

        const books = await Promise.all(bookPromises);
        // Filter out any failed book loads
        return books.filter(book => book !== null);
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