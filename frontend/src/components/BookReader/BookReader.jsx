import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Alert, Spinner, Button, Modal } from 'react-bootstrap';
import Draggable from 'react-draggable';
import { loadBookData, getPageData } from '../../utils/bookDataLoader';
import { saveReadingProgress, clearReadingProgress } from '../../utils/storageUtils';
import { apiRequest } from '../../utils/api';
import { getCachedAudio, cacheAudio } from '../../utils/audioCache';
import InteractivePanel from './InteractivePanel/InteractivePanel';
import { useNarration } from '../../hooks/useNarration';
import './BookReader.css';

const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
};

const BookReader = () => {
    const { bookId, pageNumber } = useParams();
    const navigate = useNavigate();

    // Book data
    const [bookData, setBookData] = useState(null);
    const [currentPage, setCurrentPage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // End-of-book modal
    const [showEndModal, setShowEndModal] = useState(false);

    // Chat panel state
    const [showChatPanel, setShowChatPanel] = useState(false);
    const [currentQuestions, setCurrentQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [activeQuestion, setActiveQuestion] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [isQuestionAudioPlaying, setIsQuestionAudioPlaying] = useState(false);
    const [currentQuestionComplete, setCurrentQuestionComplete] = useState(false);
    const [isAiSpeaking, setIsAiSpeaking] = useState(false);

    // Narration audio
    const { isPlaying: isNarrationPlaying, currentTime: narrationTime, duration: narrationDuration, play: playNarration, pause: pauseNarration, seek: seekNarration } = useNarration(currentPage?.narrationAudioUrl);

    // Global audio stream shared with VoiceButton
    const [globalStream, setGlobalStream] = useState(null);

    useEffect(() => {
        loadCurrentBook();
        initializeGlobalStream();

        return () => {
            if (globalStream) {
                console.log('[BookReader] Stopping global stream tracks');
                globalStream.getTracks().forEach(track => track.stop());
            }
        };
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

    // Reset question complete state when active question or page changes
    useEffect(() => {
        setCurrentQuestionComplete(false);
    }, [activeQuestion?.id, pageNumber]);

    // Auto advance to next question/page when current question is final and AI has finished speaking
    useEffect(() => {
        if (!currentQuestionComplete) return;
        if (isAiSpeaking || isQuestionAudioPlaying) return;
        const t = setTimeout(() => {
            handleNextPage();
        }, 500);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentQuestionComplete, isAiSpeaking, isQuestionAudioPlaying]);

    // Full-auto: after page narration finishes (or page has none), auto-trigger next step
    // — opens chat panel if the page has questions, otherwise navigates to the next page.
    const narrationStartedRef = useRef(false);
    useEffect(() => {
        narrationStartedRef.current = false;
    }, [pageNumber]);

    useEffect(() => {
        if (isNarrationPlaying) {
            narrationStartedRef.current = true;
        }
    }, [isNarrationPlaying]);

    useEffect(() => {
        if (!currentPage) return;
        if (showChatPanel) return;       // chat flow drives advance from here
        if (showEndModal) return;

        const hasNarration = !!currentPage?.narrationAudioUrl;
        if (hasNarration) {
            // Wait for narration to start AND finish before advancing
            if (!narrationStartedRef.current) return;
            if (isNarrationPlaying) return;
        }

        const delay = hasNarration ? 400 : 1500;
        const t = setTimeout(() => {
            handleNextPage();
        }, delay);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, isNarrationPlaying, showChatPanel, showEndModal]);

    // 翻到含问题的页面时，提前在后台生成并缓存问题 TTS 音频
    useEffect(() => {
        if (!currentPage?.questions?.length) return;

        const prefetchQuestionAudio = async () => {
            for (const q of currentPage.questions) {
                if (!q.questionText) continue;
                const cached = await getCachedAudio(q.questionText);
                if (cached) continue;
                try {
                    const response = await apiRequest('/api/tts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: q.questionText }),
                    });
                    if (response?.ok) {
                        const blob = await response.blob();
                        await cacheAudio(q.questionText, blob);
                    }
                } catch {
                    // 静默失败，InteractivePanel 打开时会实时生成兜底
                }
            }
        };

        prefetchQuestionAudio();
    }, [currentPage]);

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

    const initializeGlobalStream = async () => {
        try {
            console.log('[BookReader] Requesting audio-only media stream');
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 24000,
                    channelCount: 1
                }
            });
            setGlobalStream(stream);
        } catch (err) {
            console.error('[BookReader] Failed to initialize audio stream:', err);
        }
    };

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
            setCurrentQuestions([]);
            setCurrentQuestionIndex(0);
            setActiveQuestion(null);
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
        const pageQuestions = currentPage?.questions || [];

        // Case 1: No panels open, page has questions → open panel with first question
        if (!showChatPanel && pageQuestions.length > 0) {
            setCurrentQuestions(pageQuestions);
            setCurrentQuestionIndex(0);
            setActiveQuestion(pageQuestions[0]);
            setShowChatPanel(true);
            setChatMessages([]);
            return;
        }

        // Case 2: Panel open, more questions remain → go to next question
        if (showChatPanel && currentQuestionIndex < currentQuestions.length - 1) {
            const nextIndex = currentQuestionIndex + 1;
            setCurrentQuestionIndex(nextIndex);
            setActiveQuestion(currentQuestions[nextIndex]);
            setChatMessages([]); // Clear chat for new question
            return;
        }

        // Case 3: Panel open, no more questions OR no questions → go to next page
        if (showChatPanel || pageQuestions.length === 0) {
            setShowChatPanel(false);
            setCurrentQuestionIndex(0);
            if (currentPageNum < bookData.totalPages) {
                navigateToPage(currentPageNum + 1);
            } else {
                clearReadingProgress(bookId);
                setShowEndModal(true);
            }
            return;
        }

        // Case 4: Default fallback → go to next page
        if (currentPageNum < bookData.totalPages) {
            navigateToPage(currentPageNum + 1);
        } else {
            clearReadingProgress(bookId);
            setShowEndModal(true);
        }
    };

    const canPerformAction = () => {
        if (isNarrationPlaying) return false;
        if (isQuestionAudioPlaying) return false;
        // When chat panel is open, require the current question to be completed first
        if (showChatPanel && !currentQuestionComplete) return false;
        return true;
    };



    const getButtonColorClass = () => {
        const pageQuestions = currentPage?.questions || [];

        if (showChatPanel) {
            // More questions remaining
            if (currentQuestionIndex < currentQuestions.length - 1) {
                return 'question-btn'; // Green for "Next Question"
            }
            // Last question or no more questions
            return ''; // Blue for "Next Page"
        } else if (pageQuestions.length > 0) {
            return 'question-btn'; // Green for "Discuss Page" 
        } else {
            return ''; // Blue for "Next Page"
        }
    };

    const getButtonText = () => {
        const currentPageNum = parseInt(pageNumber, 10);
        const pageQuestions = currentPage?.questions || [];

        if (showChatPanel) {
            if (currentQuestionIndex < currentQuestions.length - 1) {
                return "Next Question →";
            }
            return currentPageNum >= bookData.totalPages ? "Finish Book" : "Next Page →";
        } else if (pageQuestions.length > 0) {
            return pageQuestions.length === 1 ? "Discuss Page" : "Start Questions";
        } else {
            return currentPageNum >= bookData.totalPages ? "Finish Book" : "Next Page →";
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
        <div className="book-reader-fullscreen">
            {/* Layer 1: Story Image */}
            <div className="image-layer">
                <img
                    src={currentPage.imageUrl}
                    alt={`Page ${currentPage.pageNumber}`}
                    className="fullscreen-image"
                />
                {currentPage?.narrationAudioUrl && (
                    <div className="narration-overlay">
                        <button
                            className="narration-play-btn"
                            onClick={isNarrationPlaying ? pauseNarration : playNarration}
                            aria-label={isNarrationPlaying ? 'Pause narration' : 'Play narration'}
                        >
                            {isNarrationPlaying ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="4" width="4" height="16" />
                                    <rect x="14" y="4" width="4" height="16" />
                                </svg>
                            ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5,3 19,12 5,21" />
                                </svg>
                            )}
                        </button>
                        <input
                            type="range"
                            className="narration-progress"
                            min={0}
                            max={narrationDuration || 0}
                            step={0.1}
                            value={narrationTime}
                            onChange={(e) => seekNarration(Number(e.target.value))}
                        />
                        <span className="narration-time">
                            {formatTime(narrationTime)} / {formatTime(narrationDuration)}
                        </span>
                    </div>
                )}
            </div>

            {/* Layer 2: Floating Interactive Panel */}
            {showChatPanel && (
                <Draggable handle=".drag-handle" bounds="parent">
                    <div className="interactive-panel-container" style={{ position: 'absolute', bottom: '60px', right: '20px', zIndex: 1500 }}>
                        <InteractivePanel
                            mode={'chat'}
                            question={activeQuestion}
                            messages={chatMessages}
                            onAudioPlayingChange={setIsQuestionAudioPlaying}
                            bookId={bookId}
                            pageNumber={parseInt(pageNumber, 10)}
                            questionIndex={currentQuestionIndex}
                            totalQuestions={currentQuestions.length}
                            sharedStream={globalStream}
                            pageText={currentPage?.storyText}
                            onQuestionComplete={() => setCurrentQuestionComplete(true)}
                            onAiSpeakingChange={setIsAiSpeaking}
                        />
                    </div>
                </Draggable>
            )}

            {/* End-of-book modal */}
            <Modal show={showEndModal} centered backdrop="static" keyboard={false}>
                <Modal.Body className="text-center py-5">
                    <h4 className="mb-3">Great job finishing the book!</h4>
                    <p className="text-muted fs-5">Please close this website and return to Zoom.</p>
                </Modal.Body>
            </Modal>

            {/* Layer 3: Bottom Control Bar */}
            <div className="bottom-control-bar">
                <div className="left-controls">
                    <button className="btn-control btn-home" onClick={() => navigate('/')}>Home</button>
                    <button
                        className="btn-control btn-prev"
                        disabled={!canGoPrevious()}
                        onClick={handlePreviousPage}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                </div>

                <div className="center-controls">
                    {/* Center button removed as it's now in the panel */}
                </div>

                <div className="right-controls">
                    <button
                        className="btn-control btn-next"
                        disabled={!canPerformAction()}
                        onClick={handleNextPage}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                        {currentPage?.questions && currentPage.questions.length > 0 && !currentQuestionComplete && (
                            <span className="question-badge">?</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookReader;
