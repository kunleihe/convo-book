import { useState, useRef, useCallback, useEffect } from 'react';
import { apiRequest, getUploadUrl, uploadToS3 } from '../utils/api';
import { storeConversationMessage } from '../utils/conversationStorage';
import { useAudioRecorder } from './useAudioRecorder';

// State Machine Definitions
const STATES = {
    READ: 'READ',       // User is reading, background recording
    AI_SPEAK: 'AI_SPEAK', // AI is speaking, no recording
    DISCUSS: 'DISCUSS',  // Post-AI speech, user discussion recording
    ANSWER: 'ANSWER'    // User explicitly answering
};

export const usePageVoiceChat = () => {
    // --- Core State ---
    const [currentState, setCurrentState] = useState(STATES.READ);
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [conversationMessages, setConversationMessages] = useState([]);
    
    // --- UI States ---
    const [currentStreamingTranscript, setCurrentStreamingTranscript] = useState('');
    const [streamingResponseId, setStreamingResponseId] = useState(null);

    // --- Refs ---
    const websocketRef = useRef(null);
    const responseAudioBufferRef = useRef([]);
    const audioContextRef = useRef(null);
    const nextPlayTimeRef = useRef(0);
    const isStreamingAudioRef = useRef(false);
    const currentTranscriptRef = useRef('');
    
    // Context Refs (for callbacks)
    const currentQuestionRef = useRef(null);
    const currentBookIdRef = useRef(null);
    const currentPageNumberRef = useRef(null);
    const currentUsernameRef = useRef(localStorage.getItem('username') || 'guest');

    // --- Audio Recorder Integration ---
    // Handler for when a recording chunk/file is ready
    const handleAudioRecorded = useCallback(async (pcm16Data, metadata) => {
        if (!pcm16Data || metadata.isSilent) {
            console.log('[VoiceChat] Silent recording, skipping upload');
            return;
        }

        // 1. Send PCM16 to OpenAI Realtime (if in Discussion/Answer mode)
        // We always send audio for transcription, but only create AI response if explicitly answering
        // or if in discussion mode (depends on your design).
        // For now, let's send transcription request.
        const uint8Array = new Uint8Array(pcm16Data.buffer);
        // Helper to convert to base64 (moved inside or imported)
        const base64Audio = btoa(
            new Uint8Array(pcm16Data.buffer)
                .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
             websocketRef.current.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_audio", audio: base64Audio }]
                }
            }));
            
            // If in ANSWER mode, or if DISCUSS mode implies auto-reply, request response
            if (currentState === STATES.ANSWER || currentState === STATES.DISCUSS) {
                 websocketRef.current.send(JSON.stringify({ type: "response.create" }));
            }
        }

        // 2. Upload to S3 (Background Process)
        try {
            const username = currentUsernameRef.current;
            const bookId = currentBookIdRef.current;
            const pageNum = currentPageNumberRef.current;
            
            let stage = 'unknown';
            if (currentState === STATES.READ) stage = 'read';
            if (currentState === STATES.DISCUSS) stage = 'discuss';
            if (currentState === STATES.ANSWER) stage = 'answer';

            if (bookId && pageNum && metadata.blob) {
                console.log(`[VoiceChat] Uploading ${stage} recording...`);
                
                // Generate filename
                const extension = metadata.mimeType?.includes('mp4') ? 'mp4' : 'webm';
                const filename = `recording.${extension}`;
                
                // Get Presigned URL
                const { upload_url, key } = await getUploadUrl({
                    filename: filename,
                    content_type: metadata.blob.type,
                    book_id: bookId,
                    page_number: pageNum,
                    stage: stage,
                    username: username
                });
                
                // Upload to S3
                await uploadToS3(upload_url, metadata.blob);
                console.log(`[VoiceChat] Upload successful: ${key}`);
            }
        } catch (e) {
            console.error('[VoiceChat] Upload failed:', e);
            // Don't block UI for upload failure
        }
    }, [currentState]);

    // Initialize recorder
    const { 
        startRecording, 
        stopRecording, 
        isRecording 
    } = useAudioRecorder(handleAudioRecorded);

    // --- State Machine Transitions ---

    const transitionTo = useCallback((newState) => {
        console.log(`[VoiceChat] State Transition: ${currentState} -> ${newState}`);
        
        // Exit logic for current state
        if (currentState === STATES.READ || currentState === STATES.DISCUSS) {
            stopRecording(); // Stop and trigger upload
        }

        // Entry logic for new state
        setCurrentState(newState);

        if (newState === STATES.READ || newState === STATES.DISCUSS) {
            startRecording(); // Auto-start recording
        }
        
        if (newState === STATES.AI_SPEAK) {
            stopRecording();
        }
    }, [currentState, startRecording, stopRecording]);

    // --- Audio Playback Logic ---
    
    const initializeAudioContext = useCallback(() => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });
            nextPlayTimeRef.current = 0;
        }
        return audioContextRef.current;
    }, []);

    const resumeAudioContext = useCallback(async () => {
        if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
        }
    }, []);

    const streamAudioChunk = useCallback(async (pcm16Data) => {
        try {
            const audioContext = initializeAudioContext();
            await resumeAudioContext();

            if (pcm16Data.length === 0) return;

            const float32Data = new Float32Array(pcm16Data.length);
            for (let i = 0; i < pcm16Data.length; i++) {
                float32Data[i] = pcm16Data[i] / 32768.0;
            }

            const audioBuffer = audioContext.createBuffer(1, float32Data.length, 24000);
            audioBuffer.getChannelData(0).set(float32Data);

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            const currentTime = audioContext.currentTime;
            let startTime = Math.max(currentTime, nextPlayTimeRef.current);
            if (nextPlayTimeRef.current === 0) startTime = currentTime;

            source.start(startTime);
            nextPlayTimeRef.current = startTime + audioBuffer.duration;

        } catch (error) {
            console.error('Audio streaming error:', error);
        }
    }, [initializeAudioContext, resumeAudioContext]);

    // --- WebSocket Logic ---

    const handleWebSocketMessage = useCallback((event) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'response.created':
                    transitionTo(STATES.AI_SPEAK);
                    setCurrentStreamingTranscript('');
                    currentTranscriptRef.current = '';
                    nextPlayTimeRef.current = 0;
                    break;

                case 'response.audio.delta':
                    const binary = atob(data.delta);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    const pcm16 = new Int16Array(bytes.buffer);
                    streamAudioChunk(pcm16);
                    break;

                case 'response.audio.done':
                    const ctx = audioContextRef.current;
                    const delay = ctx ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000) : 0;
                    
                    setTimeout(() => {
                        console.log('[VoiceChat] AI finished speaking.');
                        transitionTo(STATES.DISCUSS);
                    }, delay + 500);
                    break;

                case 'response.audio_transcript.delta':
                    currentTranscriptRef.current += data.delta;
                    setCurrentStreamingTranscript(currentTranscriptRef.current);
                    break;
                
                case 'response.audio_transcript.done':
                    if (currentTranscriptRef.current) {
                        setConversationMessages(prev => [...prev, {
                            id: Date.now(),
                            content: currentTranscriptRef.current,
                            isUser: false,
                            timestamp: new Date()
                        }]);
                    }
                    break;
            }
        } catch (e) {
            console.error(e);
        }
    }, [transitionTo, streamAudioChunk]);

    // --- Public API ---

    const connect = useCallback(async (bookId, pageNumber, questionId) => {
        if (isConnected) return;
        setIsLoading(true);
        
        currentBookIdRef.current = bookId;
        currentPageNumberRef.current = pageNumber;
        currentQuestionRef.current = { id: questionId };

        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
            const wsUrl = `${wsProtocol}://${API_BASE_URL.replace(/^https?:\/\//, '')}/realtime`;
            
            websocketRef.current = new WebSocket(wsUrl);
            websocketRef.current.onopen = () => {
                setIsConnected(true);
                setIsLoading(false);
                transitionTo(STATES.READ); 
                
                const configMsg = {
                    type: "session.update",
                    session: {
                        modalities: ["text", "audio"],
                        voice: "shimmer",
                        input_audio_format: "pcm16",
                        output_audio_format: "pcm16",
                        input_audio_transcription: { model: "whisper-1" }
                    }
                };
                websocketRef.current.send(JSON.stringify(configMsg));
            };
            
            websocketRef.current.onmessage = handleWebSocketMessage;
            
        } catch (e) {
            setError(e.message);
            setIsLoading(false);
        }
    }, [handleWebSocketMessage, transitionTo]);

    const userSubmitAnswer = useCallback(() => {
        transitionTo(STATES.ANSWER);
    }, [transitionTo]);

    return {
        state: currentState,
        isConnected,
        isLoading,
        messages: conversationMessages,
        streamingTranscript: currentStreamingTranscript,
        connect,
        userSubmitAnswer,
        STATES
    };
};