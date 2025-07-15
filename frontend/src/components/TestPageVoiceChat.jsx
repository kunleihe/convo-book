import React from 'react';
import { usePageVoiceChat } from '../hooks/usePageVoiceChat';

const TestPageVoiceChat = () => {
    const {
        isConnected,
        isLoading,
        error,
        conversationMessages,
        currentPrompt,
        connect,
        disconnect,
        sendAudioData,
        clearConversation
    } = usePageVoiceChat();

    const handleConnect = () => {
        console.log('Testing connect with book1, page 2...');
        connect('book1', 2);
    };

    const handleConnectPage6 = () => {
        console.log('Testing connect with book1, page 6...');
        connect('book1', 6);
    };

    const handleConnectPage9 = () => {
        console.log('Testing connect with book1, page 9...');
        connect('book1', 9);
    };

    const handleDisconnect = () => {
        console.log('Testing disconnect...');
        disconnect();
    };

    const handleClearConversation = () => {
        console.log('Testing clear conversation...');
        clearConversation();
    };

    const handleTestAudio = () => {
        if (!isConnected) {
            alert('Please connect first!');
            return;
        }

        // Create dummy PCM16 data (5 second of silence at 24kHz)
        const dummyPCM16 = new Int16Array(24000 * 5);
        console.log('Testing sendAudioData with dummy data...');
        const success = sendAudioData(dummyPCM16);
        console.log('sendAudioData result:', success);
    };

    return (
        <div style={{ padding: '20px', border: '1px solid #ccc', margin: '20px' }}>
            <h2>🧪 PageVoiceChat Hook Test</h2>

            {/* Connection Status */}
            <div style={{ marginBottom: '20px' }}>
                <h3>Connection Status:</h3>
                <p>
                    <strong>Connected:</strong> {isConnected ? '✅ Yes' : '❌ No'} |
                    <strong>Loading:</strong> {isLoading ? '⏳ Yes' : '✅ No'} |
                    <strong>Error:</strong> {error ? `❌ ${error}` : '✅ None'}
                </p>
            </div>

            {/* Control Buttons */}
            <div style={{ marginBottom: '20px' }}>
                <h3>Test Controls:</h3>
                <button
                    onClick={handleConnect}
                    disabled={isLoading}
                    style={{ marginRight: '10px', padding: '10px' }}
                >
                    Connect to Book1 Page 2
                </button>

                <button
                    onClick={handleConnectPage6}
                    disabled={isLoading}
                    style={{ marginRight: '10px', padding: '10px' }}
                >
                    Connect to Book1 Page 6
                </button>

                <button
                    onClick={handleConnectPage9}
                    disabled={isLoading}
                    style={{ marginRight: '10px', padding: '10px' }}
                >
                    Connect to Book1 Page 9
                </button>

                <button
                    onClick={handleDisconnect}
                    disabled={!isConnected}
                    style={{ marginRight: '10px', padding: '10px' }}
                >
                    Disconnect
                </button>

                <button
                    onClick={handleTestAudio}
                    disabled={!isConnected}
                    style={{ marginRight: '10px', padding: '10px' }}
                >
                    Test Send Audio
                </button>

                <button
                    onClick={handleClearConversation}
                    style={{ padding: '10px' }}
                >
                    Clear Conversation
                </button>
            </div>

            {/* Current Prompt Display */}
            {currentPrompt && (
                <div style={{ marginBottom: '20px' }}>
                    <h3>Current Prompt Info:</h3>
                    <div style={{ backgroundColor: '#f5f5f5', padding: '10px', borderRadius: '4px' }}>
                        <p><strong>Book ID:</strong> {currentPrompt.book_id}</p>
                        <p><strong>Page Number:</strong> {currentPrompt.page_number}</p>
                        <p><strong>Template ID:</strong> {currentPrompt.template_id}</p>
                        <details>
                            <summary><strong>Full Prompt (click to expand):</strong></summary>
                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px' }}>
                                {currentPrompt.prompt}
                            </pre>
                        </details>
                    </div>
                </div>
            )}

            {/* Conversation Messages */}
            <div style={{ marginBottom: '20px' }}>
                <h3>Conversation Messages ({conversationMessages.length}):</h3>
                <div style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid #ddd',
                    padding: '10px',
                    backgroundColor: '#f9f9f9'
                }}>
                    {conversationMessages.length === 0 ? (
                        <p style={{ color: '#666' }}>No messages yet...</p>
                    ) : (
                        conversationMessages.map((msg, index) => (
                            <div key={msg.id || index} style={{
                                marginBottom: '10px',
                                padding: '5px',
                                backgroundColor: msg.isUser ? '#e3f2fd' : '#f1f8e9',
                                borderRadius: '4px'
                            }}>
                                <strong>{msg.isUser ? '👤 User' : '🤖 AI'}:</strong> {msg.content}
                                <br />
                                <small style={{ color: '#666' }}>
                                    {new Date(msg.timestamp).toLocaleTimeString()}
                                </small>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Instructions */}
            <div style={{ fontSize: '12px', color: '#666' }}>
                <h4>Test Instructions:</h4>
                <ol>
                    <li>Open browser console to see detailed logs</li>
                    <li>Open Network tab to see HTTP requests and WebSocket connection</li>
                    <li>Try connecting to different pages (Page 2, 6, 9 have questions)</li>
                    <li>Check if prompt data loads correctly</li>
                    <li>Test disconnect and reconnect</li>
                    <li>Try "Test Send Audio" to verify WebSocket communication</li>
                </ol>
            </div>
        </div>
    );
};

export default TestPageVoiceChat; 