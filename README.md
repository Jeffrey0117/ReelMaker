# ReelMaker

Browser-based video knowledge visualization tool. Record narrated video presentations with storyboard overlays, webcam, and screen capture — all from a single HTML page.

## Features

- **Background modes** — solid color, uploaded image, uploaded video, or import from URL (YouTube / IG Reel)
- **Storyboard overlays** — drag-and-drop images that appear over your video; reorder, resize, and position freely
- **Slideshow navigation** — fullscreen storyboard carousel with dot navigation, arrow keys, and zone-based click regions
- **Webcam & screen capture** — picture-in-picture webcam overlay or full screen recording
- **Recording** — MediaRecorder-based capture at 8 Mbps with storyboard compositing baked into the output
- **Editor** — built-in timeline with PPT-style preview: large slide display + horizontal thumbnail strip
- **URL video import** — paste a YouTube or IG Reel link to download and use as background video via ReelScript API

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML / CSS / JS (single-file SPA) |
| UI Dialogs | SweetAlert2 |
| Backend | Node.js HTTP server |
| Video Processing | ReelScript API integration |
| Deployment | CloudPipe |

## Quick Start

```bash
npm start
# or
node server.js
```

Open `http://localhost:4027` in a Chromium-based browser.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves the SPA |
| `POST` | `/api/transcribe` | Submit a video URL for processing |
| `GET` | `/api/transcribe/:id` | Poll video processing status |

## Project Structure

```
reelmaker/
  public/
    index.html    # Full application (HTML + CSS + JS)
  server.js       # HTTP server with API proxy
  package.json
```

## Browser Support

Requires a modern Chromium-based browser (Chrome, Edge, Arc) for MediaRecorder, `getDisplayMedia`, and Canvas compositing APIs.

## License

MIT
