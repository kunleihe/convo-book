import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePageVoiceChat } from '../../../hooks/usePageVoiceChat';
import { useTranscriptionWebSocket } from '../../../hooks/useTranscriptionWebSocket';
import { fetchAudioWithRetry, getCachedAudio, cacheAudio } from '../../../utils/audioCache';
import { useAudioRecorder } from '../../../hooks/useAudioRecorder';
import './InteractivePanel.css';

// VAD Configuration
const VAD_THRESHOLD = 500; // RMS threshold for speech detection (Int16)
const SILENCE_DURATION = 2000; // 2 seconds of silence to end speech
const NO_RESPONSE_TIMEOUT = 10000; // 10 seconds total timeout for no response

const calculateRMS = (pcmData) => {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i++) {
        sum += pcmData[i] * pcmData[i];
    }
    return Math.sqrt(sum / pcmData.length);
};

const InteractivePanel = ({
    question,
    onAudioPlayingChange,
    bookId,
    pageNumber,
    questionIndex,
    totalQuestions,
    sharedStream = null, // New prop for stream reuse
    onNavigateNext // Callback to trigger navigation/next question
}) => {
    const [isAudioPlaying, setIsAudioPlaying] = useState(!!question?.audioUrl);
    const [feedbackMessage, setFeedbackMessage] = useState(null);

    // VAD State Refs
    const vadStateRef = useRef({
        startTime: 0,
        hasSpoken: false,
        lastSpeechTime: 0,
        stopReason: null // 'speech_end' | 'timeout' | 'manual'
    });

    // Track previous AI speaking state
    const prevIsAiSpeakingRef = useRef(false);

    // Voice chat hooks
    const pageVoiceChat = usePageVoiceChat();

    // Create callback function to forward transcription completion to main voice chat
    const handleTranscriptionComplete = (transcriptionMessage) => {
        console.log('[InteractivePanel] Forwarding transcription completion to main voice chat');
        // Simulate the transcription completion event for the main voice chat WebSocket
        if (pageVoiceChat.websocketRef && pageVoiceChat.websocketRef.current) {
            // Create a synthetic event that the main WebSocket can handle
            const syntheticEvent = {
                data: JSON.stringify(transcriptionMessage)
            };
            // Call the main WebSocket's message handler directly
            if (pageVoiceChat.handleWebSocketMessage) {
                pageVoiceChat.handleWebSocketMessage(syntheticEvent);
            }
        }
    };

    const transcriptionWS = useTranscriptionWebSocket(bookId, pageNumber, handleTranscriptionComplete);

    // Use a ref to access the latest transcriptionWS state inside callbacks
    const transcriptionWSRef = useRef(transcriptionWS);
    useEffect(() => {
        transcriptionWSRef.current = transcriptionWS;
    }, [transcriptionWS]);

    // Audio Recorder with VAD
    const {
        isRecording,
        startRecording,
        stopRecording,
    } = useAudioRecorder(
        // onAudioRecorded
        (pcm16Data, options = {}) => {
            console.log('[Debug-Check] onAudioRecorded sees isConnected:', transcriptionWS.isConnected);
            console.log('[InteractivePanel] Recording complete. Reason:', vadStateRef.current.stopReason);

            if (vadStateRef.current.stopReason === 'timeout') {
                // Case: No response timeout
                console.log('[InteractivePanel] No response detected (timeout)');
                setFeedbackMessage('No response detected');
                setTimeout(() => setFeedbackMessage(null), 3000);

                // Send [no response] to AI (if supported by backend/prompt)
                // For now, we can send a special event or just ignore. 
                // Requirement says: send [no response] to AI and S3.

                // To write to S3: The transcriptionWS usually handles this via audio chunks. 
                // But since we have no audio worth saving, we might need to send a text message?
                // Current architecture relies on audio. 
                // Let's skip sending empty audio for now to avoid noise, 
                // unless we want to send a synthetic "silence" buffer with a metadata tag?
                // The prompt instructions say "If 10s no response, send [no response]".
                // We can simulate this by sending a text message if the hook supports it, 
                // OR rely on the fact that we send nothing and the AI might not reply? 
                // Actually the requirement says "send [no response] to AI".
                // Send silence message to AI
                if (pageVoiceChat.sendSilenceMessage) {
                    pageVoiceChat.sendSilenceMessage();
                }

            } else {
                // Case: Normal speech end or silence (but logic says if VAD triggered, it's speech)
                if (options.isSilent && !vadStateRef.current.hasSpoken) {
                    // Fallback if VAD didn't catch it but hook thought it was silent
                    console.log('[InteractivePanel] Audio analyzed as silent');
                } else {
                    // Normal flow
                    pageVoiceChat.sendAudioData(pcm16Data);
                    if (transcriptionWSRef.current && transcriptionWSRef.current.isConnected) {
                        // Commit the buffer to finalize transcription
                        setTimeout(() => {
                            transcriptionWSRef.current.commitAudioBuffer();
                        }, 100);
                    }
                }
            }
        },
        // onAudioChunk (VAD Logic Here)
        (pcm16Data) => {
            console.log('[Debug-Check] onAudioChunk sees isConnected:', transcriptionWSRef.current?.isConnected);
            // 1. Send to transcription service (always stream)
            if (transcriptionWSRef.current && transcriptionWSRef.current.isConnected) {
                transcriptionWSRef.current.sendAudioData(pcm16Data);
            }

            // 2. VAD Analysis
            const rms = calculateRMS(pcm16Data);
            const now = Date.now();

            if (rms > VAD_THRESHOLD) {
                if (!vadStateRef.current.hasSpoken) {
                    console.log('[InteractivePanel] Speech detected!');
                    vadStateRef.current.hasSpoken = true;
                }
                vadStateRef.current.lastSpeechTime = now;
            } else {
                // Silence
                if (vadStateRef.current.hasSpoken) {
                    // User has spoken, check for silence duration
                    if (now - vadStateRef.current.lastSpeechTime > SILENCE_DURATION) {
                        console.log('[InteractivePanel] End of speech detected (2s silence)');
                        vadStateRef.current.stopReason = 'speech_end';
                        stopRecording();
                    }
                } else {
                    // User hasn't spoken yet, check for timeout
                    if (now - vadStateRef.current.startTime > NO_RESPONSE_TIMEOUT) {
                        console.log('[InteractivePanel] No response timeout (10s)');
                        vadStateRef.current.stopReason = 'timeout';
                        stopRecording();
                    }
                }
            }
        },
        sharedStream
    );

    // Connect when panel opens with a question
    useEffect(() => {
        let mounted = true;

        if (question && bookId && pageNumber && mounted) {
            console.log('[InteractivePanel] Connecting voice chat for page:', pageNumber);

            // Clear previous transcriptions
            transcriptionWS.clearTranscriptions();

            // Connect both services
            if (question && question.id) {
                pageVoiceChat.connect(bookId, pageNumber, question.id);
            } else {
                console.warn('[InteractivePanel] Question missing ID, cannot connect voice chat');
            }
            transcriptionWS.connect();
        }

        // Cleanup connections when panel closes or page changes
        return () => {
            mounted = false;
            // Add a small delay to prevent race conditions
            setTimeout(() => {
                console.log('[InteractivePanel] Disconnecting voice chat');
                pageVoiceChat.disconnect();
                transcriptionWS.disconnect();
            }, 100);
        };
    }, [bookId, pageNumber]); // Keep connection stable for all questions on the same page

    // Handle question-specific updates when switching questions
    useEffect(() => {
        if (question && question.id && pageVoiceChat.isConnected && bookId && pageNumber) {
            console.log('[InteractivePanel] Updating for new question:', question.id);

            // Clear conversation messages for new question
            pageVoiceChat.clearConversation();

            // Clear transcriptions for new question
            transcriptionWS.clearTranscriptions();

            // Update the question context in the voice chat hook
            pageVoiceChat.updateQuestionContext(question.id);

            // Update the AI prompt for the new question
            updateQuestionPrompt(bookId, pageNumber, question.id);
        }
    }, [question?.id]); // Only trigger when question ID changes

    // Automatic flow control: Recording & Navigation
    useEffect(() => {
        // Only trigger when AI stops speaking (falling edge)
        if (prevIsAiSpeakingRef.current && !pageVoiceChat.isAiSpeaking) {
            const messages = pageVoiceChat.conversationMessages;
            const aiMessages = messages.filter(m => !m.isUser);
            const lastMessage = messages[messages.length - 1];

            let shouldTurnPage = false;

            // 1. Fallback: AI message count == 3 -> Force next page
            if (aiMessages.length === 3) {
                console.log('[InteractivePanel] Max AI turns (3) reached, triggering next page');
                shouldTurnPage = true;
            }

            // 2. AI Command: "next page" in last message
            if (lastMessage && !lastMessage.isUser && lastMessage.content && lastMessage.content.toLowerCase().includes("keep going")) {
                console.log('[InteractivePanel] AI requested next page');
                shouldTurnPage = true;
            }

            if (shouldTurnPage) {
                // Trigger navigation
                if (onNavigateNext) {
                    onNavigateNext();
                }
            } else {
                // Normal flow: continue conversation -> Start VAD
                console.log('[InteractivePanel] AI finished speaking, starting VAD...');
                vadStateRef.current = {
                    startTime: Date.now(),
                    hasSpoken: false,
                    lastSpeechTime: Date.now(),
                    stopReason: null
                };
                startRecording();
            }
        }
        // Update ref for next render
        prevIsAiSpeakingRef.current = pageVoiceChat.isAiSpeaking;
    }, [pageVoiceChat.isAiSpeaking, pageVoiceChat.conversationMessages, startRecording, onNavigateNext]);

    useEffect(() => {
        if (question && question.audioUrl) {
            playQuestionAudioAsync(question.audioUrl);
        }

        // Cleanup: reset audio state when content changes
        return () => {
            if (onAudioPlayingChange) {
                onAudioPlayingChange(false);
            }
            setIsAudioPlaying(false);
        };
    }, [question]);

    const updateAudioState = (playing) => {
        setIsAudioPlaying(playing);
        if (onAudioPlayingChange) {
            onAudioPlayingChange(playing);
        }
    };

    // Update AI prompt for new question without reconnecting
    const updateQuestionPrompt = async (bookId, pageNumber, questionId) => {
        try {
            console.log(`[InteractivePanel] Fetching new prompt for question ${questionId}`);
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const promptResponse = await fetch(`${API_BASE_URL}/api/books/${bookId}/page/${pageNumber}/question/${questionId}/prompt`);

            if (!promptResponse.ok) {
                throw new Error(`Failed to fetch prompt: ${promptResponse.status}`);
            }

            const promptData = await promptResponse.json();
            console.log('[InteractivePanel] New prompt fetched successfully');

            // Update the WebSocket session with new prompt
            if (pageVoiceChat.websocketRef && pageVoiceChat.websocketRef.current) {
                const sessionUpdateMessage = {
                    type: "session.update",
                    session: {
                        modalities: ["text", "audio"],
                        instructions: promptData,
                        voice: "shimmer",
                        input_audio_format: "pcm16",
                        output_audio_format: "pcm16",
                        input_audio_transcription: {
                            model: "whisper-1"
                        },
                        turn_detection: null
                    }
                };

                pageVoiceChat.websocketRef.current.send(JSON.stringify(sessionUpdateMessage));
                console.log('[InteractivePanel] Session updated with new question prompt');
            }
        } catch (error) {
            console.error('[InteractivePanel] Failed to update question prompt:', error);
        }
    };

    const playQuestionAudioAsync = async (audioUrl) => {
        try {
            // Check cache first
            let audioBlob = await getCachedAudio(audioUrl);

            if (!audioBlob) {
                // Fetch from local/cloud
                audioBlob = await fetchAudioWithRetry(audioUrl);
                // Cache for future use
                await cacheAudio(audioUrl, audioBlob);
            }

            // Add 0.8 second delay before playing
            await new Promise(resolve => setTimeout(resolve, 500));

            // Notify parent and update local state that audio is starting
            updateAudioState(true);

            // Play audio
            const audioObjectUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioObjectUrl);

            audio.onended = async () => {
                URL.revokeObjectURL(audioObjectUrl);
                // Notify parent and update local state that audio has ended
                updateAudioState(false);

                // Start VAD Recording automatically
                console.log('[InteractivePanel] Question audio ended, starting VAD...');
                vadStateRef.current = {
                    startTime: Date.now(),
                    hasSpoken: false,
                    lastSpeechTime: Date.now(),
                    stopReason: null
                };
                await startRecording();
            };
            audio.onerror = () => {
                URL.revokeObjectURL(audioObjectUrl);
                console.error('Audio playback failed');
                // Notify parent and update local state that audio has ended (due to error)
                updateAudioState(false);
            };

            await audio.play();

        } catch (error) {
            console.error('Failed to play question audio:', error);
            // Notify parent and update local state that audio has ended (due to error)
            updateAudioState(false);
            // Silently fail - don't break the UI
        }
    };

    // Determine which avatar GIF to show
    const isSpeaking = isAudioPlaying || pageVoiceChat.isAiSpeaking;
    const avatarGif = isSpeaking ? '/speak.gif' : '/listen.gif';

    return (
        <div className="interactive-panel">
            <div className="drag-handle">
                <div className="drag-handle-bar"></div>
            </div>
            <div className="panel-header">
                <div className="d-flex justify-content-between align-items-center">
                    {/* Removed Chat title as requested */}
                    <div />
                    {totalQuestions > 1 && questionIndex !== undefined && (
                        <small className="text-muted" style={{ marginLeft: 'auto' }}>Question {questionIndex + 1} of {totalQuestions}</small>
                    )}
                </div>
                {pageVoiceChat.isLoading && <small className="text-muted">Connecting...</small>}
                {pageVoiceChat.error && <small className="text-danger">Error: {pageVoiceChat.error}</small>}
            </div>

            <div className="panel-content">
                <div className="avatar-display">
                    <img
                        src={avatarGif}
                        alt={isSpeaking ? "Speaking" : "Listening"}
                        className="avatar-gif"
                    />
                </div>

                <div className="voice-controls">
                    {feedbackMessage && (
                        <div className="feedback-message">
                            {feedbackMessage}
                        </div>
                    )}
                    {isRecording && (
                        <div className="recording-indicator">
                            Listening...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InteractivePanel;
