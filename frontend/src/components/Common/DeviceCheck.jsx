import React, { useState, useEffect, useRef } from 'react';
import { Container, Card, Button, ProgressBar, Alert, Form } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';

const DeviceCheck = () => {
    const [micOk, setMicOk] = useState(false);
    const [error, setError] = useState('');
    const [volume, setVolume] = useState(0);

    const [audioDevices, setAudioDevices] = useState([]);
    const [selectedAudioDevice, setSelectedAudioDevice] = useState('');

    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const streamRef = useRef(null);
    const animationRef = useRef(null);
    const navigate = useNavigate();

    const startStream = async (audioDeviceId) => {
        try {
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
                audio: {
                    deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;

            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioContextRef.current = audioContext;

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;

            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

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
            setError('');

        } catch (err) {
            console.error("Stream start failed:", err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setError('Permission denied. Please allow access to microphone.');
            } else {
                setError('Could not access selected device. Please try another.');
            }
            setMicOk(false);
        }
    };

    useEffect(() => {
        const init = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());

                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                setAudioDevices(audioInputs);

                const initialAudioId = audioInputs[0]?.deviceId;
                setSelectedAudioDevice(initialAudioId);

                await startStream(initialAudioId);

            } catch (err) {
                console.error("Init failed:", err);
                setError('Please allow microphone access to continue.');
            }
        };

        init();

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

    const handleDeviceChange = async (deviceId) => {
        setSelectedAudioDevice(deviceId);
        await startStream(deviceId);
    };

    return (
        <Container className="d-flex align-items-center justify-content-center min-vh-100">
            <Card className="shadow-lg" style={{ width: '100%', maxWidth: '600px' }}>
                <Card.Header className="bg-primary text-white text-center">
                    <h4 className="mb-0">Device Check</h4>
                </Card.Header>
                <Card.Body className="p-4">
                    <p className="text-center text-muted mb-4">
                        Please verify your microphone is working properly.
                    </p>

                    {error && <Alert variant="danger">{error}</Alert>}

                    <div className="mb-4">
                        <div className="mb-3">
                            <Form.Group>
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                    <Form.Label className="fw-bold small mb-0">Microphone</Form.Label>
                                    <small className="text-muted" style={{ fontSize: '0.8rem' }}>Please select your preferred microphone</small>
                                </div>
                                <Form.Select
                                    value={selectedAudioDevice}
                                    onChange={(e) => handleDeviceChange(e.target.value)}
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
                            disabled={!micOk}
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
