import React, { useEffect, useState } from 'react';
import VoiceButton from './VoiceButton/VoiceButton';
import { usePageVoiceChat } from '../../../hooks/usePageVoiceChat';
import { useTranscriptionWebSocket } from '../../../hooks/useTranscriptionWebSocket';
import avatarImage from '../../../assets/bot-avatar.png';
import userAvatarImage from '../../../assets/user-avatar.png';
import { fetchAudioWithRetry, getCachedAudio, cacheAudio } from '../../../utils/audioCache';
import './InteractivePanel.css';

const InteractivePanel = ({ question, onAudioPlayingChange, bookId, pageNumber, questionIndex, totalQuestions }) => {
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);

    // Voice chat hooks
    const pageVoiceChat = usePageVoiceChat();

    // Create callback function to forward transcription completion to main voice chat
    const handleTranscriptionComplete = (transcriptionMessage) => {
        console.log('[InteractivePanel] Forwarding transcription completion to main voice chat');
        // Simulate the transcription completion event for the main voice chat WebSocket
        if (pageVoiceChat.websocketRef && pageVoiceChat.websocketRef.current) {
            // Create a synthetic event that the main WebSocket can handle
            const syntheticEvent = {
                data: JSON.stringify(transcriptionMessage)
            };
            // Call the main WebSocket's message handler directly
            if (pageVoiceChat.handleWebSocketMessage) {
                pageVoiceChat.handleWebSocketMessage(syntheticEvent);
            }
        }
    };

    const transcriptionWS = useTranscriptionWebSocket(bookId, pageNumber, handleTranscriptionComplete);

    // Connect when panel opens with a question
    useEffect(() => {
        let mounted = true;

        if (question && bookId && pageNumber && mounted) {
            console.log('[InteractivePanel] Connecting voice chat for page:', pageNumber);

            // Clear previous transcriptions
            transcriptionWS.clearTranscriptions();

            // Connect both services
            if (question && question.id) {
                pageVoiceChat.connect(bookId, pageNumber, question.id);
            } else {
                console.warn('[InteractivePanel] Question missing ID, cannot connect voice chat');
            }
            transcriptionWS.connect();
        }

        // Cleanup connections when panel closes or page changes
        return () => {
            mounted = false;
            // Add a small delay to prevent race conditions
            setTimeout(() => {
                console.log('[InteractivePanel] Disconnecting voice chat');
                pageVoiceChat.disconnect();
                transcriptionWS.disconnect();
            }, 100);
        };
    }, [question?.id, question?.questionText, bookId, pageNumber]); // Include question ID for reconnection

    useEffect(() => {
        if (question && question.audioUrl) {
            playQuestionAudioAsync(question.audioUrl);
        }

        // Cleanup: reset audio state when content changes
        return () => {
            if (onAudioPlayingChange) {
                onAudioPlayingChange(false);
            }
            setIsAudioPlaying(false);
        };
    }, [question]);

    const updateAudioState = (playing) => {
        setIsAudioPlaying(playing);
        if (onAudioPlayingChange) {
            onAudioPlayingChange(playing);
        }
    };

    const canUseVoiceButton = () => {
        // Disable voice button if audio is playing or not connected
        return !isAudioPlaying && pageVoiceChat.isConnected;
    };

    const playQuestionAudioAsync = async (audioUrl) => {
        try {
            // Check cache first
            let audioBlob = await getCachedAudio(audioUrl);

            if (!audioBlob) {
                // Fetch from local/cloud
                audioBlob = await fetchAudioWithRetry(audioUrl);
                // Cache for future use
                await cacheAudio(audioUrl, audioBlob);
            }

            // Add 0.8 second delay before playing
            await new Promise(resolve => setTimeout(resolve, 500));

            // Notify parent and update local state that audio is starting
            updateAudioState(true);

            // Play audio
            const audioObjectUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioObjectUrl);

            audio.onended = () => {
                URL.revokeObjectURL(audioObjectUrl);
                // Notify parent and update local state that audio has ended
                updateAudioState(false);
            };
            audio.onerror = () => {
                URL.revokeObjectURL(audioObjectUrl);
                console.error('Audio playback failed');
                // Notify parent and update local state that audio has ended (due to error)
                updateAudioState(false);
            };

            await audio.play();

        } catch (error) {
            console.error('Failed to play question audio:', error);
            // Notify parent and update local state that audio has ended (due to error)
            updateAudioState(false);
            // Silently fail - don't break the UI
        }
    };

    // Combine messages from different sources
    const getCombinedMessages = () => {
        const combinedMessages = [];

        // Add AI response messages only (no user audio placeholders)
        pageVoiceChat.conversationMessages.forEach(msg => {
            if (!msg.isUser) { // Only add AI messages
                combinedMessages.push({
                    id: msg.id,
                    content: msg.content,
                    isUser: false,
                    timestamp: msg.timestamp,
                    type: 'ai-response'
                });
            }
        });

        // Add streaming AI response if currently speaking
        if (pageVoiceChat.isAiSpeaking && pageVoiceChat.currentStreamingTranscript) {
            combinedMessages.push({
                id: `streaming-${pageVoiceChat.streamingResponseId}`,
                content: pageVoiceChat.currentStreamingTranscript,
                isUser: false,
                timestamp: new Date(),
                type: 'ai-streaming'
            });
        }

        // Add user transcription messages with proper timestamps
        transcriptionWS.transcriptions.forEach((transcriptionObj, index) => {
            if (transcriptionObj.text && transcriptionObj.text.includes('[TRANSCRIPTION]')) {
                const cleanText = transcriptionObj.text.replace('[TRANSCRIPTION]', '').trim();
                if (cleanText) {
                    combinedMessages.push({
                        id: `transcription-${index}`,
                        content: cleanText,
                        isUser: true,
                        timestamp: transcriptionObj.timestamp,
                        type: 'user-transcription'
                    });
                }
            }
        });

        // Sort by timestamp
        return combinedMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    };

    const renderMessage = (message) => {
        const isUser = message.isUser;
        const avatarSrc = isUser ? userAvatarImage : avatarImage;
        const messageClass = isUser ? 'user-message' : 'ai-message';
        const bubbleClass = isUser ? 'user-text' : 'ai-text';

        return (
            <div key={message.id} className={`chat-message ${messageClass}`}>
                <div className="avatar-container">
                    <img
                        src={avatarSrc}
                        alt={isUser ? "User Avatar" : "AI Avatar"}
                        className="avatar-image"
                    />
                </div>
                <div className={`message-text ${bubbleClass}`}>
                    {message.content}
                </div>
            </div>
        );
    };

    return (
        <div className="interactive-panel">
            <div className="panel-header">
                <div className="d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">Chat</h5>
                    {totalQuestions > 1 && questionIndex !== undefined && (
                        <small className="text-muted">Question {questionIndex + 1} of {totalQuestions}</small>
                    )}
                </div>
                {pageVoiceChat.isLoading && <small className="text-muted">Connecting...</small>}
                {pageVoiceChat.error && <small className="text-danger">Error: {pageVoiceChat.error}</small>}
            </div>

            <div className="panel-content">
                {question && (
                    <div className="question-section">
                        <div className="chat-message ai-message">
                            <div className="avatar-container">
                                <img
                                    src={avatarImage}
                                    alt="AI Avatar"
                                    className="avatar-image"
                                />
                            </div>
                            <div className="message-text ai-text">
                                {question.questionText}
                            </div>
                        </div>
                    </div>
                )}

                <div className="chat-messages">
                    {getCombinedMessages().map(renderMessage)}
                </div>

                <div className="voice-controls">
                    <VoiceButton
                        disabled={!canUseVoiceButton()}
                        onAudioRecorded={(pcm16Data) => {
                            pageVoiceChat.sendAudioData(pcm16Data);
                        }}
                        onAudioChunk={(pcm16Data) => {
                            if (transcriptionWS.isConnected) {
                                transcriptionWS.sendAudioData(pcm16Data);
                            }
                        }}
                        onRecordingComplete={() => {
                            if (transcriptionWS.isConnected) {
                                setTimeout(() => {
                                    transcriptionWS.commitAudioBuffer();
                                }, 100);
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default InteractivePanel; 