import React, { useState, useEffect, useRef } from 'react';
import { Container, Card, Button, ProgressBar, Alert, Form, Row, Col } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';

const DeviceCheck = () => {
    const [cameraOk, setCameraOk] = useState(false);
    const [micOk, setMicOk] = useState(false);
    const [error, setError] = useState('');
    const [volume, setVolume] = useState(0);

    // Device selection state
    const [videoDevices, setVideoDevices] = useState([]);
    const [audioDevices, setAudioDevices] = useState([]);
    const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
    const [selectedAudioDevice, setSelectedAudioDevice] = useState('');

    const videoRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const streamRef = useRef(null);
    const animationRef = useRef(null);
    const navigate = useNavigate();

    const getDevices = async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();

            const videoInputs = devices.filter(device => device.kind === 'videoinput');
            const audioInputs = devices.filter(device => device.kind === 'audioinput');

            setVideoDevices(videoInputs);
            setAudioDevices(audioInputs);

            // Set defaults if not already set
            if (videoInputs.length > 0 && !selectedVideoDevice) {
                setSelectedVideoDevice(videoInputs[0].deviceId);
            }
            if (audioInputs.length > 0 && !selectedAudioDevice) {
                setSelectedAudioDevice(audioInputs[0].deviceId);
            }
        } catch (err) {
            console.error("Error enumerating devices:", err);
        }
    };

    const startStream = async (videoDeviceId, audioDeviceId) => {
        try {
            // Stop existing tracks
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }

            const constraints = {
                video: {
                    deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: {
                    deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined
                }
            };

            // Request stream with specific constraints
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            // Camera Setup
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setCameraOk(true);
            }

            // Microphone Setup - Visualizer
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioContextRef.current = audioContext;

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;

            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            // Volume Monitor Animation
            const updateVolume = () => {
                if (!analyserRef.current) return;

                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(dataArray);

                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                const normalized = Math.min(100, Math.round((average / 60) * 100));

                setVolume(normalized);
                setMicOk(true);

                animationRef.current = requestAnimationFrame(updateVolume);
            };

            updateVolume();
            setError(''); // Clear any previous errors on success

        } catch (err) {
            console.error("Stream start failed:", err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setError('Permission denied. Please allow access to camera and microphone.');
            } else {
                setError('Could not access selected device. Please try another.');
            }
            setCameraOk(false);
            setMicOk(false);
        }
    };

    // Initial setup
    useEffect(() => {
        // First get permission with default devices to unlock labels
        const init = async () => {
            try {
                // Just request access first to unlock device labels
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

                // Once we have permission, get device list
                await getDevices();

                // Then start the stream properly with our management logic
                // We pass undefined initially to let browser pick defaults, 
                // or if getDevices found something, use that.
                // Ideally getDevices updates state, but state updates are async.
                // So we can just use the stream we already got for the first render
                // OR just call startStream with defaults.
                // Let's stick to using startStream to keep logic unified.

                // Stop the temp stream first
                stream.getTracks().forEach(track => track.stop());

                // Now start proper stream (will use defaults if state not updated yet, 
                // but we triggered getDevices which will trigger re-render eventually? 
                // No, we need to call startStream explicitly).

                // Actually, better flow:
                // 1. getUserMedia (permission) -> 2. getDevices (fill lists) -> 3. Set state -> 4. useEffect on state change triggers startStream?
                // Let's keep it simple: manual call after getDevices.

                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoInputs = devices.filter(d => d.kind === 'videoinput');
                const audioInputs = devices.filter(d => d.kind === 'audioinput');

                const initialVideoId = videoInputs[0]?.deviceId;
                const initialAudioId = audioInputs[0]?.deviceId;

                // Update state so dropdowns are correct
                setSelectedVideoDevice(initialVideoId);
                setSelectedAudioDevice(initialAudioId);

                // Start stream
                await startStream(initialVideoId, initialAudioId);

            } catch (err) {
                console.error("Init failed:", err);
                setError('Please allow camera and microphone access to continue.');
            }
        };

        init();

        // Cleanup
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, []);

    const handleDeviceChange = async (type, deviceId) => {
        if (type === 'video') {
            setSelectedVideoDevice(deviceId);
            await startStream(deviceId, selectedAudioDevice);
        } else {
            setSelectedAudioDevice(deviceId);
            await startStream(selectedVideoDevice, deviceId);
        }
    };

    return (
        <Container className="d-flex align-items-center justify-content-center min-vh-100">
            <Card className="shadow-lg" style={{ width: '100%', maxWidth: '600px' }}>
                <Card.Header className="bg-primary text-white text-center">
                    <h4 className="mb-0">Device Check</h4>
                </Card.Header>
                <Card.Body className="p-4">
                    <p className="text-center text-muted mb-4">
                        Please verify your camera and microphone are working properly.
                    </p>

                    {error && <Alert variant="danger">{error}</Alert>}

                    {/* Camera Section */}
                    <div className="mb-4">
                        <div className="mb-2">
                            <Form.Group>
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                    <Form.Label className="fw-bold small mb-0">Camera</Form.Label>
                                    <small className="text-muted" style={{ fontSize: '0.8rem' }}>Please select your preferred camera</small>
                                </div>
                                <Form.Select
                                    value={selectedVideoDevice}
                                    onChange={(e) => handleDeviceChange('video', e.target.value)}
                                    disabled={videoDevices.length === 0}
                                >
                                    {videoDevices.map(device => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                                        </option>
                                    ))}
                                </Form.Select>
                            </Form.Group>
                        </div>

                        {/* Camera Preview */}
                        <div className="position-relative bg-dark rounded overflow-hidden" style={{ height: '300px' }}>
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} // Mirror effect
                            />
                            {!cameraOk && !error && (
                                <div className="position-absolute top-50 start-50 translate-middle text-white">
                                    <div className="spinner-border mb-2" role="status"></div>
                                    <div>Initializing Camera...</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Microphone Section */}
                    <div className="mb-4">
                        <div className="mb-3">
                            <Form.Group>
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                    <Form.Label className="fw-bold small mb-0">Microphone</Form.Label>
                                    <small className="text-muted" style={{ fontSize: '0.8rem' }}>Please select your preferred microphone</small>
                                </div>
                                <Form.Select
                                    value={selectedAudioDevice}
                                    onChange={(e) => handleDeviceChange('audio', e.target.value)}
                                    disabled={audioDevices.length === 0}
                                >
                                    {audioDevices.map(device => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                                        </option>
                                    ))}
                                </Form.Select>
                            </Form.Group>
                        </div>

                        {/* Microphone Level */}
                        <div>
                            <div className="d-flex justify-content-between mb-1">
                                <span className="text-muted small">Microphone Level</span>
                                <span className="text-muted small">{volume > 0 ? 'Detecting Audio' : 'Silent'}</span>
                            </div>
                            <ProgressBar
                                now={volume}
                                variant={volume > 10 ? "success" : "info"}
                                style={{ height: '15px' }}
                                animated={volume > 5}
                            />
                        </div>
                    </div>

                    <div className="d-grid">
                        <Button
                            variant="primary"
                            size="lg"
                            disabled={!cameraOk || !micOk}
                            onClick={() => navigate('/')}
                        >
                            Start Reading
                        </Button>
                    </div>
                </Card.Body>
            </Card>
        </Container>
    );
};

export default DeviceCheck;
