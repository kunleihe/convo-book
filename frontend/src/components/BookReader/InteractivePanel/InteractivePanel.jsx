import React, { useEffect, useState, useRef, useCallback } from 'react';
import VoiceButton from './VoiceButton/VoiceButton';
import { useHTTPChat } from '../../../hooks/useHTTPChat';
import { useTranscriptionWebSocket } from '../../../hooks/useTranscriptionWebSocket';
import { getCachedAudio, cacheAudio } from '../../../utils/audioCache';
import { apiRequest } from '../../../utils/api';
import './InteractivePanel.css';

const InteractivePanel = ({
    question,
    onAudioPlayingChange,
    bookId,
    pageNumber,
    questionIndex,
    totalQuestions,
    sharedStream = null,
    pageText = '',
    onQuestionComplete,
}) => {
    const [isAudioPlaying, setIsAudioPlaying] = useState(!!question?.questionText);
    // Ghost bubble: real-time transcription delta while recording
    const [currentUserTranscript, setCurrentUserTranscript] = useState('');
    // Gate between recording-stop and submit completing to prevent double presses
    const [isProcessingTranscript, setIsProcessingTranscript] = useState(false);
    const [silentHint, setSilentHint] = useState(false);
    const [isUserRecording, setIsUserRecording] = useState(false);

    const messagesEndRef = useRef(null);
    const silentHintTimerRef = useRef(null);

    // --- Hooks ---
    const httpChat = useHTTPChat();

    const transcriptionWS = useTranscriptionWebSocket(
        useCallback((delta) => setCurrentUserTranscript((prev) => prev + delta), [])
    );

    // --- Lifecycle: initialize on question/page change ---
    useEffect(() => {
        if (question && bookId && pageNumber) {
            transcriptionWS.clearAccumulatedTranscript();
            setCurrentUserTranscript('');
            setIsUserRecording(false);
            setSilentHint(false);
            httpChat.initialize(bookId, pageNumber, question, pageText);
            transcriptionWS.connect();
        }
        return () => {
            transcriptionWS.disconnect();
            if (silentHintTimerRef.current) clearTimeout(silentHintTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [question?.id, bookId, pageNumber]);

    // --- Notify parent when question is complete ---
    useEffect(() => {
        if (httpChat.questionComplete) {
            onQuestionComplete?.();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [httpChat.questionComplete]);

    // --- Question audio playback ---
    useEffect(() => {
        if (question?.questionText) {
            playQuestionTTSAsync(question.questionText);
        }
        return () => {
            updateAudioState(false);
        };
    }, [question]);

    // --- Auto-scroll ---
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [httpChat.conversationMessages, currentUserTranscript]);

    // --- Helpers ---
    const updateAudioState = (playing) => {
        setIsAudioPlaying(playing);
        onAudioPlayingChange?.(playing);
    };

    const playQuestionTTSAsync = async (questionText) => {
        try {
            let audioBlob = await getCachedAudio(questionText);
            if (!audioBlob) {
                // 缓存未命中时实时生成（兜底）
                const response = await apiRequest('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: questionText }),
                });
                if (!response?.ok) throw new Error(`TTS failed: ${response?.status}`);
                audioBlob = await response.blob();
                await cacheAudio(questionText, audioBlob);
            }

            await new Promise((resolve) => setTimeout(resolve, 500));
            updateAudioState(true);

            const audioObjectUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioObjectUrl);
            audio.onended = () => { URL.revokeObjectURL(audioObjectUrl); updateAudioState(false); };
            audio.onerror = () => { URL.revokeObjectURL(audioObjectUrl); updateAudioState(false); };
            await audio.play();
        } catch {
            updateAudioState(false);
        }
    };

    const handleRecordingComplete = useCallback((options = {}) => {
        setIsUserRecording(false);
        setIsProcessingTranscript(true);
        try {
            transcriptionWS.commitAudioBuffer(); // fallback flush
            const text = transcriptionWS.getFinalTranscript();
            setCurrentUserTranscript('');
            if (options.isSilent || !text) {
                transcriptionWS.clearAccumulatedTranscript();
                setSilentHint(true);
                if (silentHintTimerRef.current) clearTimeout(silentHintTimerRef.current);
                silentHintTimerRef.current = setTimeout(() => setSilentHint(false), 3000);
            } else {
                httpChat.submitTranscript(text);
            }
        } finally {
            setIsProcessingTranscript(false);
        }
    }, [transcriptionWS, httpChat]);

    // --- Render --- (will be removed in Task 4)
    // eslint-disable-next-line no-unused-vars
    const renderMessage = (msg) => {
        const isUser = msg.role === 'user';
        return (
            <div key={msg.id} className={`chat-message ${isUser ? 'user-message' : 'ai-message'}`}>
                {!isUser && (
                    <div className="avatar-container">
                        <img src="/fox.png" alt="AI" className="avatar-image" />
                    </div>
                )}
                <div className={`message-text ${isUser ? 'user-text' : 'ai-text'}`}>
                    {msg.content}
                </div>
            </div>
        );
    };

    // 气泡文字：优先显示最后一条 AI 消息，否则显示问题文字
    const lastAiMessage = httpChat.conversationMessages
        .filter((m) => m.role === 'assistant')
        .at(-1);
    const displayText = lastAiMessage?.content || question?.questionText || '';

    // Avatar 图片：录音中或加载中显示 listen，其余显示 speak
    const avatarSrc = (isUserRecording || httpChat.isLoading) ? '/listen.gif' : '/speak.gif';

    const voiceButtonDisabled =
        httpChat.isAiSpeaking ||
        httpChat.isLoading ||
        httpChat.questionComplete ||
        isAudioPlaying ||
        isProcessingTranscript;

    return (
        <div className="interactive-panel">
            <div className="drag-handle">
                <div className="drag-handle-bar"></div>
            </div>
            <div className="panel-header">
                <div className="d-flex justify-content-between align-items-center">
                    <div />
                    {totalQuestions > 1 && questionIndex !== undefined && (
                        <small className="text-muted" style={{ marginLeft: 'auto' }}>
                            Question {questionIndex + 1} of {totalQuestions}
                        </small>
                    )}
                </div>
                {httpChat.error && <small className="text-danger">Error: {httpChat.error}</small>}
            </div>

            <div className="panel-content">
                <div className="avatar-section">
                    {/* Content above avatar — three exclusive states */}
                    {isUserRecording ? (
                        <div className="sound-wave">
                            {[...Array(7)].map((_, i) => (
                                <div key={i} className="wave-bar" />
                            ))}
                        </div>
                    ) : httpChat.isLoading ? (
                        <div className="ai-bubble">
                            <div className="loading-dots">
                                <span className="dot" />
                                <span className="dot" />
                                <span className="dot" />
                            </div>
                        </div>
                    ) : (
                        <div className="ai-bubble">{displayText}</div>
                    )}

                    <img src={avatarSrc} alt="AI" className="avatar-image" />
                </div>

                <div className="voice-controls">
                    {silentHint && (
                        <p className="silent-hint">No speech detected. Please try again.</p>
                    )}
                    <VoiceButton
                        disabled={voiceButtonDisabled}
                        sharedStream={sharedStream}
                        onAudioChunk={(pcm16Data) => {
                            if (transcriptionWS.isConnected) {
                                transcriptionWS.sendAudioData(pcm16Data);
                            }
                        }}
                        onRecordingStart={() => {
                            setCurrentUserTranscript('');
                            setIsUserRecording(true);
                        }}
                        onRecordingComplete={handleRecordingComplete}
                    />
                </div>
            </div>
        </div>
    );
};

export default InteractivePanel;
