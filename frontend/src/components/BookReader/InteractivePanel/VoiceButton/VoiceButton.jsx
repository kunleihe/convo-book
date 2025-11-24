import React from 'react';
import { useAudioRecorder } from '../../../../hooks/useAudioRecorder';
import microphoneIcon from '../../../../assets/icons/microphone.svg';
import recordIcon from '../../../../assets/icons/record.svg';
import './VoiceButton.css';

const VoiceButton = ({
    disabled = false,
    onAudioRecorded,
    onAudioChunk,
    onRecordingComplete,
    onRecordingStart
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

    const handleClick = async () => {
        if (!disabled) {
            if (!isRecording) {
                // Start recording
                console.log('[VoiceButton] Starting recording...');
                const success = await startRecording();
                if (success && onRecordingStart) {
                    onRecordingStart();
                }
                if (!success) {
                    console.error('[VoiceButton] Failed to start recording');
                }
            } else {
                // Stop recording
                console.log('[VoiceButton] Stopping recording...');
                stopRecording();
            }
        }
    };

    return (
        <button
            className={`voice-button btn btn-primary ${isRecording ? 'recording' : ''}`}
            disabled={disabled}
            onClick={handleClick}
        >
            {isRecording ? (
                <>
                    <img src={recordIcon} alt="Recording" className="button-icon" />
                    Recording... (Tap to Stop)
                </>
            ) : (
                <>
                    <img src={microphoneIcon} alt="Microphone" className="button-icon" />
                    Tap to Record
                </>
            )}
        </button>
    );
};

export default VoiceButton; 