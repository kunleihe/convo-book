import { useRef, useState, useEffect } from 'react';

export function useNarration(narrationAudioUrl) {
    const audioRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [ended, setEnded] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (!narrationAudioUrl) return;

        const audio = new Audio(narrationAudioUrl);
        audioRef.current = audio;
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        setEnded(false);

        const onMetadata = () => setDuration(audio.duration);
        const onTimeUpdate = () => setCurrentTime(audio.currentTime);
        const onEnded = () => { setIsPlaying(false); setEnded(true); };

        audio.addEventListener('loadedmetadata', onMetadata);
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('ended', onEnded);

        audio.play().then(() => setIsPlaying(true)).catch(() => {});

        return () => {
            audio.removeEventListener('loadedmetadata', onMetadata);
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('ended', onEnded);
            audio.pause();
            audio.src = '';
        };
    }, [narrationAudioUrl]);

    const play = () => { audioRef.current?.play(); setIsPlaying(true); setEnded(false); };
    const pause = () => { audioRef.current?.pause(); setIsPlaying(false); };
    const seek = (t) => { if (audioRef.current) audioRef.current.currentTime = t; };

    return { isPlaying, ended, currentTime, duration, play, pause, seek };
}
