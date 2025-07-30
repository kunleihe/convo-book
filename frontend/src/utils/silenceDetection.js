/**
 * Detect if PCM16 audio data is silent
 * @param {Int16Array} pcm16Data - PCM16 audio data
 * @param {Object} options - Detection options
 * @param {number} options.threshold - Amplitude threshold (0-32767), default 500
 * @param {number} options.minDuration - Minimum silence duration in seconds, default 0.5
 * @param {number} options.sampleRate - Audio sample rate, default 24000
 * @returns {boolean} - True if audio is silent
 */
export const detectSilence = (pcm16Data, options = {}) => {
    const {
        threshold = 500,
        minDuration = 0.5,
        sampleRate = 24000
    } = options;

    if (!pcm16Data || pcm16Data.length === 0) {
        return true;
    }

    // Calculate RMS (Root Mean Square) of audio samples
    let sum = 0;
    for (let i = 0; i < pcm16Data.length; i++) {
        sum += pcm16Data[i] * pcm16Data[i];
    }
    const rms = Math.sqrt(sum / pcm16Data.length);

    // Calculate duration
    const duration = pcm16Data.length / sampleRate;

    // Consider it silence if RMS is below threshold for minimum duration
    const isSilent = rms < threshold && duration >= minDuration;

    console.log(`[SilenceDetection] RMS: ${rms.toFixed(0)}, Duration: ${duration.toFixed(2)}s, Silent: ${isSilent}`);

    return isSilent;
}; 