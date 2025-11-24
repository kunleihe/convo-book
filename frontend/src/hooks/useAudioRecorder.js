import { useState, useRef, useCallback } from 'react';
import { detectSilence } from '../utils/silenceDetection';

export const useAudioRecorder = (onAudioRecorded, onAudioChunk = null, externalStream = null) => {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState('00:00');
    const [lastRecordingUrl, setLastRecordingUrl] = useState(null);
    const [audioFormat, setAudioFormat] = useState('-');

    const mediaRecorderRef = useRef(null);
    const audioStreamRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const recordingTimerRef = useRef(null);
    const recordingStartTimeRef = useRef(null);
    const audioContextRef = useRef(null);
    const scriptProcessorRef = useRef(null);
    const accumulatedPCM16DataRef = useRef([]);
    const isUsingExternalStreamRef = useRef(false);

    const updateRecordingTime = useCallback(() => {
        if (recordingStartTimeRef.current) {
            const elapsed = Date.now() - recordingStartTimeRef.current;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            setRecordingTime(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        }
    }, []);

    // Convert float32 audio to PCM16
    const floatToPCM16 = useCallback((float32Array) => {
        const pcm16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
            const sample = Math.max(-1, Math.min(1, float32Array[i]));
            pcm16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        return pcm16Array;
    }, []);

    // Convert WebM audio to PCM16 format (for complete recordings)
    const convertWebMToPCM16 = useCallback(async (audioBlob) => {
        try {
            console.log('Starting audio conversion - blob size:', audioBlob.size, 'bytes');

            if (audioBlob.size === 0) {
                console.error('Audio blob is empty');
                return null;
            }

            const arrayBuffer = await audioBlob.arrayBuffer();
            console.log('Array buffer size:', arrayBuffer.byteLength);

            // Create new AudioContext for processing
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });

            console.log('Decoding audio data...');
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            console.log('Audio decoded - duration:', audioBuffer.duration, 'seconds, channels:', audioBuffer.numberOfChannels);

            // Get channel data and convert to PCM16
            const channelData = audioBuffer.getChannelData(0);
            console.log('Channel data length:', channelData.length, 'samples');

            const pcm16Data = floatToPCM16(channelData);
            console.log('Converted to PCM16:', pcm16Data.length, 'samples');

            audioContext.close();
            return pcm16Data;
        } catch (error) {
            console.error('Error converting audio to PCM16:', error);
            return null;
        }
    }, [floatToPCM16]);

    const startRecording = useCallback(async () => {
        try {
            console.log('Starting recording...');
            let stream;

            if (externalStream) {
                console.log('[AudioRecorder] Using external stream');
                stream = externalStream;
                isUsingExternalStreamRef.current = true;
            } else {
                console.log('[AudioRecorder] Requesting new media stream');
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        sampleRate: 24000, // Optimal for OpenAI Realtime API
                        channelCount: 1 // Mono audio
                    }
                });
                isUsingExternalStreamRef.current = false;
            }

            audioStreamRef.current = stream;
            recordedChunksRef.current = [];
            accumulatedPCM16DataRef.current = [];

            // Initialize AudioContext for real-time PCM16 capture
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });

            // Set up Web Audio API for real-time audio processing
            const source = audioContextRef.current.createMediaStreamSource(stream);

            // Use ScriptProcessorNode for real-time audio processing
            const bufferSize = 4096; // Process in 4KB chunks
            scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);

            scriptProcessorRef.current.onaudioprocess = (event) => {
                if (onAudioChunk) {
                    const inputData = event.inputBuffer.getChannelData(0);
                    const pcm16Data = floatToPCM16(inputData);

                    console.log(`[AudioRecorder] Audio chunk processed: ${pcm16Data.length} samples`);

                    // Accumulate for complete recording
                    accumulatedPCM16DataRef.current.push(pcm16Data);

                    // Send chunk for real-time transcription
                    onAudioChunk(pcm16Data);
                }
            };

            // Connect the audio pipeline: source -> processor
            const gainNode = audioContextRef.current.createGain();
            gainNode.gain.value = 0; // Mute the audio to prevent feedback

            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(gainNode);
            gainNode.connect(audioContextRef.current.destination);

            // Determine supported audio format for recording
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
            }

            console.log('Using MIME type:', mimeType);
            setAudioFormat(`PCM16 24kHz (real-time capture)`);

            // Only start MediaRecorder if we are NOT sharing a stream, 
            // OR if we really want a local recording even when sharing.
            // But usually when sharing, the parent is already recording video.
            // To avoid "NotSupportedError" (concurrent recorders on same stream),
            // we can skip MediaRecorder here if externalStream is present.
            // However, the VoiceButton logic expects onAudioRecorded to be called with a Blob.
            
            // STRATEGY: Try to record audio-only if external stream is video+audio
            // This reduces conflict probability.
            let recorderStream = stream;
            if (externalStream) {
                 // If external stream has video, let's try to extract only audio track for this recorder
                 // This often helps with browser resource locking
                 const audioTracks = stream.getAudioTracks();
                 if (audioTracks.length > 0) {
                     recorderStream = new MediaStream(audioTracks);
                     console.log('[AudioRecorder] Extracted audio track for concurrent recording');
                 }
            }

            try {
                mediaRecorderRef.current = new MediaRecorder(recorderStream, { mimeType });
                
                mediaRecorderRef.current.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        console.log('Audio chunk recorded:', event.data.size, 'bytes');
                        recordedChunksRef.current.push(event.data);
                    }
                };

                mediaRecorderRef.current.onstop = async () => {
                    console.log('Recording stopped, processing', recordedChunksRef.current.length, 'chunks');

                    // Disconnect Web Audio API components
                    if (scriptProcessorRef.current) {
                        scriptProcessorRef.current.disconnect();
                        scriptProcessorRef.current = null;
                    }

                    // Prepare Blob
                    let finalBlob = null;
                    if (recordedChunksRef.current.length > 0) {
                        finalBlob = new Blob(recordedChunksRef.current, { type: mimeType });
                        console.log('Created blob:', finalBlob.size, 'bytes');
                        const url = URL.createObjectURL(finalBlob);
                        setLastRecordingUrl(url);
                    } else {
                        console.warn('No recorded chunks for Blob');
                    }

                    // Convert to PCM16 (using Blob if available, or fallback to accumulator)
                    let pcm16Data = null;
                    
                    if (finalBlob) {
                        console.log('Converting audio to PCM16 from Blob...');
                        pcm16Data = await convertWebMToPCM16(finalBlob);
                    } else if (accumulatedPCM16DataRef.current.length > 0) {
                        // Fallback to accumulated chunks if Blob creation failed
                        const totalLength = accumulatedPCM16DataRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
                        pcm16Data = new Int16Array(totalLength);
                        let offset = 0;
                        for (const chunk of accumulatedPCM16DataRef.current) {
                            pcm16Data.set(chunk, offset);
                            offset += chunk.length;
                        }
                        console.log('Using accumulated PCM16 data fallback:', pcm16Data.length, 'samples');
                    }

                    // Check silence and callback
                    if (onAudioRecorded) {
                        const isSilent = pcm16Data ? detectSilence(pcm16Data) : true;
                        
                        // Pass BOTH pcm16Data AND the Blob
                        onAudioRecorded(pcm16Data, { 
                            isSilent, 
                            blob: finalBlob,
                            mimeType: mimeType 
                        });
                    } else {
                        console.error('onAudioRecorded callback is not provided');
                    }

                    // Cleanup resources
                    if (audioStreamRef.current && !isUsingExternalStreamRef.current) {
                        console.log('[AudioRecorder] Stopping internal media stream tracks');
                        audioStreamRef.current.getTracks().forEach(track => track.stop());
                    }
                    if (audioContextRef.current) {
                        audioContextRef.current.close();
                    }
                };

                mediaRecorderRef.current.start(100);
            } catch (err) {
                console.error('[AudioRecorder] Failed to start MediaRecorder (likely concurrent limit). Falling back to script processor only.', err);
                // Even if MediaRecorder fails, we still have ScriptProcessor running for real-time audio!
                // We just won't have a final "Blob" at the end.
                // If stopRecording is called later, we need to handle the case where mediaRecorderRef.current is valid but didn't start, 
                // or invalid.
                // However, usually ScriptProcessor is enough for voice chat. 
                // But we need to simulate the "onstop" behavior manually if MediaRecorder failed?
                // For now, let's just let it fail gracefully and rely on accumulated PCM data if user stops.
            }

            setIsRecording(true);
            recordingStartTimeRef.current = Date.now();
            recordingTimerRef.current = setInterval(updateRecordingTime, 100);

            return true;
        } catch (error) {
            console.error('Error starting recording:', error);
            return false;
        }
    }, [updateRecordingTime, convertWebMToPCM16, onAudioRecorded, onAudioChunk, floatToPCM16, externalStream]);

    const stopRecording = useCallback(() => {
        console.log('Stopping recording...');

        // Stop MediaRecorder if it exists and is recording
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        } else {
            // If MediaRecorder failed to start (e.g. NotSupportedError), we still need to trigger the cleanup logic
            // that normally happens in onstop.
            // Since we can't trigger onstop manually on a broken recorder, we might need to manually
            // call the cleanup logic here if we are in "headless" mode.
            
            // However, most critical logic (PCM processing) happens in real-time via ScriptProcessor.
            // The main thing missing is the "onRecordingComplete" callback with the final Blob.
            // If MediaRecorder failed, we won't get a Blob.
            
            // Let's manually cleanup audio context stuff here to be safe
             if (scriptProcessorRef.current) {
                scriptProcessorRef.current.disconnect();
                scriptProcessorRef.current = null;
            }

            if (audioStreamRef.current && !isUsingExternalStreamRef.current) {
                console.log('[AudioRecorder] Stopping internal media stream tracks');
                audioStreamRef.current.getTracks().forEach(track => track.stop());
                audioStreamRef.current = null;
            }

            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            
            // Manually trigger callback with accumulated data if needed
            // But usually the VoiceButton relies on onAudioChunk for real-time stuff.
            // The onRecordingComplete is mostly for silence detection post-hoc.
            if (onAudioRecorded && accumulatedPCM16DataRef.current.length > 0) {
                 const totalLength = accumulatedPCM16DataRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
                 const pcm16Data = new Int16Array(totalLength);
                 let offset = 0;
                 for (const chunk of accumulatedPCM16DataRef.current) {
                     pcm16Data.set(chunk, offset);
                     offset += chunk.length;
                 }
                 
                 // Check silence
                 const isSilent = detectSilence(pcm16Data);
                 onAudioRecorded(pcm16Data, { isSilent, blob: null, mimeType: 'audio/webm' });
            }
        }

        setIsRecording(false);
        recordingStartTimeRef.current = null;

        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }

        setRecordingTime('00:00');
    }, [onAudioRecorded]);

    const playLastRecording = useCallback(() => {
        if (lastRecordingUrl) {
            const audio = new Audio(lastRecordingUrl);
            audio.play().catch(console.error);
        }
    }, [lastRecordingUrl]);

    return {
        isRecording,
        recordingTime,
        lastRecordingUrl,
        audioFormat,
        startRecording,
        stopRecording,
        playLastRecording,
    };
};
