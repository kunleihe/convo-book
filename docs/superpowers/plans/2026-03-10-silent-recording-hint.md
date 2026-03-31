# Silent Recording Hint Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user records silence, skip submission and show a temporary "没有听到声音，请再试一次" hint near the record button for 3 seconds.

**Architecture:** Add a `silentHint` boolean state to `InteractivePanel`. On silent recording, reset transcription state and set the flag; a `setTimeout` clears it after 3 s. Render the hint text above `VoiceButton` inside `.voice-controls`.

**Tech Stack:** React 18, CSS animation (already used in the file)

---

## Files

| Action | File |
|--------|------|
| Modify | `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx` |
| Modify | `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.css` |

---

## Chunk 1: Logic change + UI hint

### Task 1: Add `silentHint` state and update `handleRecordingComplete`

**Files:**
- Modify: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx`

- [ ] **Step 1: Add `silentHint` state**

  In the state declarations block (around line 24), add:

  ```jsx
  const [silentHint, setSilentHint] = useState(false);
  ```

- [ ] **Step 2: Replace the silent branch in `handleRecordingComplete`**

  Current code (lines 112–114):
  ```jsx
  if (options.isSilent || !text) {
      httpChat.sendSilenceMessage();
  } else {
  ```

  Replace with:
  ```jsx
  if (options.isSilent || !text) {
      setCurrentUserTranscript('');
      transcriptionWS.clearAccumulatedTranscript();
      setSilentHint(true);
      setTimeout(() => setSilentHint(false), 3000);
  } else {
  ```

- [ ] **Step 3: Render the hint above `VoiceButton`**

  Inside the `<div className="voice-controls">` block, add the hint before `<VoiceButton ...>`:

  ```jsx
  {silentHint && (
      <p className="silent-hint">没有听到声音，请再试一次</p>
  )}
  ```

- [ ] **Step 4: Verify the file looks correct**

  Check that `handleRecordingComplete` no longer calls `sendSilenceMessage()` in the silent branch, and that `silentHint` state and JSX are present.

---

### Task 2: Add `.silent-hint` CSS

**Files:**
- Modify: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.css`

- [ ] **Step 1: Add the style**

  Append to the end of `InteractivePanel.css`:

  ```css
  .silent-hint {
      color: #e53e3e;
      font-size: 0.85rem;
      margin: 0 0 8px 0;
      animation: fadeIn 0.3s ease-in;
  }
  ```

  This reuses the existing `fadeIn` keyframe already defined in the file. The 3-second JS timeout handles removal — no separate fade-out CSS is needed.

---

### Task 3: Manual smoke test

- [ ] **Step 1: Start the dev server**

  ```bash
  cd frontend && npm run dev
  ```

- [ ] **Step 2: Open a book, navigate to a question page**

  Click "Start speaking", immediately click "Finish speaking" without saying anything.

  Expected: No message is submitted to the chat. A red hint "没有听到声音，请再试一次" appears above the button and disappears after ~3 seconds. The button re-enables and you can record again.

- [ ] **Step 3: Verify normal recording still works**

  Record a real answer. Expected: transcript is submitted normally, AI responds.

---

### Task 4: Commit

- [ ] **Step 1: Commit the changes**

  ```bash
  git add frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx \
          frontend/src/components/BookReader/InteractivePanel/InteractivePanel.css
  git commit -m "feat: skip silent submission and show retry hint in InteractivePanel"
  ```
