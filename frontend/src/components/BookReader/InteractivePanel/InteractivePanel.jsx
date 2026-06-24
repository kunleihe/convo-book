import React, { useEffect, useState, useRef, useCallback } from 'react';
import VoiceButton from './VoiceButton/VoiceButton';
import { useHTTPChat } from '../../../hooks/useHTTPChat';
import { useTranscriptionWebSocket } from '../../../hooks/useTranscriptionWebSocket';
import { getCachedAudio, cacheAudio } from '../../../utils/audioCache';
import { apiRequest } from '../../../utils/api';
import popSoundUrl from '../../../assets/pop.mp3';
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
    audioCtx = null,
    audioDestination = null,
    onLogEvent = null,
}) => {
    const [isAudioPlaying, setIsAudioPlaying] = useState(!!question?.questionText);
    // Gate between recording-stop and submit completing to prevent double presses
    const [isProcessingTranscript, setIsProcessingTranscript] = useState(false);
    const [isUserRecording, setIsUserRecording] = useState(false);
    const [shouldRecord, setShouldRecord] = useState(false);

    const prevIsAiSpeakingRef = useRef(false);
    const prevIsUserRecordingRef = useRef(false);
    const popBufferRef = useRef(null);
    const popDecodePromiseRef = useRef(null);

    // --- Hooks ---
    const httpChat = useHTTPChat();

    const transcriptionWS = useTranscriptionWebSocket(
        useCallback(() => {}, [])
    );

    // Eagerly decode pop.mp3 into an AudioBuffer as soon as AudioContext is available.
    useEffect(() => {
        if (!audioCtx) return;
        const promise = fetch(popSoundUrl)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status} fetching pop sound`);
                return res.arrayBuffer();
            })
            .then((buf) => audioCtx.decodeAudioData(buf))
            .then((decoded) => { popBufferRef.current = decoded; })
            .catch((err) => console.warn('[InteractivePanel] Pop sound pre-decode failed:', err));
        popDecodePromiseRef.current = promise;
    }, [audioCtx]);

    const playPopSound = useCallback(async () => {
        if (!audioCtx) return;

        // If buffer not ready yet, wait for the in-flight decode (handles CDN cold-start delay).
        if (!popBufferRef.current) {
            if (popDecodePromiseRef.current) {
                await popDecodePromiseRef.current;
            }
            if (!popBufferRef.current) return;
        }

        // Resume context if suspended (before any TTS has played on first round).
        if (audioCtx.state !== 'running') {
            try { await audioCtx.resume(); } catch (e) { /* swallow — best effort */ }
        }

        const src = audioCtx.createBufferSource();
        src.buffer = popBufferRef.current;
        src.connect(audioCtx.destination);
        src.start(audioCtx.currentTime);
    }, [audioCtx]);

    // --- Lifecycle: initialize on question/page change ---
    useEffect(() => {
        if (question && bookId && pageNumber) {
            transcriptionWS.clearAccumulatedTranscript();
            setIsUserRecording(false);
            setShouldRecord(false);
            prevIsAiSpeakingRef.current = false;
            httpChat.initialize(bookId, pageNumber, question, pageText, audioCtx, audioDestination, {
                onTtsStart: ({ text }) => onLogEvent?.('ai_tts_start', { text, question_id: question.id }),
                onTtsEnd: () => onLogEvent?.('ai_tts_end', {}),
            });
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
            playPopSound();
        }
        prevIsUserRecordingRef.current = isUserRecording;
    }, [isUserRecording, playPopSound]);

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
        onLogEvent?.('ai_tts_start', { text: questionText, question_id: question?.id });
        try {
            let audioBlob = await getCachedAudio(questionText);
            if (!audioBlob) {
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
                setShouldRecord(true);
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
        setShouldRecord(false);
        setIsProcessingTranscript(true);
        try {
            transcriptionWS.commitAudioBuffer(); // fallback flush
            const text = transcriptionWS.getFinalTranscript();
            onLogEvent?.('user_record_stop', { transcript: text || '', question_id: question?.id });
            const isTimeout = options.stopReason === 'timeout';

            if (isTimeout) {
                transcriptionWS.clearAccumulatedTranscript();
                httpChat.submitTranscript('[no response]');
            } else if (options.isSilent || !text) {
                transcriptionWS.clearAccumulatedTranscript();
                httpChat.submitTranscript('[no response]');
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
