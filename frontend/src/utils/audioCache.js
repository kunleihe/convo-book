class AudioCache {
    constructor() {
        this.cache = new Map();
        this.maxCacheSize = 50;
    }

    async get(url) {
        return this.cache.get(url);
    }

    async set(url, audioBlob) {
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(url, audioBlob);
    }
}

const audioCache = new AudioCache();

// Audio utilities
export const fetchAudioWithRetry = async (audioUrl, maxRetries = 2) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(audioUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.blob();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
    }
};

export const getCachedAudio = async (url) => audioCache.get(url);
export const cacheAudio = async (url, blob) => audioCache.set(url, blob); 