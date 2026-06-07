# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

**Development & Testing**
- `npm run dev` — Start Next.js dev server on http://localhost:3000
- `npm run build` — Build for production
- `npm run test` — Run vitest (once)
- `npm run test:watch` — Run vitest in watch mode
- `npm test -- src/lib/media-rules.test.ts` — Run a single test file
- `npm run test:e2e` — Run Playwright e2e tests
- `npm run lint` — Run ESLint
- `npm run check` — TypeScript + lint + tests (full CI check)

## Architecture Overview

**Qlipo** is a Next.js video composition web app that allows users to upload media (images, videos, audio), arrange them on a visual timeline, apply effects, add text overlays & watermarks, then render the final video. It has two render modes: FFmpeg-based (real) and simulation (fallback).

### Data Flow

1. **Upload Phase** (`/api/uploads`)
   - User uploads files (form data)
   - Files stored in temp directory (`os.tmpdir()/qlipo/uploads/{sessionId}`)
   - Server paths sent back to client
   - Client validates via `/api/uploads/validar` before ingestion

2. **Editing Phase** (client state)
   - All timeline state lives in `useEditorStore` (Zustand)
   - Two edit modes:
     - **Auto mode**: clips ordered by position, cursor auto-advances based on duration & fade overlaps; user can't set explicit `startAt`
     - **Manual mode**: user drags clips to explicit times; requires `startAt` on each item
   - User can toggle between modes; switching strips/adds `startAt` as needed

