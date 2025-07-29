import React from 'react';
import { useAudioRecorder } from '../../../../hooks/useAudioRecorder';
import './VoiceButton.css';

const VoiceButton = ({
    disabled = false,
    onAudioRecorded,
    onAudioChunk,
    onRecordingComplete
}) => {
    // Audio recording functionality
    const {
        isRecording,
        startRecording,
        stopRecording,
    } = useAudioRecorder(
        // onAudioRecorded callback - send to voice chat
        (pcm16Data, options = {}) => {
            if (options.isSilent) {
                console.log('[VoiceButton] Silent recording detected');
                if (onRecordingComplete) {
                    onRecordingComplete({ isSilent: true });
                }
            } else {
                console.log('[VoiceButton] Audio recorded:', pcm16Data.length, 'samples');
                if (onAudioRecorded) {
                    onAudioRecorded(pcm16Data);
                }
                if (onRecordingComplete) {
                    onRecordingComplete({ isSilent: false });
                }
            }
        },
        // onAudioChunk callback - send to transcription
        (pcm16Data) => {
            if (onAudioChunk) {
                onAudioChunk(pcm16Data);
            }
        }
    );

    const handleRecordStart = async () => {
        if (!isRecording && !disabled) {
            console.log('[VoiceButton] Starting recording...');
            const success = await startRecording();
            if (!success) {
                console.error('[VoiceButton] Failed to start recording');
            }
        }
    };

    const handleRecordStop = () => {
        if (isRecording) {
            console.log('[VoiceButton] Stopping recording...');
            stopRecording();
        }
    };

    return (
        <button
            className={`voice-button btn btn-primary ${isRecording ? 'recording' : ''}`}
            disabled={disabled}
            onMouseDown={handleRecordStart}
            onMouseUp={handleRecordStop}
            onMouseLeave={handleRecordStop} // Stop recording if mouse leaves button
            onTouchStart={handleRecordStart}
            onTouchEnd={handleRecordStop}
        >
            {isRecording ? 'Recording...' : 'Hold to Talk'}
        </button>
    );
};

export default VoiceButton; 