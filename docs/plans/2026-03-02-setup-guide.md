# Setup Guide Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Zoom setup checklist page shown after every login, before Device Check, with two checkboxes and screenshots guiding the user.

**Architecture:** New route `/setup-guide` inserted between Login and `/device-check`. A new `SetupGuide.jsx` component renders a Bootstrap Card with two image+checkbox items; both must be checked to enable the "Next" button. `ProtectedRoute.jsx` is updated to redirect to `/setup-guide` on login success instead of `/device-check`.

**Tech Stack:** React 18, React Router DOM, React Bootstrap

---

### Task 1: Save image assets

**Files:**
- Create: `frontend/src/assets/zoom-share.png`
- Create: `frontend/src/assets/zoom-audio-video.png`

**Step 1: Save the two screenshots**

The user has provided two Zoom toolbar screenshots in the conversation. Save them manually:

1. Right-click (or export) the **Share** screenshot → save as `frontend/src/assets/zoom-share.png`
2. Right-click (or export) the **Audio + Video** screenshot → save as `frontend/src/assets/zoom-audio-video.png`

**Step 2: Verify the files exist**

Run:
```bash
ls frontend/src/assets/zoom-share.png frontend/src/assets/zoom-audio-video.png
```
Expected:
```
frontend/src/assets/zoom-share.png
frontend/src/assets/zoom-audio-video.png
```

**Step 3: Commit**

```bash
git add frontend/src/assets/zoom-share.png frontend/src/assets/zoom-audio-video.png
git commit -m "feat: add zoom setup guide screenshots"
```

---

### Task 2: Create SetupGuide.jsx

**Files:**
- Create: `frontend/src/components/Common/SetupGuide.jsx`

**Step 1: Create the component**

Create `frontend/src/components/Common/SetupGuide.jsx` with the following content:

```jsx
import React, { useState } from 'react';
import { Container, Card, Form, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import zoomShare from '../../assets/zoom-share.png';
import zoomAudioVideo from '../../assets/zoom-audio-video.png';

const STEPS = [
  {
    image: zoomShare,
    alt: 'Zoom toolbar with Share button highlighted',
    label: 'Click "Share" in Zoom to share your screen.',
  },
  {
    image: zoomAudioVideo,
    alt: 'Zoom toolbar with Audio and Video buttons highlighted',
    label: 'Mute your audio and turn off your video in Zoom.',
  },
];

const SetupGuide = () => {
  const [checked, setChecked] = useState([false, false]);
  const navigate = useNavigate();

  const toggle = (index) => {
    setChecked((prev) => prev.map((val, i) => (i === index ? !val : val)));
  };

  const allChecked = checked.every(Boolean);

  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Card className="shadow-lg" style={{ width: '100%', maxWidth: '600px' }}>
        <Card.Header className="bg-primary text-white text-center">
          <h4 className="mb-0">Before You Start</h4>
        </Card.Header>
        <Card.Body className="p-4">
          <p className="text-center text-muted mb-4">
            Please complete the following steps in Zoom before continuing.
          </p>

          {STEPS.map((step, index) => (
            <div key={index} className="mb-4 border rounded p-3">
              <img
                src={step.image}
                alt={step.alt}
                className="img-fluid rounded mb-3"
                style={{ width: '100%' }}
              />
              <Form.Check
                type="checkbox"
                id={`step-${index}`}
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

**Step 2: Verify the file was created**

Run:
```bash
ls frontend/src/components/Common/SetupGuide.jsx
```
Expected:
```
frontend/src/components/Common/SetupGuide.jsx
```

**Step 3: Commit**

```bash
git add frontend/src/components/Common/SetupGuide.jsx
git commit -m "feat: add SetupGuide component with Zoom checklist"
```

---

### Task 3: Register /setup-guide route in App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

**Step 1: Add the import and route**

In `frontend/src/App.jsx`:

1. Add import after the `DeviceCheck` import (line 6):
```jsx
import SetupGuide from './components/Common/SetupGuide';
```

2. Add the new route after the `/device-check` route (after line 57):
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

**Step 2: Verify the file looks correct**

The routes section in App.jsx should now read:
```jsx
<Route path="/" element={<ProtectedRoute><BookLibrary /></ProtectedRoute>} />
<Route path="/device-check" element={<ProtectedRoute><DeviceCheck /></ProtectedRoute>} />
<Route path="/setup-guide" element={<ProtectedRoute><SetupGuide /></ProtectedRoute>} />
<Route path="/book/:bookId/page/:pageNumber" element={<ProtectedRoute><BookReader /></ProtectedRoute>} />
<Route path="*" element={<Navigate to="/" replace />} />
```

**Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: register /setup-guide route"
```

---

### Task 4: Update ProtectedRoute to redirect to /setup-guide after login

**Files:**
- Modify: `frontend/src/components/Common/ProtectedRoute.jsx:22`

**Step 1: Change the redirect target**

In `frontend/src/components/Common/ProtectedRoute.jsx`, line 22, change:
```jsx
return <Login onLoginSuccess={() => navigate('/device-check')} />;
```
to:
```jsx
return <Login onLoginSuccess={() => navigate('/setup-guide')} />;
```

**Step 2: Commit**

```bash
git add frontend/src/components/Common/ProtectedRoute.jsx
git commit -m "feat: redirect to /setup-guide after login"
```

---

### Task 5: Manual end-to-end verification

**Step 1: Start the dev server**

```bash
cd frontend && npm run dev
```

Open http://localhost:5173 in a browser.

**Step 2: Verify the full login flow**

1. Open the app — you should see the Login page (not authenticated)
2. Log in with valid credentials
3. You should land on `/setup-guide` — "Before You Start" page with two items, both unchecked
4. The "Next" button should be **disabled** (greyed out)
5. Check only one box — "Next" should still be disabled
6. Check both boxes — "Next" should become **enabled**
7. Click "Next" — you should navigate to `/device-check`
8. Complete device check — you should navigate to `/` (BookLibrary)

**Step 3: Verify screenshots display correctly**

Both Zoom screenshots should be visible and full-width inside their respective cards.

**Step 4: Run lint**

```bash
cd frontend && npm run lint
```

Expected: no errors.

**Step 5: Final commit if any lint fixes were needed**

```bash
git add -p
git commit -m "fix: lint issues in setup guide"
```
