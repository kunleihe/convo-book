import { useState, useRef, useCallback } from 'react';
import { storeConversationMessage } from '../utils/conversationStorage';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const useHTTPChat = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [isAiSpeaking, setIsAiSpeaking] = useState(false);
    const [error, setError] = useState(null);
    const [conversationMessages, setConversationMessages] = useState([]);
    const [roundNumber, setRoundNumber] = useState(1);
    const [questionComplete, setQuestionComplete] = useState(false);

    // Refs for logic to avoid stale closure issues
    const roundNumberRef = useRef(1);
    const conversationHistoryRef = useRef([]);
    const bookIdRef = useRef(null);
    const pageNumberRef = useRef(null);
    const questionIdRef = useRef(null);
    const questionTextRef = useRef('');
    const customPromptRef = useRef(null);
    const pageTextRef = useRef('');

    /**
     * Initialize for a new question. Must be called when question or page changes.
     * @param {string} bookId
     * @param {number} pageNumber
     * @param {{id: string, questionText: string, customPrompt?: string}} question
     * @param {string} pageText
     */
    const initialize = useCallback((bookId, pageNumber, question, pageText) => {
        bookIdRef.current = bookId;
        pageNumberRef.current = pageNumber;
        questionIdRef.current = question.id;
        questionTextRef.current = question.questionText;
        customPromptRef.current = question.customPrompt ?? null;
        pageTextRef.current = pageText ?? '';

        // Seed conversation history with the initial AI question
        conversationHistoryRef.current = [
            { role: 'assistant', content: question.questionText },
        ];

        roundNumberRef.current = 1;
        setRoundNumber(1);
        setQuestionComplete(false);
        setConversationMessages([]);
        setIsLoading(false);
        setIsAiSpeaking(false);
        setError(null);
    }, []);

    const _playTTS = useCallback(async (text) => {
        setIsAiSpeaking(true);
        try {
            if (window.MediaSource) {
                const mediaSource = new MediaSource();
                const audio = new Audio();
                audio.src = URL.createObjectURL(mediaSource);
                audio.onended = () => setIsAiSpeaking(false);
                audio.onerror = () => setIsAiSpeaking(false);

                await new Promise((resolve) =>
                    mediaSource.addEventListener('sourceopen', resolve, { once: true })
                );

                audio.play();

                const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');

                const ttsResponse = await fetch(`${API_BASE_URL}/api/tts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text }),
                });

                if (!ttsResponse.ok) {
                    throw new Error(`TTS request failed: ${ttsResponse.status}`);
                }

                const reader = ttsResponse.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        mediaSource.endOfStream();
                        break;
                    }
                    if (sourceBuffer.updating) {
                        await new Promise((r) =>
                            sourceBuffer.addEventListener('updateend', r, { once: true })
                        );
                    }
                    sourceBuffer.appendBuffer(value);
                }
            } else {
                // Fallback for browsers without MediaSource API
                const ttsResponse = await fetch(`${API_BASE_URL}/api/tts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text }),
                });

                if (!ttsResponse.ok) {
                    throw new Error(`TTS request failed: ${ttsResponse.status}`);
                }

                const arrayBuffer = await ttsResponse.arrayBuffer();
                const audioContext = new AudioContext();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                source.onended = () => setIsAiSpeaking(false);
                source.start();
            }
        } catch (err) {
            console.error('[useHTTPChat] TTS error:', err);
            setIsAiSpeaking(false);
        }
    }, []);

    /**
     * Submit the user's transcript for the current round.
     * @param {string} text
     */
    const submitTranscript = useCallback(async (text) => {
        setIsLoading(true);
        setError(null);
        try {
            // Snapshot history BEFORE appending this turn's user message
            const historySnapshot = [...conversationHistoryRef.current];

            // Append user message to display + history
            const userMsg = { id: Date.now(), role: 'user', content: text };
            setConversationMessages((prev) => [...prev, userMsg]);
            conversationHistoryRef.current = [
                ...conversationHistoryRef.current,
                { role: 'user', content: text },
            ];

            storeConversationMessage(
                text,
                'user',
                bookIdRef.current,
                pageNumberRef.current,
                questionIdRef.current,
            );

            // Call /api/chat
            const chatResponse = await fetch(`${API_BASE_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transcript: text,
                    page_text: pageTextRef.current,
                    question_text: questionTextRef.current,
                    custom_prompt: customPromptRef.current,
                    round_number: roundNumberRef.current,
                    conversation_history: historySnapshot,
                }),
            });

            if (!chatResponse.ok) {
                const detail = await chatResponse.text();
                throw new Error(`Chat request failed (${chatResponse.status}): ${detail}`);
            }

            const { response: aiResponse, is_final } = await chatResponse.json();

            // Append AI message to display + history
            const aiMsg = { id: Date.now() + 1, role: 'assistant', content: aiResponse };
            setConversationMessages((prev) => [...prev, aiMsg]);
            conversationHistoryRef.current = [
                ...conversationHistoryRef.current,
                { role: 'assistant', content: aiResponse },
            ];

            storeConversationMessage(
                aiResponse,
                'ai',
                bookIdRef.current,
                pageNumberRef.current,
                questionIdRef.current,
            );

            // Play TTS (non-blocking: don't await; isAiSpeaking tracks completion)
            _playTTS(aiResponse);

            // Advance round or mark complete
            if (is_final || roundNumberRef.current >= 2) {
                setQuestionComplete(true);
            } else {
                roundNumberRef.current += 1;
                setRoundNumber(roundNumberRef.current);
            }
        } catch (err) {
            console.error('[useHTTPChat] submitTranscript error:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [_playTTS]);

    /**
     * Submit a silence token when the user says nothing or recording is empty.
     */
    const sendSilenceMessage = useCallback(() => {
        submitTranscript('[silence]');
    }, [submitTranscript]);

    const reset = useCallback(() => {
        roundNumberRef.current = 1;
        setRoundNumber(1);
        setQuestionComplete(false);
        setConversationMessages([]);
        conversationHistoryRef.current = [];
        setIsLoading(false);
        setIsAiSpeaking(false);
        setError(null);
    }, []);

    return {
        isLoading,
        isAiSpeaking,
        error,
        conversationMessages,
        roundNumber,
        questionComplete,
        initialize,
        submitTranscript,
        sendSilenceMessage,
        reset,
    };
};
