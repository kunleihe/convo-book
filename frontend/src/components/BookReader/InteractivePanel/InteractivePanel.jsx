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
    onAiSpeakingChange,
}) => {
    const [isAudioPlaying, setIsAudioPlaying] = useState(!!question?.questionText);
    // Gate between recording-stop and submit completing to prevent double presses
    const [isProcessingTranscript, setIsProcessingTranscript] = useState(false);
    const [isUserRecording, setIsUserRecording] = useState(false);
    const [shouldRecord, setShouldRecord] = useState(false);

    const prevIsAiSpeakingRef = useRef(false);
    const prevIsUserRecordingRef = useRef(false);
    const popAudioRef = useRef(null);
    if (popAudioRef.current === null) {
        const audio = new Audio('/pop.mp3');
        audio.volume = 0.5;
        audio.preload = 'auto';
        popAudioRef.current = audio;
    }

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
            setShouldRecord(false);
            prevIsAiSpeakingRef.current = false;
            httpChat.initialize(bookId, pageNumber, question, pageText);
            transcriptionWS.connect();
        }
        return () => {
            transcriptionWS.disconnect();
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

    // --- Pipe isAiSpeaking up so BookReader can wait for TTS before turning page ---
    useEffect(() => {
        onAiSpeakingChange?.(httpChat.isAiSpeaking);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [httpChat.isAiSpeaking]);

    // --- 录音开启瞬间播放 pop 提示音 ---
    useEffect(() => {
        if (isUserRecording && !prevIsUserRecordingRef.current) {
            const audio = popAudioRef.current;
            if (audio) {
                audio.currentTime = 0;
                audio.play().catch(() => {});
            }
        }
        prevIsUserRecordingRef.current = isUserRecording;
    }, [isUserRecording]);

    // --- Auto-start recording on falling edge of AI speaking (round >= 2) ---
    useEffect(() => {
        if (prevIsAiSpeakingRef.current && !httpChat.isAiSpeaking) {
            if (!httpChat.questionComplete && !httpChat.isLoading) {
                console.log('[InteractivePanel] AI finished — auto-starting next round recording');
                setShouldRecord(true);
            }
        }
        prevIsAiSpeakingRef.current = httpChat.isAiSpeaking;
    }, [httpChat.isAiSpeaking, httpChat.questionComplete, httpChat.isLoading]);

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
            audio.onended = () => {
                URL.revokeObjectURL(audioObjectUrl);
                updateAudioState(false);
                setShouldRecord(true); // auto-record once question audio finishes
            };
            audio.onerror = () => { URL.revokeObjectURL(audioObjectUrl); updateAudioState(false); };
            await audio.play();
        } catch {
            updateAudioState(false);
        }
    };

    const handleRecordingComplete = useCallback((options = {}) => {
        setIsUserRecording(false);
        setShouldRecord(false);
        setIsProcessingTranscript(true);
        try {
            transcriptionWS.commitAudioBuffer(); // fallback flush
            const text = transcriptionWS.getFinalTranscript();
            const isTimeout = options.stopReason === 'timeout';

            if (isTimeout) {
                // 10s with no speech: notify AI so it can decide what to do next
                transcriptionWS.clearAccumulatedTranscript();
                httpChat.submitTranscript('[no response]');
            } else if (options.isSilent || !text) {
                // Edge case: stop happened but no transcript was captured — drop silently
                transcriptionWS.clearAccumulatedTranscript();
            } else {
                httpChat.submitTranscript(text);
            }
        } finally {
            setIsProcessingTranscript(false);
        }
    }, [transcriptionWS, httpChat]);

    // 气泡文字：优先显示最后一条 AI 消息，否则显示问题文字
    const lastAiMessage = httpChat.conversationMessages
        .filter((m) => m.role === 'assistant')
        .at(-1);
    const displayText = lastAiMessage?.content || question?.questionText || '';

    // Avatar 图片：TTS 实际播放时显示 speak，其余（idle、录音中、加载中）显示 listen
    const avatarSrc = (isAudioPlaying || httpChat.isAiSpeaking) ? '/speak.gif' : '/listen.gif';

    // Gate auto-recording: don't start while AI is speaking, loading, complete, or question audio is playing
    const recordingBlocked =
        httpChat.isAiSpeaking ||
        httpChat.isLoading ||
        httpChat.questionComplete ||
        isAudioPlaying ||
        isProcessingTranscript;
    const effectiveShouldRecord = shouldRecord && !recordingBlocked;

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
                </div>

                <div className="voice-controls">
                    <VoiceButton
                        shouldRecord={effectiveShouldRecord}
                        sharedStream={sharedStream}
                        onAudioChunk={(pcm16Data) => {
                            if (transcriptionWS.isConnected) {
                                transcriptionWS.sendAudioData(pcm16Data);
                            }
                        }}
                        onRecordingStart={() => setIsUserRecording(true)}
                        onRecordingComplete={handleRecordingComplete}
                    />
                </div>
            </div>
        </div>
    );
};

export default InteractivePanel;
