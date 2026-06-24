import React, { useEffect, useRef } from 'react';
import { useAudioRecorder } from '../../../../hooks/useAudioRecorder';

const VAD_THRESHOLD = 200;          // RMS threshold for speech (Int16)
const SILENCE_DURATION = 2000;      // 2s of silence after speech ends recording
const NO_RESPONSE_TIMEOUT = 10000;  // 10s with no speech ends recording

const calculateRMS = (pcmData) => {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i++) {
        sum += pcmData[i] * pcmData[i];
    }
    return Math.sqrt(sum / pcmData.length);
};

const VoiceButton = ({
    shouldRecord = false,
    onAudioChunk,
    onRecordingComplete,
    onRecordingStart,
    sharedStream = null,
}) => {
    const vadStateRef = useRef({
        startTime: 0,
        hasSpoken: false,
        lastSpeechTime: 0,
        stopReason: null, // 'speech_end' | 'timeout'
    });

    const {
        isRecording,
        startRecording,
        stopRecording,
    } = useAudioRecorder(
        // onAudioRecorded — fires when MediaRecorder.onstop completes
        (_pcm16Data, options = {}) => {
            const stopReason = vadStateRef.current.stopReason;
            const isSilent = stopReason === 'timeout' || options.isSilent;
            onRecordingComplete?.({ isSilent, stopReason });
        },
        // onAudioChunk — VAD analysis on every chunk
        (pcm16Data) => {
            onAudioChunk?.(pcm16Data);

            const rms = calculateRMS(pcm16Data);
            const now = Date.now();
            const vad = vadStateRef.current;

            if (rms > VAD_THRESHOLD) {
                if (!vad.hasSpoken) {
                    console.log('[VoiceButton] Speech detected');
                    vad.hasSpoken = true;
                }
                vad.lastSpeechTime = now;
            } else if (vad.hasSpoken) {
                if (now - vad.lastSpeechTime > SILENCE_DURATION) {
                    console.log('[VoiceButton] End of speech (2s silence)');
                    vad.stopReason = 'speech_end';
                    stopRecording();
                }
            } else if (now - vad.startTime > NO_RESPONSE_TIMEOUT) {
                console.log('[VoiceButton] No-response timeout (10s)');
                vad.stopReason = 'timeout';
                stopRecording();
            }
        },
        sharedStream,
    );

    const isRecordingRef = useRef(false);
    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    // Drive recording from parent's `shouldRecord` flag
    useEffect(() => {
        if (shouldRecord && !isRecordingRef.current) {
            vadStateRef.current = {
                startTime: Date.now(),
                hasSpoken: false,
                lastSpeechTime: Date.now(),
                stopReason: null,
            };
            startRecording().then((ok) => {
                if (ok) onRecordingStart?.();
            });
        } else if (!shouldRecord && isRecordingRef.current) {
            stopRecording();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldRecord]);

    return null;
};

export default VoiceButton;
