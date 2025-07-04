import React from 'react';
import VoiceButton from './VoiceButton/VoiceButton';
import avatarImage from '../../../assets/bot-avatar.png';
import './InteractivePanel.css';

const InteractivePanel = ({ question, messages }) => {
    return (
        <div className="interactive-panel">
            <div className="panel-header">
                <h5 className="mb-0">Chat</h5>
            </div>

            <div className="panel-content">
                {question && (
                    <div className="question-section">
                        <div className="chat-message">
                            <div className="avatar-container">
                                <img
                                    src={avatarImage}
                                    alt="Avatar"
                                    className="avatar-image"
                                />
                            </div>
                            <div className="question-text">
                                {question.text}
                            </div>
                        </div>
                    </div>
                )}

                <div className="chat-messages">
                    {messages.map((message, index) => (
                        <div key={index} className="message">
                            {message}
                        </div>
                    ))}
                </div>

                <div className="voice-controls">
                    <VoiceButton />
                </div>
            </div>
        </div>
    );
};

export default InteractivePanel; 