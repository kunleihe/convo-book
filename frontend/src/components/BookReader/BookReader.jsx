import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Alert, Spinner, Button } from 'react-bootstrap';
import Draggable from 'react-draggable';
import { loadBookData, getPageData } from '../../utils/bookDataLoader';
import { saveReadingProgress, clearReadingProgress } from '../../utils/storageUtils';
import { apiRequest } from '../../utils/api';
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
    const [currentQuestions, setCurrentQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [activeQuestion, setActiveQuestion] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [isQuestionAudioPlaying, setIsQuestionAudioPlaying] = useState(false);

    // Global Media Stream for Page Recording & Chat
    const [globalStream, setGlobalStream] = useState(null);
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);

    useEffect(() => {
        loadCurrentBook();
        // Initialize global stream when component mounts (or when bookId changes)
        initializeGlobalStream();

        return () => {
            // Cleanup stream when leaving the reader
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

    // Page Recording Logic: Start/Stop on page change
    useEffect(() => {
        if (!globalStream || !bookId || !pageNumber) return;

        // 1. Stop previous recording if active
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            console.log('[BookReader] Stopping recording for previous page');
            mediaRecorderRef.current.stop();
            // Note: upload logic is handled in onstop callback
        }

        // 2. Start new recording for current page
        startPageRecording(bookId, pageNumber);

        // Cleanup function handles component unmount or update
        return () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
            }
        };
    }, [bookId, pageNumber, globalStream]);

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

    const initializeGlobalStream = async () => {
        try {
            console.log('[BookReader] Requesting global media stream (Audio + Video)');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 } // Low frame rate for reading trace is enough
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 24000,
                    channelCount: 1
                }
            });
            setGlobalStream(stream);
        } catch (err) {
            console.error('[BookReader] Failed to initialize media stream:', err);
            // Non-blocking error: reading can continue without recording
        }
    };

    const startPageRecording = (currentBookId, currentPageNum) => {
        try {
            // Safety check: verify stream tracks
            const videoTracks = globalStream.getVideoTracks();
            const audioTracks = globalStream.getAudioTracks();
            console.log(`[BookReader] Starting recording. Stream tracks - Video: ${videoTracks.length}, Audio: ${audioTracks.length}`);

            if (videoTracks.length > 0) {
                console.log(`[BookReader] Video track label: ${videoTracks[0].label}, Enabled: ${videoTracks[0].enabled}, Muted: ${videoTracks[0].muted}, ReadyState: ${videoTracks[0].readyState}`);
            }

            recordedChunksRef.current = [];
            const options = { mimeType: 'video/webm;codecs=vp8,opus' };

            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`[BookReader] ${options.mimeType} not supported, falling back to default`);
                delete options.mimeType;
            }

            const recorder = new MediaRecorder(globalStream, options);
            console.log(`[BookReader] MediaRecorder created. Actual resolved mimeType: ${recorder.mimeType}`);

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };

            recorder.onstop = async () => {
                const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
                console.log(`[BookReader] Page recording stopped. Size: ${blob.size} bytes`);
                if (blob.size > 0) {
                    // Capture current context for the async upload
                    uploadPageRecording(blob, currentBookId, currentPageNum);
                }
            };

            // Use default timeslice (no argument) to let browser optimize blob creation for a single file
            // This ensures better container integrity (headers/keyframes) compared to small slices
            recorder.start();
            mediaRecorderRef.current = recorder;
            console.log(`[BookReader] Started recording for page ${currentPageNum}`);

        } catch (e) {
            console.error('[BookReader] Failed to start MediaRecorder:', e);
        }
    };

    const uploadPageRecording = async (videoBlob, bId, pNum) => {
        try {
            const username = localStorage.getItem('username') || 'guest';
            // 1. Get Upload URL
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const uploadRes = await apiRequest(`${API_BASE_URL}/api/upload-url`, {
                method: 'POST',
                body: JSON.stringify({
                    filename: `reading.webm`,
                    content_type: 'video/webm',
                    book_id: bId,
                    page_number: parseInt(pNum, 10),
                    stage: 'reading',
                    username: username
                })
            });

            if (!uploadRes.ok) throw new Error('Failed to get upload URL');
            const { upload_url } = await uploadRes.json();

            // 2. Upload to S3
            const s3Res = await fetch(upload_url, {
                method: 'PUT',
                body: videoBlob,
                headers: { 'Content-Type': 'video/webm' }
            });

            if (s3Res.ok) {
                console.log(`[BookReader] Uploaded reading trace for page ${pNum}`);
            } else {
                console.error(`[BookReader] S3 Upload failed: ${s3Res.status}`);
            }

        } catch (e) {
            console.error('[BookReader] Error uploading page recording:', e);
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
                navigate('/');
            }
            return;
        }

        // Case 4: Default fallback → go to next page
        if (currentPageNum < bookData.totalPages) {
            navigateToPage(currentPageNum + 1);
        } else {
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

    const shouldShowQuestionBadge = () => {
        const pageQuestions = currentPage?.questions || [];
        if (pageQuestions.length === 0) return false;

        // If chat panel is not open, we haven't started questions yet, so show the badge
        if (!showChatPanel) return true;

        // If we are in the chat panel
        // If there are more questions after this one, show badge
        if (currentQuestionIndex < currentQuestions.length - 1) return true;

        // If this is the last question, show badge only if audio is still playing
        return isQuestionAudioPlaying;
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
                        />
                    </div>
                </Draggable>
            )}

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
                        {shouldShowQuestionBadge() && (
                            <span className="question-badge">?</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookReader;
