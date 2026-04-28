import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container, Alert, Spinner, Form } from 'react-bootstrap';
import { loadAllBooks } from '../../utils/bookDataLoader';
import { getReadingProgress } from '../../utils/storageUtils';
import './BookLibrary.css';

const BookLibrary = () => {
    const [books, setBooks] = useState([]);
    const [isNarrationEnabled, setIsNarrationEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        loadBooksData();
    }, []);

    const loadBooksData = async () => {
        try {
            setLoading(true);
            setError(null);
            const booksData = await loadAllBooks();
            const visible = (import.meta.env.VITE_VISIBLE_BOOK_IDS || '')
                .split(',').map(s => s.trim()).filter(Boolean);
            const filtered = visible.length
                ? booksData.filter(b => visible.includes(b.id))
                : booksData;
            setBooks(filtered);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleBookSelect = (bookId) => {
        const savedPage = getReadingProgress(bookId);
        navigate(`/book/${bookId}/page/${savedPage}`);
    };

    const handleNarrationToggle = (enabled) => {
        setIsNarrationEnabled(enabled);
    };

    if (loading) {
        return (
            <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
                <Spinner animation="border" role="status">
                    <span className="visually-hidden">Loading books...</span>
                </Spinner>
            </Container>
        );
    }

    return (
        <div className="book-library">
            <Container>
                {/* Settings - Narration toggle commented out for now
                <div className="library-settings">
                    <Form.Check
                        type="switch"
                        id="narration-toggle"
                        label="Enable Narration"
                        checked={isNarrationEnabled}
                        onChange={(e) => handleNarrationToggle(e.target.checked)}
                    />
                </div>
                */}

                {/* Error Display */}
                {error && (
                    <div className="error-container">
                        <Alert variant="danger" dismissible onClose={() => setError(null)}>
                            <Alert.Heading>Error Loading Books</Alert.Heading>
                            <p>{error}</p>
                        </Alert>
                    </div>
                )}

                {/* Books Grid */}
                <div className="books-container">
                    {books.length === 0 && !loading && !error && (
                        <div className="empty-state">
                            <Alert variant="info">
                                <h4>No Books Available</h4>
                                <p>No books are currently available in the library.</p>
                            </Alert>
                        </div>
                    )}

                    <div className="books-grid">
                        {books.map(book => (
                            <div
                                key={book.id}
                                className="book-card"
                                onClick={() => handleBookSelect(book.id)}
                            >
                                <div className="book-cover">
                                    <img
                                        src={book.coverImageUrl}
                                        alt={`${book.title} cover`}
                                        className="book-cover-image"
                                    />
                                </div>
                                <div className="book-title">
                                    {book.title}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Container>
        </div>
    );
};

export default BookLibrary; 