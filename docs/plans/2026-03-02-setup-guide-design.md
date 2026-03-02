# Setup Guide Page — Design Doc

**Date:** 2026-03-02

## Goal

Add a Zoom setup checklist page that appears after every login and before the Device Check page, ensuring users properly configure Zoom before using the platform.

## User Flow

```
Login → /setup-guide → /device-check → / (BookLibrary)
```

## Requirements

- Shown every time after successful login (not a one-time thing)
- Two checkboxes, both must be checked to enable "Next"
- Each checkbox accompanied by a screenshot showing the relevant Zoom UI
- English language, consistent with existing Login and DeviceCheck pages
- Clicking "Next" navigates to `/device-check`

## Checklist Items

1. **Share screen** — "Click 'Share' in Zoom to share your screen."
   - Image: `frontend/src/assets/zoom-share.png` (Zoom toolbar with Share button highlighted)

2. **Mute and turn off video** — "Mute your audio and turn off your video in Zoom."
   - Image: `frontend/src/assets/zoom-audio-video.png` (Zoom toolbar with Audio + Video highlighted)

## Architecture

### New Files
- `frontend/src/components/Common/SetupGuide.jsx` — the guide page component
- `frontend/src/assets/zoom-share.png` — user-provided screenshot
- `frontend/src/assets/zoom-audio-video.png` — user-provided screenshot

### Modified Files
- `frontend/src/App.jsx` — add `/setup-guide` route (ProtectedRoute-wrapped)
- `frontend/src/components/Common/ProtectedRoute.jsx` — change `onLoginSuccess` to navigate to `/setup-guide` instead of `/device-check`

## Component Design

**SetupGuide.jsx** — Bootstrap Card, centered full-screen (matches Login/DeviceCheck style)

- Card Header: "Before You Start" (bg-primary, white text)
- Subtitle: "Please complete the following steps in Zoom before continuing."
- Two step cards, each containing:
  - Screenshot image (full width, rounded)
  - Checkbox + description text below the image
- "Next" button (disabled until both checkboxes are checked) → `navigate('/device-check')`

## No Backend Changes Required
