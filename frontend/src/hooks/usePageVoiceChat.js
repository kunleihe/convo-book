import { useState, useRef, useCallback } from 'react';

export const usePageVoiceChat = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [conversationMessages, setConversationMessages] = useState([]);
    const [currentPrompt, setCurrentPrompt] = useState(null);

    // Streaming transcript states
    const [currentStreamingTranscript, setCurrentStreamingTranscript] = useState('');
    const [isAiSpeaking, setIsAiSpeaking] = useState(false);
    const [streamingResponseId, setStreamingResponseId] = useState(null);

    const websocketRef = useRef(null);
    const responseAudioBufferRef = useRef([]);
    const isPlayingResponseRef = useRef(false);

    // Web Audio API refs for streaming
    const audioContextRef = useRef(null);
    const nextPlayTimeRef = useRef(0);
    const isStreamingAudioRef = useRef(false);

    // Accumulate transcript for complete response
    const currentTranscriptRef = useRef('');

    // Track timing for debugging
    const userInputTimeRef = useRef(null);
    const firstAudioChunkRef = useRef(false);

    const addConversationMessage = useCallback((message, isUser = false) => {
        setConversationMessages(prev => [...prev, {
            id: Date.now(),
            content: message,
            isUser,
            timestamp: new Date()
        }]);
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
                    isStreamingAudioRef.current = false;
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

                case 'response.audio_transcript.done':
                    if (currentTranscriptRef.current) {
                        addConversationMessage(currentTranscriptRef.current, false);
                        currentTranscriptRef.current = '';
                    }

                    // Clear streaming state
                    setIsAiSpeaking(false);
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

    const connect = useCallback(async (bookId, pageNumber) => {
        if (isConnected || isLoading) {
            console.log('[PageVoiceChat] Already connected or connecting');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Fetch page-specific prompt
            console.log(`[PageVoiceChat] Fetching prompt for book ${bookId}, page ${pageNumber}`);
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const promptResponse = await fetch(`${API_BASE_URL}/api/books/${bookId}/page/${pageNumber}/prompt`);

            if (!promptResponse.ok) {
                throw new Error(`Failed to fetch prompt: ${promptResponse.status}`);
            }

            const promptData = await promptResponse.json();
            setCurrentPrompt(promptData);
            console.log('[PageVoiceChat] Prompt fetched successfully');

            // Create WebSocket connection
            const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
            const wsBase = API_BASE_URL.replace(/^https?:/, wsProtocol + ':');
            websocketRef.current = new WebSocket(`${wsBase}/realtime`);

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
                                instructions: promptData.prompt,
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
                        console.log('[PageVoiceChat] Session configured with page-specific prompt:', promptData.prompt.substring(0, 100) + '...');
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
        // Disconnect guard - only disconnect if actually connected or loading
        if (!isConnected && !isLoading) {
            console.log('[PageVoiceChat] Already disconnected');
            return;
        }

        if (websocketRef.current) {
            websocketRef.current.close();
            websocketRef.current = null;
        }

        setIsConnected(false);
        setIsLoading(false);
        setError(null);
        setCurrentPrompt(null);

        // Clean up audio context
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        // Reset audio state
        responseAudioBufferRef.current = [];
        resetStreamingState();
        isPlayingResponseRef.current = false;
        currentTranscriptRef.current = '';

        // Clear streaming transcript state
        setIsAiSpeaking(false);
        setCurrentStreamingTranscript('');
        setStreamingResponseId(null);

        console.log('[PageVoiceChat] Disconnected and cleaned up');
    }, [isConnected, isLoading, resetStreamingState]);

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

            // Create conversation item with audio content
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

            // Don't add placeholder - let transcription handle user messages

            // Create response to get AI reply
            const responseMessage = {
                type: "response.create",
                response: {
                    modalities: ["text", "audio"],
                }
            };
            websocketRef.current.send(JSON.stringify(responseMessage));

            return true;
        } catch (error) {
            console.error('[PageVoiceChat] Error sending audio:', error);
            setError('Failed to send audio message');
            return false;
        }
    }, [uint8ArrayToBase64, addConversationMessage]);

    const clearConversation = useCallback(() => {
        setConversationMessages([]);
        setError(null);

        // Clear streaming state
        setIsAiSpeaking(false);
        setCurrentStreamingTranscript('');
        setStreamingResponseId(null);
    }, []);

    return {
        isConnected,
        isLoading,
        error,
        conversationMessages,
        currentPrompt,
        connect,
        disconnect,
        sendAudioData,
        clearConversation,
        // Streaming transcript states
        currentStreamingTranscript,
        isAiSpeaking,
        streamingResponseId,
    };
}; 