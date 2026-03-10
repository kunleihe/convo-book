# Silent Recording Hint Design

**Date**: 2026-03-10
**Status**: Approved

## Problem

When a user clicks record but says nothing, the silent audio is submitted as a silence message (`sendSilenceMessage()`). This prevents the user from retrying — they should instead be allowed to record again.

## Solution

When silence is detected on recording stop:
1. Do NOT submit (skip both `sendSilenceMessage()` and `submitTranscript()`)
2. Reset transcription state so the button re-enables
3. Show a temporary hint near the record button for 3 seconds

## Changes

**File**: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx`

- Add `silentHint` state (boolean, default `false`)
- In `handleRecordingComplete`, replace the silent branch:
  - Clear `currentUserTranscript`
  - Call `transcriptionWS.clearAccumulatedTranscript()`
  - Set `silentHint = true`, then clear after 3 seconds via `setTimeout`
- Render `{silentHint && <p className="silent-hint">没有听到声音，请再试一次</p>}` above the `VoiceButton` inside `voice-controls`

**File**: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.css`

- Add `.silent-hint` style: small red text, centered, with a 3s fade-out animation

## No Changes Needed

`VoiceButton`, `useAudioRecorder`, `useHTTPChat`, `silenceDetection.js` — all unchanged.
