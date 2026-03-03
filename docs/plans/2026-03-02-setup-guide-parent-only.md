# Setup Guide — Parent-Only Branch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the `/setup-guide` page (already on `main`) to the `parent-only` branch.

**Architecture:** The `main` branch has a complete `SetupGuide` component that shows a Zoom checklist with screenshots before the user proceeds to device-check. The `parent-only` branch is missing three things: the two image assets, the component file, and the route/redirect wiring. All changes are frontend-only; no backend changes needed.

**Tech Stack:** React 18, React Router, React-Bootstrap, Vite

---

### Task 1: Switch to the parent-only branch

**Files:**
- No file changes — branch switch only

**Step 1: Switch branch**

```bash
git checkout parent-only
```

Expected: `Switched to branch 'parent-only'`

**Step 2: Verify you are on the right branch**

```bash
git branch --show-current
```

Expected output: `parent-only`

---

### Task 2: Copy image assets from main

**Files:**
- Create: `frontend/src/assets/zoom-share.png`
- Create: `frontend/src/assets/zoom-audio-video.png`

**Step 1: Copy binary assets from main using git checkout**

```bash
git checkout main -- frontend/src/assets/zoom-share.png frontend/src/assets/zoom-audio-video.png
```

Expected: No output (success), files appear in working tree.

**Step 2: Verify files exist**

```bash
ls frontend/src/assets/zoom-share.png frontend/src/assets/zoom-audio-video.png
```

Expected: both paths printed without error.

**Step 3: Commit**

```bash
git add frontend/src/assets/zoom-share.png frontend/src/assets/zoom-audio-video.png
git commit -m "feat: add zoom setup guide screenshots"
```

---

### Task 3: Create SetupGuide component

**Files:**
- Create: `frontend/src/components/Common/SetupGuide.jsx`

**Step 1: Create the file**

Create `frontend/src/components/Common/SetupGuide.jsx` with this exact content:

```jsx
import React, { useState } from 'react';
import { Container, Card, Form, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import zoomShare from '../../assets/zoom-share.png';
import zoomAudioVideo from '../../assets/zoom-audio-video.png';

const STEPS = [
  {
    id: 'share-screen',
    image: zoomShare,
    alt: 'Zoom toolbar with Share button highlighted',
    label: 'Click "Share" in Zoom to share your screen.',
  },
  {
    id: 'mute-av',
    image: zoomAudioVideo,
    alt: 'Zoom toolbar with Audio and Video buttons highlighted',
    label: 'Mute your audio and turn off your video in Zoom.',
  },
];

const SetupGuide = () => {
  const [checked, setChecked] = useState(() => STEPS.map(() => false));
  const navigate = useNavigate();

  const toggle = (index) => {
    setChecked((prev) => prev.map((val, i) => (i === index ? !val : val)));
  };

  const allChecked = checked.every(Boolean);

  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Card className="shadow-lg" style={{ width: '100%', maxWidth: '900px' }}>
        <Card.Header className="bg-primary text-white text-center">
          <h4 className="mb-0">Before You Start</h4>
        </Card.Header>
        <Card.Body className="p-4">
          <p className="text-center text-muted mb-4">
            Please complete the following steps in Zoom before continuing.
          </p>

          {STEPS.map((step, index) => (
            <div key={step.id} className="mb-4 border rounded p-3">
              <img
                src={step.image}
                alt={step.alt}
                className="rounded mb-3"
                style={{
                  width: '100%',
                  height: '160px',
                  objectFit: 'contain',
                  backgroundColor: '#1c1c1c',
                }}
              />
              <Form.Check
                type="checkbox"
                id={`step-${step.id}`}
                label={step.label}
                checked={checked[index]}
                onChange={() => toggle(index)}
              />
            </div>
          ))}

          <div className="d-grid mt-2">
            <Button
              variant="primary"
              size="lg"
              disabled={!allChecked}
              onClick={() => navigate('/device-check')}
            >
              Next
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default SetupGuide;
```

**Step 2: Commit**

```bash
git add frontend/src/components/Common/SetupGuide.jsx
git commit -m "feat: add SetupGuide component with Zoom checklist"
```

---

### Task 4: Register /setup-guide route in App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

The current `parent-only` `App.jsx` imports `VoiceClient` and `DeviceCheck` but not `SetupGuide`. The `/setup-guide` route must be added between `/device-check` and `/book/:bookId/page/:pageNumber`.

**Step 1: Add the import**

In `frontend/src/App.jsx`, find this line:

```js
import DeviceCheck from './components/Common/DeviceCheck';
```

Add the SetupGuide import immediately after it:

```js
import SetupGuide from './components/Common/SetupGuide';
```

**Step 2: Add the route**

Find the existing `/device-check` route block:

```jsx
<Route
  path="/device-check"
  element={
    <ProtectedRoute>
      <DeviceCheck />
    </ProtectedRoute>
  }
/>
```

Add the `/setup-guide` route immediately **before** it:

```jsx
<Route
  path="/setup-guide"
  element={
    <ProtectedRoute>
      <SetupGuide />
    </ProtectedRoute>
  }
/>
```

**Step 3: Verify the routes section looks like this (order matters for clarity)**

```jsx
<Route path="/" element={<ProtectedRoute><BookLibrary /></ProtectedRoute>} />
<Route path="/setup-guide" element={<ProtectedRoute><SetupGuide /></ProtectedRoute>} />
<Route path="/device-check" element={<ProtectedRoute><DeviceCheck /></ProtectedRoute>} />
<Route path="/book/:bookId/page/:pageNumber" element={<ProtectedRoute><BookReader /></ProtectedRoute>} />
<Route path="/voice" element={<ProtectedRoute><VoiceClient /></ProtectedRoute>} />
<Route path="*" element={<Navigate to="/" replace />} />
```

**Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: register /setup-guide route"
```

---

### Task 5: Redirect to /setup-guide after login

**Files:**
- Modify: `frontend/src/components/Common/ProtectedRoute.jsx`

**Step 1: Update the redirect target**

In `frontend/src/components/Common/ProtectedRoute.jsx`, find:

```js
// Redirect to device check after successful login
return <Login onLoginSuccess={() => navigate('/device-check')} />;
```

Replace with:

```js
// Redirect to setup guide after successful login
return <Login onLoginSuccess={() => navigate('/setup-guide')} />;
```

**Step 2: Commit**

```bash
git add frontend/src/components/Common/ProtectedRoute.jsx
git commit -m "feat: redirect to /setup-guide after login"
```

---

### Task 6: Smoke-test the flow

**Step 1: Start the dev server**

```bash
cd frontend && npm run dev
```

**Step 2: Manual verification checklist**

- [ ] Navigate to `http://localhost:5173` — redirected to login
- [ ] Log in — redirected to `/setup-guide`
- [ ] Setup guide shows two Zoom screenshots with checkboxes
- [ ] "Next" button is disabled until both checkboxes are checked
- [ ] Check both boxes → "Next" becomes enabled → click it → lands on `/device-check`
- [ ] No console errors

**Step 3: Stop the dev server** (`Ctrl+C`)

---

### Task 7: Push to remote

**Step 1: Push the branch**

```bash
git push origin parent-only
```
