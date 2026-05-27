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
    audioCtx = null,
    audioDestination = null,
    onLogEvent = null,
}) => {
    const [isAudioPlaying, setIsAudioPlaying] = useState(!!question?.questionText);
    // Gate between recording-stop and submit completing to prevent double presses
    const [isProcessingTranscript, setIsProcessingTranscript] = useState(false);
    const [silentHint, setSilentHint] = useState(false);
    const [isUserRecording, setIsUserRecording] = useState(false);

    const silentHintTimerRef = useRef(null);

    // --- Hooks ---
    const httpChat = useHTTPChat();

    const transcriptionWS = useTranscriptionWebSocket(
        useCallback(() => {}, [])
    );

    // --- Lifecycle: initialize on question/page change ---
    useEffect(() => {
        if (question && bookId && pageNumber) {
            transcriptionWS.clearAccumulatedTranscript();
            setIsUserRecording(false);
            setSilentHint(false);
            httpChat.initialize(bookId, pageNumber, question, pageText, audioCtx, audioDestination, {
                onTtsStart: ({ text }) => onLogEvent?.('ai_tts_start', { text, question_id: question.id }),
                onTtsEnd: () => onLogEvent?.('ai_tts_end', {}),
            });
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

    // --- Helpers ---
    const updateAudioState = (playing) => {
        setIsAudioPlaying(playing);
        onAudioPlayingChange?.(playing);
    };

    const playQuestionTTSAsync = async (questionText) => {
        onLogEvent?.('ai_tts_start', { text: questionText, question_id: question?.id });
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

            // Route through shared AudioContext so question TTS is captured in the webm
            if (audioCtx && audioDestination) {
                await audioCtx.resume();
                const elSource = audioCtx.createMediaElementSource(audio);
                elSource.connect(audioDestination);
                elSource.connect(audioCtx.destination);
            }

            const finish = () => {
                URL.revokeObjectURL(audioObjectUrl);
                updateAudioState(false);
                onLogEvent?.('ai_tts_end', {});
            };
            audio.onended = finish;
            audio.onerror = finish;
            await audio.play();
        } catch {
            updateAudioState(false);
            onLogEvent?.('ai_tts_end', {});
        }
    };

    const handleRecordingComplete = useCallback((options = {}) => {
        setIsUserRecording(false);
        setIsProcessingTranscript(true);
        try {
            transcriptionWS.commitAudioBuffer(); // fallback flush
            const text = transcriptionWS.getFinalTranscript();
            onLogEvent?.('user_record_stop', { transcript: text || '', question_id: question?.id });
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
    }, [transcriptionWS, httpChat, onLogEvent, question?.id]);

    // 气泡文字：优先显示最后一条 AI 消息，否则显示问题文字
    const lastAiMessage = httpChat.conversationMessages
        .filter((m) => m.role === 'assistant')
        .at(-1);
    const displayText = lastAiMessage?.content || question?.questionText || '';

    // Avatar 图片：TTS 实际播放时显示 speak，其余（idle、录音中、加载中）显示 listen
    const avatarSrc = (isAudioPlaying || httpChat.isAiSpeaking) ? '/speak.gif' : '/listen.gif';

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
                    {/* Bubble always visible above avatar */}
                    {httpChat.isLoading ? (
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

                    {/* Sound wave below avatar — only when recording */}
                    {isUserRecording && (
                        <div className="sound-wave">
                            {[...Array(7)].map((_, i) => (
                                <div key={i} className="wave-bar" />
                            ))}
                        </div>
                    )}
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
                            setIsUserRecording(true);
                            onLogEvent?.('user_record_start', { question_id: question?.id });
                        }}
                        onRecordingComplete={handleRecordingComplete}
                    />
                </div>
            </div>
        </div>
    );
};

export default InteractivePanel;
