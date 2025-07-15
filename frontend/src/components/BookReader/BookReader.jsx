import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Alert, Spinner, Button } from 'react-bootstrap';
import { loadBookData, getPageData } from '../../utils/bookDataLoader';
import { saveReadingProgress, clearReadingProgress } from '../../utils/storageUtils';
import InteractivePanel from './InteractivePanel/InteractivePanel';
import './BookReader.css';

const BookReader = () => {
    const { bookId, pageNumber } = useParams();
    const navigate = useNavigate();

    // Book data
    const [bookData, setBookData] = useState(null);
    const [currentPage, setCurrentPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Chat panel state
    const [showChatPanel, setShowChatPanel] = useState(false);
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [isQuestionAudioPlaying, setIsQuestionAudioPlaying] = useState(false);

    useEffect(() => {
        loadCurrentBook();
    }, [bookId]);

    useEffect(() => {
        if (bookData) {
            loadCurrentPage();
        }
    }, [bookData, pageNumber]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyPress = (event) => {
            if (event.key === 'ArrowLeft') {
                handlePreviousPage();
            } else if (event.key === 'ArrowRight') {
                handleNextPage();
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [bookData, pageNumber]);

    // Preload next page image when chat panel opens
    useEffect(() => {
        if (showChatPanel && bookData && currentPage) {
            const currentPageNum = parseInt(pageNumber, 10);
            const nextPageNum = currentPageNum + 1;

            // Only preload if there's a next page
            if (nextPageNum <= bookData.totalPages) {
                const nextPage = getPageData(bookData, nextPageNum);
                if (nextPage && nextPage.imageUrl) {
                    const img = new Image();
                    img.src = nextPage.imageUrl;
                    console.log(`Preloading next page image: ${nextPage.imageUrl}`);
                }
            }
        }
    }, [showChatPanel, bookData, currentPage, pageNumber]);

    const loadCurrentBook = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await loadBookData(bookId);
            setBookData(data);
        } catch (err) {
            setError(`Failed to load book: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const loadCurrentPage = () => {
        const pageNum = parseInt(pageNumber, 10);

        if (isNaN(pageNum) || pageNum < 1 || pageNum > bookData.totalPages) {
            navigate(`/book/${bookId}/page/1`, { replace: true });
            return;
        }

        const page = getPageData(bookData, pageNum);
        if (page) {
            setCurrentPage(page);
            saveReadingProgress(bookId, pageNum);

            // Close chat panel when manually navigating to page
            setShowChatPanel(false);
        } else {
            setError(`Page ${pageNum} not found`);
        }
    };

    const navigateToPage = (newPageNumber) => {
        if (newPageNumber >= 1 && newPageNumber <= bookData.totalPages) {
            navigate(`/book/${bookId}/page/${newPageNumber}`);
        }
    };

    const handlePreviousPage = () => {
        const currentPageNum = parseInt(pageNumber, 10);
        if (currentPageNum > 1) {
            navigateToPage(currentPageNum - 1);
        }
    };

    const handleNextPage = () => {
        const currentPageNum = parseInt(pageNumber, 10);

        // First check if we should show chat panel for current page
        if (!showChatPanel && currentPage?.question) {
            setCurrentQuestion(currentPage.question);
            setShowChatPanel(true);
            setChatMessages([]);
            return;
        }

        // If chat panel is already shown or no question, navigate to next page or library
        if (currentPageNum < bookData.totalPages) {
            navigateToPage(currentPageNum + 1);
        } else {
            // Last page - clear reading progress and go back to library
            clearReadingProgress(bookId);
            navigate('/');
        }
    };

    const canPerformAction = () => {
        // Disable action if question audio is playing
        if (isQuestionAudioPlaying) {
            return false;
        }
        // Always allow action - button handles navigation or chat panel
        return true;
    };



    const getButtonColorClass = () => {
        if (showChatPanel) {
            return ''; // Default blue for Next Page / Finish Book
        } else if (currentPage?.question) {
            return 'question-btn'; // Green for Discuss Page
        } else {
            return ''; // Default blue for Next Page
        }
    };

    const canGoPrevious = () => {
        const currentPageNum = parseInt(pageNumber, 10);
        return currentPageNum > 1;
    };

    if (loading) {
        return (
            <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
                <div className="text-center">
                    <Spinner animation="border" role="status" className="mb-3">
                        <span className="visually-hidden">Loading book...</span>
                    </Spinner>
                    <p className="text-muted">Loading "{bookId}"...</p>
                </div>
            </Container>
        );
    }

    if (error) {
        return (
            <Container className="py-4">
                <Alert variant="danger">
                    <Alert.Heading>Error Loading Book</Alert.Heading>
                    <p>{error}</p>
                    <Button variant="outline-primary" onClick={() => navigate('/')}>
                        Back to Library
                    </Button>
                </Alert>
            </Container>
        );
    }

    if (!bookData || !currentPage) {
        return (
            <Container className="py-4">
                <Alert variant="warning">
                    <h4>Book Not Found</h4>
                    <p>The requested book or page could not be found.</p>
                    <Button variant="outline-primary" onClick={() => navigate('/')}>
                        Back to Library
                    </Button>
                </Alert>
            </Container>
        );
    }

    return (
        <div className={`book-reader ${showChatPanel ? 'with-chat-panel' : ''}`}>
            {/* Book Section */}
            <div className={`reading-section ${showChatPanel ? 'with-chat' : ''}`}>
                {/* Main Reading Area */}
                <div className="reading-container">
                    <div className="page-wrapper">
                        {/* Book Page Container with Navigation */}
                        <div className="book-page-container">
                            {/* Previous Page Button */}
                            <Button
                                variant="outline-secondary"
                                className="page-nav-btn page-nav-prev"
                                disabled={!canGoPrevious()}
                                onClick={handlePreviousPage}
                            >
                                ←
                            </Button>

                            {/* Book Page Image */}
                            <img
                                src={currentPage.imageUrl}
                                alt={`Page ${currentPage.pageNumber}`}
                                className="book-page-image"
                            />

                            {/* Next Page Button */}
                            <Button
                                variant="outline-secondary"
                                className={`page-nav-btn page-nav-next ${getButtonColorClass()}`}
                                disabled={!canPerformAction()}
                                onClick={handleNextPage}
                            >
                                →
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Bottom Status Bar */}
                <div className="bottom-status-bar">
                    <Container>
                        <div className="d-flex justify-content-between align-items-center">
                            <h6 className="mb-0 small">{bookData.title}</h6>
                            <span className="page-info small">Page {pageNumber} of {bookData.totalPages}</span>
                        </div>
                    </Container>
                </div>
            </div>

            {/* Chat Panel */}
            {showChatPanel && (
                <InteractivePanel
                    question={currentQuestion}
                    messages={chatMessages}
                    onAudioPlayingChange={setIsQuestionAudioPlaying}
                    bookId={bookId}
                    pageNumber={parseInt(pageNumber, 10)}
                />
            )}
        </div>
    );
};

export default BookReader; 