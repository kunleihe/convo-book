import { useState, useRef, useCallback } from 'react';

export const useTranscriptionWebSocket = (onTranscriptionDelta = null) => {
    const [isConnected, setIsConnected] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('disconnected');

    const websocketRef = useRef(null);
    const accumulatedTranscriptRef = useRef('');

    const addDebugMessage = useCallback((message) => {
        console.log(`[Transcription] ${message}`);
    }, []);

    const handleTranscriptionMessage = useCallback((message) => {
        console.log('[Transcription] Received message:', message);

        switch (message.type) {
            case 'session.updated':
                addDebugMessage('Transcription session updated successfully');
                break;

            case 'input_audio_buffer.committed':
                addDebugMessage(`Audio buffer committed: ${message.item_id}`);
                break;

            case 'input_audio_buffer.speech_started':
                addDebugMessage('Speech started');
                break;

            case 'input_audio_buffer.speech_stopped':
                addDebugMessage('Speech stopped');
                break;

            case 'conversation.item.input_audio_transcription.delta':
                if (message.delta) {
                    addDebugMessage(`Transcription delta: "${message.delta}"`);
                    // Only fire the callback for ghost bubble display; do NOT accumulate here
                    // (the completed event is the authoritative source for each VAD segment)
                    onTranscriptionDelta?.(message.delta);
                }
                break;

            case 'conversation.item.input_audio_transcription.completed':
                if (message.transcript) {
                    addDebugMessage(`Transcription completed: "${message.transcript}"`);
                    // Accumulate — VAD may fire multiple completed events per recording
                    const sep = accumulatedTranscriptRef.current ? ' ' : '';
                    accumulatedTranscriptRef.current += sep + message.transcript;
                } else {
                    addDebugMessage('Transcription completed but no transcript provided');
                }
                break;

            case 'conversation.item.input_audio_transcription.failed':
                addDebugMessage(`Transcription failed: ${message.error?.message || 'Unknown error'}`);
                console.error('[Transcription] Failed:', message);
                break;

            case 'error': {
                const errMsg = message.error?.message || '';
                // VAD may have already auto-committed the buffer; silently ignore empty-buffer errors
                if (errMsg.toLowerCase().includes('buffer')) {
                    addDebugMessage(`Ignoring buffer error (VAD already committed): ${errMsg}`);
                } else {
                    addDebugMessage(`Error: ${errMsg}`);
                    console.error('[Transcription] Error:', message);
                }
                break;
            }

            default:
                addDebugMessage(`Received message: ${message.type}`);
                break;
        }
    }, [addDebugMessage, onTranscriptionDelta]);

    const configureTranscriptionSession = useCallback((ws) => {
        try {
            const sessionConfig = {
                type: "session.update",
                session: {
                    type: "transcription",
                    audio: {
                        input: {
                            format: {
                                type: "audio/pcm",
                                rate: 24000
                            },
                            transcription: {
                                model: "gpt-4o-transcribe",
                                prompt: "",
                                language: "en"
                            },
                            turn_detection: {
                                type: "server_vad",
                                threshold: 0.3,
                                prefix_padding_ms: 100,
                                silence_duration_ms: 200
                            },
                            noise_reduction: {
                                type: "near_field"
                            }
                        }
                    },
                    include: [
                        "item.input_audio_transcription.logprobs"
                    ]
                }
            };

            ws.send(JSON.stringify(sessionConfig));
            addDebugMessage('Sent transcription session configuration with VAD enabled');
        } catch (error) {
            addDebugMessage(`Error configuring session: ${error.message}`);
            console.error('[Transcription] Session config error:', error);
        }
    }, [addDebugMessage]);

    const connect = useCallback(async () => {
        try {
            if (isConnected || connectionStatus === 'connecting') {
                addDebugMessage('Already connected or connecting to transcription');
                return;
            }

            if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
                addDebugMessage('Already connected to transcription');
                return;
            }

            setConnectionStatus('connecting');

            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
            const wsBase = API_BASE_URL.replace(/^https?:/, wsProtocol + ':');
            const token = localStorage.getItem('authToken');
            const wsUrl = `${wsBase}/transcription${token ? `?token=${token}` : ''}`;

            addDebugMessage(`Connecting to: ${wsUrl}`);

            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                addDebugMessage('Connected to transcription WebSocket');
                setIsConnected(true);
                setConnectionStatus('connected');
            };

            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'connection.established') {
                        configureTranscriptionSession(ws);
                    } else {
                        handleTranscriptionMessage(message);
                    }
                } catch (error) {
                    addDebugMessage(`Error parsing message: ${error.message}`);
                    console.error('[Transcription] Message parse error:', error);
                }
            };

            ws.onclose = (event) => {
                addDebugMessage(`WebSocket closed: ${event.code} - ${event.reason}`);
                setIsConnected(false);
                setConnectionStatus('disconnected');
                websocketRef.current = null;
            };

            ws.onerror = (error) => {
                addDebugMessage(`WebSocket error: ${error.message || 'Unknown error'}`);
                console.error('[Transcription] WebSocket error:', error);
                setConnectionStatus('error');
            };

            websocketRef.current = ws;

        } catch (error) {
            addDebugMessage(`Connection error: ${error.message}`);
            console.error('[Transcription] Connection error:', error);
            setConnectionStatus('error');
        }
    }, [isConnected, connectionStatus, addDebugMessage, handleTranscriptionMessage, configureTranscriptionSession]);

    const sendAudioData = useCallback((audioData) => {
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
            try {
                const base64Audio = btoa(
                    String.fromCharCode.apply(null, new Uint8Array(audioData.buffer))
                );
                websocketRef.current.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: base64Audio
                }));
                return true;
            } catch (error) {
                addDebugMessage(`Error sending audio: ${error.message}`);
                console.error('[Transcription] Send audio error:', error);
                return false;
            }
        } else {
            addDebugMessage('Cannot send audio - not connected');
            return false;
        }
    }, [addDebugMessage]);

    const commitAudioBuffer = useCallback(() => {
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
            try {
                websocketRef.current.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
                addDebugMessage('Audio buffer commit sent (fallback flush)');
                return true;
            } catch (error) {
                addDebugMessage(`Error committing audio buffer: ${error.message}`);
                console.error('[Transcription] Commit error:', error);
                return false;
            }
        } else {
            addDebugMessage('Cannot commit audio buffer - not connected');
            return false;
        }
    }, [addDebugMessage]);

    /**
     * Returns the full accumulated transcript since last call (or since connect/clear),
     * then resets the accumulator.
     */
    const getFinalTranscript = useCallback(() => {
        const text = accumulatedTranscriptRef.current;
        accumulatedTranscriptRef.current = '';
        return text;
    }, []);

    /**
     * Clears the accumulated transcript without returning it (use when switching questions).
     */
    const clearAccumulatedTranscript = useCallback(() => {
        accumulatedTranscriptRef.current = '';
    }, []);

    const disconnect = useCallback(() => {
        if (!isConnected && connectionStatus === 'disconnected') {
            return;
        }
        if (websocketRef.current) {
            websocketRef.current.close();
            websocketRef.current = null;
        }
        setIsConnected(false);
        setConnectionStatus('disconnected');
        accumulatedTranscriptRef.current = '';
        addDebugMessage('Disconnected from transcription');
    }, [isConnected, connectionStatus, addDebugMessage]);

    return {
        isConnected,
        connectionStatus,
        connect,
        disconnect,
        sendAudioData,
        commitAudioBuffer,
        getFinalTranscript,
        clearAccumulatedTranscript,
    };
};
