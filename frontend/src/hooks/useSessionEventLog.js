import { useRef, useCallback } from 'react';
import { apiRequest } from '../utils/api';

/**
 * Accumulates timestamped events for one page recording session and flushes
 * them to S3 via POST /api/events when the recording stops.
 *
 * Usage:
 *   const { logEvent, flushEvents } = useSessionEventLog();
 *
 *   logEvent('recording_start')                          // must be first — sets t0
 *   logEvent('ai_tts_start', { text, question_id })
 *   logEvent('ai_tts_end')
 *   logEvent('user_record_start', { question_id })
 *   logEvent('user_record_stop', { transcript, question_id })
 *   await flushEvents(username, bookId, pageNumber)      // POSTs and resets
 */
export const useSessionEventLog = () => {
    const t0Ref = useRef(null);
    const eventsRef = useRef([]);
    const recordingStartedAtRef = useRef(null);

    const logEvent = useCallback((type, data = {}) => {
        if (type === 'recording_start') {
            t0Ref.current = Date.now();
            recordingStartedAtRef.current = new Date().toISOString();
        }
        if (t0Ref.current === null) return;
        eventsRef.current.push({
            t: parseFloat(((Date.now() - t0Ref.current) / 1000).toFixed(3)),
            type,
            ...data,
        });
    }, []);

    const flushEvents = useCallback(async (username, bookId, pageNumber) => {
        if (!eventsRef.current.length) return;
        const payload = {
            username,
            book_id: bookId,
            page_number: pageNumber,
            recording_started_at: recordingStartedAtRef.current,
            events: [...eventsRef.current],
        };
        // Reset before the async call so the next page starts fresh immediately
        eventsRef.current = [];
        t0Ref.current = null;
        recordingStartedAtRef.current = null;
        try {
            await apiRequest('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (e) {
            console.error('[useSessionEventLog] Failed to flush events:', e);
        }
    }, []);

    return { logEvent, flushEvents };
};
