import { useState, useRef, useCallback } from 'react';
import { apiRequest } from '../utils/api';
import { storeConversationMessage } from '../utils/conversationStorage';

export const usePageVoiceChat = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [conversationMessages, setConversationMessages] = useState([]);
    const [currentPrompt, setCurrentPrompt] = useState(null);
    const [currentQuestion, setCurrentQuestion] = useState(null);

    // Streaming transcript states
    const [currentStreamingTranscript, setCurrentStreamingTranscript] = useState('');
    const [isAiSpeaking, setIsAiSpeaking] = useState(false);
    const [streamingResponseId, setStreamingResponseId] = useState(null);

    const websocketRef = useRef(null);
    const responseAudioBufferRef = useRef([]);

    // Web Audio API refs for streaming
    const audioContextRef = useRef(null);
    const nextPlayTimeRef = useRef(0);
    const isStreamingAudioRef = useRef(false);

    // Accumulate transcript for complete response
    const currentTranscriptRef = useRef('');

    // Track timing for debugging
    const userInputTimeRef = useRef(null);
    const firstAudioChunkRef = useRef(false);

    // Track current question and book/page info for callbacks
    const currentQuestionRef = useRef(null);
    const currentBookIdRef = useRef(null);
    const currentPageNumberRef = useRef(null);
    const sendFormattedInitialMessageRef = useRef(null);

    const addConversationMessage = useCallback((message, isUser = false) => {
        const newMessage = {
            id: Date.now(),
            content: message,
            isUser,
            timestamp: new Date()
        };

        setConversationMessages(prev => {
            const updated = [...prev, newMessage];
            console.log(`[PageVoiceChat] Conversation updated. Total messages: ${updated.length}, New message: ${isUser ? 'User' : 'AI'}: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
            return updated;
        });
    }, []);

    // Initialize Web Audio API context
    const initializeAudioContext = useCallback(() => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });
            nextPlayTimeRef.current = 0;
        }
        return audioContextRef.current;
    }, []);

    // Resume audio context if suspended (required by browser policies)
    const resumeAudioContext = useCallback(async () => {
        const audioContext = audioContextRef.current;
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }
    }, []);

    // Convert base64 to Uint8Array
    const base64ToUint8Array = useCallback((base64) => {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }, []);

    // Convert Uint8Array to base64
    const uint8ArrayToBase64 = useCallback((uint8Array) => {
        // Process in chunks to avoid "Maximum call stack size exceeded" error
        const chunkSize = 8192; // Safe chunk size
        let result = '';
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            result += String.fromCharCode.apply(null, chunk);
        }
        return btoa(result);
    }, []);

    // Create WAV file from PCM16 data
    const createWavFile = useCallback((pcm16Data, sampleRate) => {
        const buffer = new ArrayBuffer(44 + pcm16Data.length * 2);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + pcm16Data.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, pcm16Data.length * 2, true);

        // PCM data
        const offset = 44;
        for (let i = 0; i < pcm16Data.length; i++) {
            view.setInt16(offset + i * 2, pcm16Data[i], true);
        }

        return buffer;
    }, []);

    // Handle audio delta from OpenAI response
    const handleAudioDelta = useCallback((base64Audio) => {
        if (!base64Audio) return;
        try {
            const uint8Array = base64ToUint8Array(base64Audio);
            const pcm16Array = new Int16Array(uint8Array.buffer);

            // Add to response buffer for fallback
            responseAudioBufferRef.current.push(pcm16Array);

            // Stream audio chunk immediately
            streamAudioChunk(pcm16Array);
        } catch (error) {
            console.error('Error processing audio delta:', error);
        }
    }, [base64ToUint8Array]);

    // Stream audio chunk immediately using Web Audio API
    const streamAudioChunk = useCallback(async (pcm16Data) => {
        try {
            const audioContext = initializeAudioContext();
            await resumeAudioContext();

            if (pcm16Data.length === 0) {
                return;
            }

            // Create WAV buffer for the chunk
            const wavBuffer = createWavFile(pcm16Data, 24000);

            // Decode audio data
            const audioBuffer = await audioContext.decodeAudioData(wavBuffer);

            // Create buffer source
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            // Schedule playback for seamless continuation
            const currentTime = audioContext.currentTime;
            let startTime = Math.max(currentTime, nextPlayTimeRef.current);

            // If this is the first chunk, start immediately
            if (nextPlayTimeRef.current === 0) {
                startTime = currentTime;
                nextPlayTimeRef.current = currentTime;
            }

            source.start(startTime);
            nextPlayTimeRef.current = startTime + audioBuffer.duration;
        } catch (error) {
            console.error('Audio streaming error:', error);
        }
    }, [initializeAudioContext, resumeAudioContext, createWavFile]);

    // Reset streaming state
    const resetStreamingState = useCallback(() => {
        nextPlayTimeRef.current = 0;
        isStreamingAudioRef.current = false;
    }, []);

    const sendFormattedInitialMessage = useCallback(async (childResponse) => {
        // Check if we have valid context - if not, the session might have ended or disconnected
        if (!currentQuestionRef.current || !currentBookIdRef.current || !currentPageNumberRef.current) {
            console.warn('[PageVoiceChat] Missing context for formatting message - session may have ended');
            // Fail silently as this usually happens during page transitions/unmount
            return false;
        }

        try {
            console.log('[PageVoiceChat] Formatting initial message with child response:', childResponse);
            console.log('[PageVoiceChat] Current context for formatting:', {
                bookId: currentBookIdRef.current,
                pageNumber: currentPageNumberRef.current,
                questionId: currentQuestionRef.current?.id
            });

            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const response = await apiRequest(`${API_BASE_URL}/api/prompts/format-initial-message`, {
                method: 'POST',
                body: JSON.stringify({
                    book_id: currentBookIdRef.current,
                    page_number: currentPageNumberRef.current,
                    question_id: currentQuestionRef.current.id,
                    child_response: childResponse
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to format message: ${response.status}`);
            }

            const { formatted_message } = await response.json();
            console.log('[PageVoiceChat] Formatted message:', formatted_message.substring(0, 200) + '...');

            // Send formatted message to OpenAI
            const messageItem = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text: formatted_message }]
                }
            };

            websocketRef.current.send(JSON.stringify(messageItem));

            // Create response to get AI reply
            const responseMessage = {
                type: "response.create",
                response: { modalities: ["text", "audio"] }
            };

            websocketRef.current.send(JSON.stringify(responseMessage));
            console.log('[PageVoiceChat] Formatted message sent, AI response requested');
            return true;
        } catch (error) {
            console.error('[PageVoiceChat] Failed to format and send initial message:', error);
            setError('Failed to process conversation');
            return false;
        }
    }, []);

    // Update the ref whenever the function changes
    sendFormattedInitialMessageRef.current = sendFormattedInitialMessage;

    const handleWebSocketMessage = useCallback((event) => {
        try {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'session.created':
                    console.log('[PageVoiceChat] Session created successfully');
                    break;
                case 'session.updated':
                    console.log('[PageVoiceChat] Session updated successfully');
                    break;
                case 'response.created':
                    console.log('[PageVoiceChat] AI is responding...');
                    // Reset audio buffer and streaming state for new response
                    responseAudioBufferRef.current = [];
                    resetStreamingState();
                    isStreamingAudioRef.current = true;
                    currentTranscriptRef.current = '';
                    firstAudioChunkRef.current = false;

                    // Set streaming transcript state
                    setIsAiSpeaking(true);
                    setCurrentStreamingTranscript('');
                    setStreamingResponseId(Date.now().toString());
                    break;

                case 'response.audio.delta':
                    handleAudioDelta(data.delta);
                    break;

                case 'response.audio.done':
                    console.log('[PageVoiceChat] response.audio.done received - scheduling button enable');
                    isStreamingAudioRef.current = false;

                    // Calculate when the last audio chunk will finish playing
                    const audioContext = audioContextRef.current;
                    if (audioContext && nextPlayTimeRef.current > 0) {
                        const remainingTime = Math.max(0, (nextPlayTimeRef.current - audioContext.currentTime) * 1000);
                        console.log(`[PageVoiceChat] Audio will finish in ${remainingTime}ms`);

                        setTimeout(() => {
                            console.log('[PageVoiceChat] Audio finished - enabling voice button');
                            setIsAiSpeaking(false);
                        }, remainingTime);
                    } else {
                        // Fallback: enable immediately if we can't calculate time
                        console.log('[PageVoiceChat] Could not calculate audio duration - enabling voice button immediately');
                        setIsAiSpeaking(false);
                    }
                    break;

                case 'response.done':
                    isStreamingAudioRef.current = false;
                    // Clean up after response is complete
                    setTimeout(() => {
                        responseAudioBufferRef.current = [];
                        resetStreamingState();
                    }, 1000);
                    break;

                case 'response.audio_transcript.delta':
                    if (data.delta) {
                        currentTranscriptRef.current += data.delta;
                        // Update streaming transcript state for real-time display
                        setCurrentStreamingTranscript(currentTranscriptRef.current);
                    }
                    break;

                case 'conversation.item.input_audio_transcription.completed':
                    if (data.transcript) {
                        console.log('[PageVoiceChat] Child transcription completed:', data.transcript);
                        // Add child's message to conversation display
                        addConversationMessage(data.transcript, true);

                        // Store child's transcription in database
                        if (currentBookIdRef.current && currentPageNumberRef.current) {
                            console.log('[PageVoiceChat] Storing user message with context:', {
                                bookId: currentBookIdRef.current,
                                pageNumber: currentPageNumberRef.current,
                                questionId: currentQuestionRef.current?.id
                            });

                            storeConversationMessage(
                                data.transcript,
                                'user',
                                currentBookIdRef.current,
                                currentPageNumberRef.current,
                                currentQuestionRef.current?.id
                            );
                        }

                        // Check if this is the first message or a follow-up
                        if (conversationMessages.length === 0) {
                            // This is the first message - format with story context
                            if (sendFormattedInitialMessageRef.current) {
                                sendFormattedInitialMessageRef.current(data.transcript);
                            }
                        } else {
                            // This is a follow-up message - send raw transcription and let session handle history
                            console.log('[PageVoiceChat] Sending follow-up message:', data.transcript);
                            const messageItem = {
                                type: "conversation.item.create",
                                item: {
                                    type: "message",
                                    role: "user",
                                    content: [{ type: "input_text", text: data.transcript }]
                                }
                            };
                            websocketRef.current.send(JSON.stringify(messageItem));

                            // Create response to get AI reply
                            const responseMessage = {
                                type: "response.create",
                                response: { modalities: ["text", "audio"] }
                            };
                            websocketRef.current.send(JSON.stringify(responseMessage));
                            console.log('[PageVoiceChat] Follow-up message sent, AI response requested');
                        }
                    }
                    break;

                case 'response.audio_transcript.done':
                    console.log('[PageVoiceChat] response.audio_transcript.done received - keeping voice button disabled');
                    if (currentTranscriptRef.current) {
                        addConversationMessage(currentTranscriptRef.current, false);

                        // Store AI message
                        if (currentBookIdRef.current && currentPageNumberRef.current) {
                            console.log('[PageVoiceChat] Storing AI message with context:', {
                                bookId: currentBookIdRef.current,
                                pageNumber: currentPageNumberRef.current,
                                questionId: currentQuestionRef.current?.id
                            });

                            storeConversationMessage(
                                currentTranscriptRef.current,
                                'ai',
                                currentBookIdRef.current,
                                currentPageNumberRef.current,
                                currentQuestionRef.current?.id
                            );
                        }
                        currentTranscriptRef.current = '';
                    }
                    // Clear streaming transcript state but keep isAiSpeaking true until audio finishes
                    setCurrentStreamingTranscript('');
                    setStreamingResponseId(null);
                    break;

                case 'error':
                    console.error('[PageVoiceChat] WebSocket error:', data.error);
                    setError(data.error?.message || 'WebSocket error occurred');
                    break;

                default:
                    console.log('[PageVoiceChat] Unhandled message type:', data.type);
                    break;
            }
        } catch (error) {
            console.error('[PageVoiceChat] Error parsing WebSocket message:', error);
        }
    }, [handleAudioDelta, resetStreamingState, addConversationMessage]);

    const connect = useCallback(async (bookId, pageNumber, questionId) => {
        if (isConnected || isLoading) {
            console.log('[PageVoiceChat] Already connected or connecting');
            return;
        }
        setIsLoading(true);
        setError(null);

        try {
            // Store current context in refs for use in callbacks
            currentBookIdRef.current = bookId;
            currentPageNumberRef.current = pageNumber;
            currentQuestionRef.current = { id: questionId };

            // Fetch question-specific prompt
            console.log(`[PageVoiceChat] Fetching prompt for book ${bookId}, page ${pageNumber}, question ${questionId}`);
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const promptResponse = await apiRequest(`${API_BASE_URL}/api/books/${bookId}/page/${pageNumber}/question/${questionId}/prompt`);

            if (!promptResponse.ok) {
                throw new Error(`Failed to fetch prompt: ${promptResponse.status}`);
            }

            const promptData = await promptResponse.json();
            setCurrentPrompt(promptData);
            setCurrentQuestion({ id: questionId });
            console.log('[PageVoiceChat] Question-specific prompt fetched successfully');

            // Create WebSocket connection
            const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
            const wsBase = API_BASE_URL.replace(/^https?:/, wsProtocol + ':');

            // Add token to URL query parameters for authentication
            const token = localStorage.getItem('authToken');
            const wsUrl = `${wsBase}/realtime${token ? `?token=${token}` : ''}`;

            websocketRef.current = new WebSocket(wsUrl);

            websocketRef.current.onopen = () => {
                console.log('[PageVoiceChat] Connected to server');
                setIsConnected(true);
                setIsLoading(false);

                // Send session configuration with page-specific prompt
                setTimeout(() => {
                    if (websocketRef.current?.readyState === WebSocket.OPEN) {
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
                        websocketRef.current.send(JSON.stringify(sessionUpdateMessage));
                        console.log('[PageVoiceChat] Session configured with question-specific prompt:', promptData.substring(0, 100) + '...');
                    }
                }, 100);
            };

            websocketRef.current.onmessage = handleWebSocketMessage;

            websocketRef.current.onerror = (error) => {
                console.error('[PageVoiceChat] WebSocket error:', error);
                setError('Failed to connect to voice chat');
                setIsLoading(false);
            };

            websocketRef.current.onclose = () => {
                console.log('[PageVoiceChat] WebSocket connection closed');
                setIsConnected(false);
                setIsLoading(false);
            };
        } catch (error) {
            console.error('[PageVoiceChat] Connection error:', error);
            setError(error.message);
            setIsLoading(false);
        }
    }, [isConnected, isLoading, handleWebSocketMessage]);

    const disconnect = useCallback(() => {
        if (websocketRef.current) {
            console.log('[PageVoiceChat] Disconnecting...');
            websocketRef.current.close();
            websocketRef.current = null;
        }
        // Clear state
        setIsConnected(false);
        setIsLoading(false);
        setError(null);
        setCurrentPrompt(null);
        setCurrentQuestion(null);
        setConversationMessages([]);
        setIsAiSpeaking(false);
        setCurrentStreamingTranscript('');
        setStreamingResponseId(null);

        // Clear refs
        currentQuestionRef.current = null;
        currentBookIdRef.current = null;
        currentPageNumberRef.current = null;
        currentTranscriptRef.current = '';
        responseAudioBufferRef.current = [];

        console.log('[PageVoiceChat] Disconnected and state cleared');
    }, []);

    const sendAudioData = useCallback((pcm16Data) => {
        if (!websocketRef.current) {
            console.error('[PageVoiceChat] WebSocket not initialized');
            return false;
        }
        if (websocketRef.current.readyState !== WebSocket.OPEN) {
            console.error('[PageVoiceChat] WebSocket not ready');
            return false;
        }
        if (!pcm16Data || pcm16Data.length === 0) {
            console.error('[PageVoiceChat] No audio data to send');
            return false;
        }

        try {
            // Convert PCM16 to base64 safely
            const uint8Array = new Uint8Array(pcm16Data.buffer);
            const base64Audio = uint8ArrayToBase64(uint8Array);

            // Create conversation item with audio content for transcription only
            const conversationItemMessage = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [
                        {
                            type: "input_audio",
                            audio: base64Audio
                        }
                    ]
                }
            };

            websocketRef.current.send(JSON.stringify(conversationItemMessage));
            userInputTimeRef.current = Date.now();
            console.log('[PageVoiceChat] Audio sent for transcription');

            // Don't create response yet - wait for transcription completion
            // The response will be created after we format and send the initial message
            return true;
        } catch (error) {
            console.error('[PageVoiceChat] Error sending audio:', error);
            setError('Failed to send audio message');
            return false;
        }
    }, [uint8ArrayToBase64]);

    const clearConversation = useCallback(() => {
        setConversationMessages([]);
        setError(null);
        // Clear streaming state
        setIsAiSpeaking(false);
        setCurrentStreamingTranscript('');
        setStreamingResponseId(null);
    }, []);

    // Function to update question context when switching questions
    const updateQuestionContext = useCallback((questionId) => {
        console.log('[PageVoiceChat] Updating question context to:', questionId);
        currentQuestionRef.current = { id: questionId };
        setCurrentQuestion({ id: questionId });

        // Also update the current prompt state to reflect the new question
        if (currentBookIdRef.current && currentPageNumberRef.current) {
            console.log('[PageVoiceChat] Fetching updated prompt for new question context');
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            apiRequest(`${API_BASE_URL}/api/books/${currentBookIdRef.current}/page/${currentPageNumberRef.current}/question/${questionId}/prompt`)
                .then(response => {
                    if (response.ok) {
                        return response.json();
                    }
                    throw new Error(`Failed to fetch prompt: ${response.status}`);
                })
                .then(promptData => {
                    setCurrentPrompt(promptData);
                    console.log('[PageVoiceChat] Updated prompt state for question:', questionId);
                })
                .catch(error => {
                    console.error('[PageVoiceChat] Failed to update prompt state:', error);
                });
        }
    }, []);

    // Send silence message to AI
    const sendSilenceMessage = useCallback(() => {
        if (!websocketRef.current) {
            console.error('[PageVoiceChat] WebSocket not initialized');
            return false;
        }
        if (websocketRef.current.readyState !== WebSocket.OPEN) {
            console.error('[PageVoiceChat] WebSocket not ready');
            return false;
        }

        try {
            // Add a message bubble for silence to show user interaction
            addConversationMessage('<No speech detected...>', true);

            // Store silence message in database
            if (currentBookIdRef.current && currentPageNumberRef.current) {
                console.log('[PageVoiceChat] Storing silence message with context:', {
                    bookId: currentBookIdRef.current,
                    pageNumber: currentPageNumberRef.current,
                    questionId: currentQuestionRef.current?.id
                });

                storeConversationMessage(
                    '<no speech detected>',
                    'user',
                    currentBookIdRef.current,
                    currentPageNumberRef.current,
                    currentQuestionRef.current?.id
                );
            }

            // Check if this is the first message or a follow-up
            if (conversationMessages.length === 0) {
                // This is the first message - use formatted approach
                if (sendFormattedInitialMessageRef.current) {
                    sendFormattedInitialMessageRef.current("[silence]");
                    console.log('[PageVoiceChat] Initial silence message sent with story context');
                } else {
                    console.error('[PageVoiceChat] sendFormattedInitialMessage not available');
                    setError('Failed to send silence message - missing context');
                    return false;
                }
            } else {
                // This is a follow-up message - send raw text and let session handle history
                console.log('[PageVoiceChat] Sending follow-up silence message');
                const messageItem = {
                    type: "conversation.item.create",
                    item: {
                        type: "message",
                        role: "user",
                        content: [{ type: "input_text", text: "[silence]" }]
                    }
                };
                websocketRef.current.send(JSON.stringify(messageItem));

                // Create response to get AI reply
                const responseMessage = {
                    type: "response.create",
                    response: { modalities: ["text", "audio"] }
                };
                websocketRef.current.send(JSON.stringify(responseMessage));
                console.log('[PageVoiceChat] Follow-up silence message sent, AI response requested');
            }
            return true;
        } catch (error) {
            console.error('[PageVoiceChat] Error sending silence message:', error);
            setError('Failed to send silence message');
            return false;
        }
    }, [conversationMessages.length, addConversationMessage]);

    return {
        isConnected,
        isLoading,
        error,
        conversationMessages,
        currentPrompt,
        currentQuestion,
        connect,
        disconnect,
        sendAudioData,
        sendSilenceMessage,
        addConversationMessage,
        clearConversation,
        updateQuestionContext,
        // Streaming transcript states
        currentStreamingTranscript,
        isAiSpeaking,
        streamingResponseId,
        // Expose WebSocket ref and message handler for external use
        websocketRef,
        handleWebSocketMessage,
    };
};
