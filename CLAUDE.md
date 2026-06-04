# ReelMaker

Browser-based video knowledge visualization tool — record narrated presentations with storyboard overlays, webcam, and screen capture from a single web page.

## Stack
- **Runtime**: Node.js (raw `http` server, no framework)
- **Backend**: Single-file `server.js` — hand-rolled routing, multipart parser, CORS, Range requests
- **Frontend**: Vanilla HTML/CSS/JS single-file SPA (no build step), SweetAlert2 for dialogs
- **Storage**: CloudPipe SDK database (`../../sdk/database`) — SQLite-backed collections; assets/recordings on disk
- **External**: ReelScript API via CloudPipe gateway (`../../sdk/gateway`) for video transcription/analysis
- **Deployment**: CloudPipe (PM2)

## Directory structure

```
reelmaker/
  server.js              ← Entire backend: HTTP server, API routes, file serving, migration
  public/
    index.html           ← Main SPA (~5100 lines: recorder, editor, storyboards)
    admin.html           ← Admin/management UI (~1400 lines)
    record-3d.html       ← 3D recording variant (~380 lines)
    sfx/                 ← Sound effect mp3s (meme/transition sounds)
  data/
    reelmaker.db         ← SDK SQLite database
    assets/              ← Uploaded images/videos + storyboards (sb_*.png)
    recordings/          ← Saved video recordings (rec_*.webm)
  PLAN-reelscript-integration.md  ← Subtitle generator + benchmark-video feature plan
```

## Key concepts

- **SDK-backed collections**: `db.init({ project: 'reelmaker' })` then `db.collection(name)` for Topics, Ideas, Assets, Settings, Benchmarks. CRUD via `findAll`/`getById`/`create`/`update`/`remove`/`count`.
- **One-time JSON→DB migration**: On startup `migrateJsonToDb()` imports legacy `ideas.json`/`assets.json` into the DB, renames them `.bak`, seeds default Topics/folders/prompter text. `POST /api/migrate` imports a localStorage export (base64 storyboards → disk files).
- **PM2 cwd fix**: `process.chdir(__dirname)` so the SDK resolves paths correctly when PM2 runs from CloudPipe root.
- **Topics**: Each topic holds `markdown` (tree outline) + ordered `storyboards[]` (image/video overlay refs). Storyboard files live in `data/assets/` as `sb_*`; deleting a topic/storyboard unlinks its file.
- **Settings as KV**: Misc state (`folders`, `prompter_text`) stored as Settings docs keyed by `id`, exposed via `/api/settings`.
- **ReelScript integration** (requires gateway, optional — `gw` is null if unavailable):
  - `/api/transcribe` → `reelscript_process_video`; poll via `/api/transcribe/:id`.
  - **Benchmark flow**: `POST /api/benchmark` analyzes a foreign video URL; `/api/benchmark/:id` polls; `/api/benchmark/:id/generate` turns ReelScript appreciation (theme/keyPoints/goldenQuotes) into a Topic markdown tree + Chinese prompter script.
- **Recordings**: `POST /api/recordings` (multipart, 500MB cap) saves `rec_*.webm`; served from `/data/recordings/` with HTTP Range support for video seeking.
- **Multipart**: Custom `parseMultipart`/`bufferIndexOf` — no external upload library.
- **Clean URLs**: `/admin` resolves to `public/admin.html`; HTML served `no-cache`, assets cached 1 day.

## Commands

```bash
npm start        # node server.js  → http://localhost:4027 (PORT env overrides)
```

No build, test, or lint scripts. Open in a Chromium-based browser (needs MediaRecorder, getDisplayMedia, Canvas compositing).

## Coding rules

- Plain CommonJS (`require`), Node built-ins only — no npm dependencies in package.json.
- Path-traversal guards on all file-serving routes (reject `..`, `/`, `\`).
- Body size caps per route via `collectBody(req, maxSize)`.
- Validate/slice user input lengths (names ≤200, notes ≤5000); randomized safe filenames via `crypto.randomBytes`.
- Use `console.error` for errors; route handlers wrapped in try/catch returning JSON errors.