3. **Composition to Segments**
   - `summarizeComposition()` converts the timeline (media + visuals + audios) into two segment arrays: `VisualSegment[]` and `AudioSegment[]`
   - Segments represent the actual playback layout, handling:
     - Auto vs manual positioning
     - Duration fallback (video → actual duration; image → user-set duration)
     - Fade clamping (can't exceed half clip duration)
     - Crossfade overlap (in auto mode, clips overlap by `fadeOutSeconds` for smooth transitions)
     - Audio looping (audio tracks loop to fill the full video duration)
   - If `musicalEvents` provided, auto mode maps one clip per musical section
   - If `beats` + `bpm` provided, beat-synced layout (clips snap to beat boundaries)

4. **Render Job Submission** (`POST /api/renders`)
   - Client sends full `RenderRequest` with:
     - Media array + visual/audio timeline items
     - Preset (aspect ratio), output options, overlays, watermarks
   - Server chooses:
     - **FFmpeg path** if media has `serverPath` (real files)
     - **Simulation path** otherwise (fallback for testing)
   - Job created with unique UUID, stored in in-memory `job-store`
   - Async render starts immediately (does not block response)

5. **Rendering** (`src/server/render-ffmpeg.ts` or `render-simulator.ts`)
   - **FFmpeg path** (`createFfmpegRenderJob`):
     - Computes all filter chains (video, audio, text, watermarks)
     - Handles gap detection (manual mode with gaps → fill with black)
     - Applies xfade transitions (if defined), fades, color grading (brightness/contrast/saturation/blur), Ken Burns zoom on images
     - Audio: trims, gains, fades, delays, resamples, mixes
     - Output to temp file with specified codec/quality/fps
     - Streams progress updates via `saveJob()` (subscribers notified)
   - **Simulation path** (`createRenderJob`):
     - Fake job that ticks through stages over ~3.5 seconds
     - Always returns JSON manifest (no actual video output)
   - Both save to same in-memory job store

6. **Job Polling & Download**
   - `/api/renders/{jobId}` (GET) — fetch current job state
   - `/api/renders/{jobId}/stream` (GET) — SSE stream (updates until finished)
   - `/api/renders/{jobId}/download` (GET) — serves MP4 or JSON manifest
   - Pages `processando/[jobId]` and `resultado/[jobId]` display live status

### Key Types

**Timeline Items** (user-facing)
- `VisualTimelineItem` — one clip on the timeline (image or video)
- `AudioTimelineItem` — one audio track

**Segments** (computed for rendering)
- `VisualSegment` — positioned video/image with effects (brightness, contrast, saturation, blur, opacity, speed)
- `AudioSegment` — positioned audio with trim, gain, fades, delay

**Media** (uploaded files)
- `MediaItem` — file metadata (duration, size, kind, preview URL, server path if uploaded)
- Validation: per-file + total project size limits

**Composition Summary**
- `CompositionSummary` — computed layout (visual segments, audio segments, total duration, normalized audio gain)
- Computed once per render request; sent to both simulator and FFmpeg

**Render Request/Job**
- `RenderRequest` — full spec for rendering (everything the user edited)
- `RenderJob` — live status of a render (stage, progress %, message, final download URL)

### State Management (Zustand)

`useEditorStore` is the single source of truth for the editor UI. Key actions:
- **Media lifecycle**: `ingestFiles()`, `removeMedia()`
- **Timeline editing**: `moveVisual()`, `updateVisualDuration()`, `setVisualPosition()`, `updateVisualProp()`, etc.
- **Mode switching**: `setEditMode("auto" | "manual")`
- **Overlays**: `addTextOverlay()`, `addWatermark()`, with update/remove variants
- **Output options**: `setOutputOptions()` (codec, quality, fps, audio bitrate)
- **Processing**: `setProcessingState()` (job ID, progress, download URL)

### Video Rendering (FFmpeg)

**Filter Graph Complexity**
- `renderVideo()` builds a single complex filter chain (`;`-separated filters, `[]`-labeled intermediate outputs)
- **Visual pipeline** per clip:
  1. Input (file or looped image)
  2. Trim to segment duration
  3. Scale to output dimensions (with Ken Burns zoom for images; black padding for videos)
  4. Apply color grading (eq, hue, gblur, colorchannelmixer)
  5. Apply per-clip fades (unless xfade handles it)
  6. Output label (e.g., `[v0]`)
- **Xfade transitions**: if a clip has `transitionType`, the transition overlaps the next clip (no individual fades on edges)
- **Gap handling**: if manual mode has gaps > 0.05s, insert black color frames
- **Text overlays**: chained after final video (drawtext with fade expressions)
- **Watermarks**: chained after text (overlay with fade expressions)
- **Audio pipeline**: per track trims, gains (volume), fades, delays, then amix or pass-through
- **Output**: map `[vout]` (video) + `[aout]` (audio), apply codec/quality, mux

**Ken Burns Effect**
- Applied to all images (deterministic zoom/pan based on `mediaId` hash)
- 4 variants: zoom-in center, drift right, zoom-out center, drift left
- Consistent across preview (preview-player.tsx) and render

**Codec Configuration**
- H.264 (mp4): max compatibility, CRF 14–28
- H.265 (mp4): 50% smaller, CRF 18–32
- VP9 (webm): open source, CRF 18–36
- Audio: AAC (H.264/H.265) or Opus (VP9)

### Job Store (In-Memory)

`src/server/job-store.ts` is a simple registry:
- `saveJob()` / `getJob()` — CRUD on job state
- `subscribeJob()` — listener pattern (SSE stream pulls updates)
- `saveJobOutputPath()` / `getJobOutputPath()` — store FFmpeg output file path

**Caveat**: jobs and output paths are RAM-resident. Server restart = lost jobs. No persistence layer.

### Validation

- **Media files**: format (extension check), file size (500 MB), total project size (2 GB)
- **Watermarks**: PNG/JPG/WebP only, max 5 MB
- **UI constraints**: fade max = 50% of clip duration
- All validation happens client-side (pre-upload) + server-side (at ingest + render time)

### Edit Mode Switching Logic

- **Auto → Manual**: positions are derived from the first occurrence of each mediaId in the rendered composition (avoids loop-extended repeats)
- **Manual → Auto**: strips all `startAt` values; clips revert to order-based auto-advance
- Switching is instant; no re-render of segments (done on next render request)

## File Organization

**Core Rendering**
- `src/server/render-ffmpeg.ts` — FFmpeg job runner + filter chain builder
- `src/server/render-simulator.ts` — fake async render (for testing)
- `src/server/job-store.ts` — in-memory job registry + listeners

**Timeline & Composition Logic**
- `src/store/editor-store.ts` — Zustand editor state
- `src/lib/media-rules.ts` — segment computation, validation, composition summary
- `src/lib/types.ts` — all TypeScript types

**API Routes**
- `src/app/api/uploads/route.ts` — file upload (POST)
- `src/app/api/uploads/validar/route.ts` — pre-upload validation (POST)
- `src/app/api/uploads/watermark/route.ts` — watermark upload (POST)
- `src/app/api/renders/route.ts` — submit render job (POST)
- `src/app/api/renders/[jobId]/route.ts` — fetch job state (GET)
- `src/app/api/renders/[jobId]/stream/route.ts` — SSE job updates (GET)
- `src/app/api/renders/[jobId]/download/route.ts` — download output or manifest (GET)
- `src/app/api/media/preview/route.ts` — video thumbnail generation

**Pages**
- `src/app/page.tsx` — editor entry point
- `src/app/processando/[jobId]/page.tsx` — live job status page
- `src/app/resultado/[jobId]/page.tsx` — results page (download or manifest)

**UI Components** (most not listed below; use Glob to discover)
- `src/components/video-editor-app.tsx` — main editor layout
- `src/components/timeline-editor.tsx` — visual timeline UI
- `src/components/preview-player.tsx` — live preview of composition
- `src/components/output-options-panel.tsx` — codec/quality/fps picker
- `src/components/watermark-panel.tsx`, `text-overlay-layer.tsx` — overlay editors
- `src/components/color-grade-panel.tsx` — brightness/contrast/saturation/blur editor

## Non-Obvious Patterns & Gotchas

1. **Auto Mode Overlap Logic**: in auto mode, when `fadeOutSeconds > 0`, the next clip starts **before** the current one ends (by `fadeOutSeconds`). This creates a smooth crossfade without manual positioning. The cursor advances by `duration - fadeOutSeconds`, not the full duration.

2. **Segment Computation is Deterministic**: `summarizeComposition()` always produces the same segments given the same inputs (no RNG in segment layout unless music events or beats are provided). This ensures preview and render stay in sync.

3. **Preview Player Ken Burns Seeding**: the Ken Burns effect variant (zoom-in vs drift) is seeded by `mediaId`, so the preview always matches the render output exactly.

4. **Manual Mode Gaps**: if you position clips with gaps in manual mode, FFmpeg detects them and fills with black frames. No error thrown; the video just has black sections.

5. **Audio Looping**: audio tracks loop indefinitely to fill the video duration. If you have one 30-second audio track and a 60-second video, the audio plays twice.

6. **Xfade Transition Logic**: if a clip has `transitionType !== "fade"`, the transition duration is the clip's `fadeInSeconds`. The offset is computed to make the transition "center" on the boundary. Individual clip fades are **suppressed** at transition points (otherwise you'd get a double-fade artifact).

7. **Watermark Upload**: separate from media upload. Stored in `os.tmpdir()/qlipo/watermarks/{sessionId}`. Images are overlaid after all video/text rendering is done.

8. **Simulation Mode JSON**: when FFmpeg is not available (or test mode), the render still completes successfully, but `/api/renders/{jobId}/download` returns a JSON manifest instead of an MP4. This is intentional, not an error.

9. **Output Codec Extension**: VP9 renders to `.webm`; H.264/H.265 render to `.mp4` (hard-coded in `renderVideo()`).

10. **Project Auto-Save**: `src/hooks/use-auto-save.ts` periodically saves the editor state to localStorage. Useful for recovery but not a full persistence layer.

## Testing

- **Unit tests**: `npm run test` runs vitest on `**/*.test.ts` files
- **E2E tests**: `npm run test:e2e` runs Playwright on `tests/` directory
- Test config in `vitest.config.ts` and `playwright.config.ts`
- Focus on timeline logic, segment computation, and API contract validation

## Next.js Version Note

This project uses Next.js 16.2.7. Check `/node_modules/next/dist/docs/` for API changes or deprecations that may differ from training data.
