# Drawing / whiteboard in Peblo (Excalidraw)

Status: research report, run 1 (2026-11-11). No code changed yet. Phase 1 starts on a later run once the open questions in section 11 are settled.

## 1. Summary and recommendation

Embed the MIT-licensed `@excalidraw/excalidraw` React package. Ship it first as a **BlockNote custom block ("Drawing") inside notes**, because notes are where Peblo users already live and the existing `docfile` block shows the exact pattern for a custom block that survives Peblo's Markdown storage. A standalone **Drawings page** is phase 3 and reuses the same component and storage.

Store each drawing as scene JSON (elements + a small appState subset + file references) in a new `drawings` table, and keep a rendered **SVG snapshot** in the existing `media` store. The note's Markdown carries only an image line pointing at the snapshot plus the drawing id. That one design gives: read-only rendering on the public share page with zero Excalidraw code loaded, export for free, and graceful degradation in Markdown/exports/MCP.

Load the editor with a dynamic `import()` only when a drawing is opened, so the main bundle does not grow.

## 2. Excalidraw feature inventory

Sources: the GitHub README and the SDK docs (docs.excalidraw.com now redirects to plus.excalidraw.com/docs/sdk).

Drawing tools: selection, hand (pan), rectangle, diamond, ellipse, arrow, line, free-draw, text, image, eraser, laser pointer, frame, embeddable (iframe) and a web-embed element.

Styling: stroke and background colour, fill style (hachure, cross-hatch, solid), stroke width and style (solid, dashed, dotted), "sloppiness" (architect, artist, cartoonist), edge roundness, opacity, font family and size, text alignment, arrow heads, layer ordering, groups, flip, lock, link on element.

Hand-drawn look: rendered with roughjs; fonts include Excalifont (hand), Nunito, Lilita One, Comic Shanns, Liberation Sans and a code font.

Arrows and binding: arrows and lines bind to shapes and follow them when moved; labels on arrows and in-shape text; elbow (right-angle) arrows in 0.18+; straight, curved and elbow arrow types.

Canvas: infinite canvas, zoom and pan, grid and snap, object snapping, zen mode, view mode, stats panel, dark mode, undo/redo, copy/paste, duplicate by Alt-drag, multi-select, alignment and distribution, find on canvas.

Libraries: reusable shape collections (`.excalidrawlib`), public library site libraries.excalidraw.com with a "add to Excalidraw" flow using `libraryReturnUrl`; `onLibraryChange` callback to persist the user's library.

Import/export: `.excalidraw` JSON (type "excalidraw", version 2, source, elements, appState, files), `.excalidrawlib`, PNG and SVG export (optionally with the scene embedded so the file can be re-opened and edited), copy PNG/SVG/JSON to clipboard. Utilities: `exportToCanvas`, `exportToBlob`, `exportToSvg`, `exportToClipboard`, `serializeAsJSON`, `loadFromBlob`, `restore`, `restoreElements`, `reconcileElements`.

Collaboration: excalidraw.com runs end-to-end-encrypted live rooms over a socket server (room link plus key in the URL hash), with pointer cursors and usernames. This is **not part of the npm package**; the package exposes the hooks to build it (`onChange`, `onPointerUpdate`, `isCollaborating`, `updateScene({ collaborators })`, `reconcileElements`, `CaptureUpdateAction.NEVER`).

Props worth using (all optional): `initialData`, `excalidrawAPI`, `onChange`, `onPointerUpdate`, `viewModeEnabled`, `zenModeEnabled`, `gridModeEnabled`, `theme` ("light" | "dark"), `langCode`, `UIOptions` (hide canvas actions, tools), `renderTopRightUI`, `onLibraryChange`, `libraryReturnUrl`, `generateIdForFile`, `validateEmbeddable`, `renderEmbeddable`, `handleKeyboardGlobally`, `detectScroll`, `autoFocus`. Slots: `<MainMenu>`, `<Footer>`, `<WelcomeScreen>`, `<Sidebar>`. Elements can carry `customData`.

Other facts: licence MIT; npm latest stable line is 0.18.x (package page shows 0.18.0; a 0.18.1 tag also exists on the CDN; confirm the exact version at install time); peers are react and react-dom (README says React 17/18/19 supported on the 0.18 line; verify against Peblo's React 19.2 in the spike); unpacked package is large (about 47 MB on disk, mostly fonts and locale chunks; the JS actually downloaded in a browser is far smaller and code-split, but the editor chunk is still on the order of 1 MB or more gzipped, to be measured in the spike). Fonts are fetched from a CDN by default; self-host by copying `dist/prod/fonts` and setting `window.EXCALIDRAW_ASSET_PATH`. The container must have non-zero width and height. Mobile: works with touch, pinch zoom, pen; the UI collapses to a compact mobile layout, though precision editing on a phone is limited.

## 3. What Peblo needs (and what to skip)

Need (phase 1-2): the shape tools, arrows with binding and labels, text, free-draw, eraser, image paste, colours and hand-drawn styles, undo/redo, zoom/pan, dark mode, PNG/SVG export, library of shapes (persisted per user), view-only rendering, real-time co-editing with the note's collaborators.

Nice to have: frames (group sections), laser pointer in a shared session, find on canvas, embed links (a Peblo note link as an embeddable), "convert selection to a task" via `customData`.

Skip: excalidraw.com's own room/E2EE server, Excalidraw+ features, the AI "text to diagram" (Peblo has its own AI; may be revisited as an AI-mode action later), web embeds of arbitrary sites (security: iframes on share pages; keep `validateEmbeddable` closed by default).

## 4. Where it lives in Peblo (what the codebase tells us)

Facts read from the repo (branch fix/focus-bar):

- Notes are stored as **Markdown text** in `notes.content` (Prisma `Note`, Postgres). BlockNote is a view over it; custom blocks must round-trip through Markdown. `client/src/components/BlockEditor.jsx` builds the schema with `BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, docfile: docFileSpec() } })`.
- `DocFile.jsx` is the template: a `createReactBlockSpec` with `content: 'none'`, and a Markdown form that is an ordinary image line whose URL carries packed props (`packProps` / `unpackProps` in `utils/docFiles.js`). `useFileFrames.js` re-hydrates such image lines into the live component on read-only surfaces. The drawing block should follow this pattern exactly.
- Live co-editing: one Yjs doc per open note via `y-websocket`, with single-use WebSocket tickets (`client/src/utils/collab.js`, server `routes/collab.ts`, `services/collab.ts`). The Markdown text is still saved as a safety copy.
- Pictures: `routes/media.ts` stores WebP/PNG/JPEG/GIF in a `media` table (6 MB each, 500 MB per account), public read by long random id, so they show on share pages. **SVG is deliberately not allowed** (`files.ts` also treats `image/svg` as risky), so an SVG snapshot cannot simply go through this route.
- Share page: `pages/SharedPage.jsx` renders Markdown with `marked` and sanitises with DOMPurify, then `useFileFrames` hydrates special image lines.
- Theme: Soft Studio tokens are CSS variables in `client/src/soft/soft.css` (`--s-bg #FBF6EE`, `--s-surface`, `--s-line`, `--s-fg`, `--s-accent #C4441C`, pastel set peach/mint/butter/lilac/sky, `--s-shadow`).
- Tests: client unit tests use `node --test "src/**/*.test.mjs"`; Playwright e2e scripts live in `e2e/` (`.mjs`).

## 5. Embedding design

### 5.1 BlockNote custom block (phase 1)

- Block type `drawing`, `content: 'none'`, props: `id` (drawing id), `h` (height in px, default 360), `ver` (snapshot version, cache-buster), `caption`.
- Collapsed view: the SVG/PNG snapshot as an `<img>` (cheap, no Excalidraw loaded), a toolbar with an Edit icon (lucide `PencilRuler`), Expand, Export, Remove. No emojis anywhere; icons only.
- Edit view: click Edit (or double-click the snapshot) opens the editor **in place** at the block width for quick sketches, with an Expand control that goes full-screen (a portal overlay, like `DocFrame` does for documents) to save space in the note. Full-screen is the default for editing on screens narrower than 720 px.
- Slash menu entry "Drawing" next to the existing file entry; also reachable from the `+` menu and the quick-create sheet.
- Markdown form: `![Drawing: <caption>](/api/media/<snapshotId>#pbdraw=<drawingId>)`. Anything that only understands Markdown still shows the picture. `unpack` in the same style as `docFiles.js`.
- Lazy loading: `const Excalidraw = lazy(() => import('@excalidraw/excalidraw'))` plus `import '@excalidraw/excalidraw/index.css'` inside the same chunk; Vite `manualChunks` keeps it separate from the BlockNote chunk. Show a Soft Studio skeleton while loading.
- Set `window.EXCALIDRAW_ASSET_PATH` to a self-hosted `/excalidraw-assets/` folder (copy fonts at build with a tiny Vite plugin or `vite-plugin-static-copy`). Needed for offline use, CSP, and privacy (no third-party CDN calls).

### 5.2 Standalone Drawings page (phase 3)

A "Drawings" destination in `SoftShell` with a grid of cards (snapshot thumbnail, title, updated), folders/tags reusing the notes folder model, full-page editor with the same component, and "Insert into note" which creates a `drawing` block pointing at the same drawing id (or a copy, see 6.3). Do not add a new top-level nav item before checking space in the dock; a section inside Notes (a filter chip "Drawings") saves screen space and is the preferred first version.

## 6. Data model and storage

### 6.1 Options considered

A. Scene JSON inline in the note Markdown/Yjs. Rejected: scenes are 10 KB to several MB; it would bloat `notes.content`, history/backups (`NoteBackup`), embeddings, AI context, search and the collab doc.

B. Scene JSON as a Yjs sub-structure of the note doc. Good for real-time but ties the drawing to one note, bloats the note doc, and does not give a share-page read path. Keep for live sync only (see 8).

C. (Chosen) A `drawings` table holding the scene, referenced by id from the block; snapshot in `media`.

### 6.2 Schema (new migration, next number after 035 in server SQL migrations)

```
drawings(
  id uuid pk, user_id, space_id null, note_id null,   -- space/note for access checks
  title text, scene bytea/jsonb,                      -- {elements, appState subset, fileIds}
  files jsonb null,                                   -- or separate drawing_files table (see below)
  snapshot_media_id text null, version int, created_at, updated_at)
drawing_files(drawing_id, file_id, media_id, mime)    -- embedded images
```

- Scene stored as compressed JSON (gzip, `bytea`), encrypted with the existing `encField`/`dataCrypto` approach like other note data so it matches current privacy handling. Cap 5 MB per scene, 200 drawings per free account (tune).
- `appState` subset only: `viewBackgroundColor`, `gridSize`, `theme` is NOT stored (theme is a viewer setting). Elements keep `isDeleted` tombstones trimmed on save (drop deleted elements older than 24 h) to prevent growth.
- Images pasted into a drawing: Excalidraw hands them over as base64 `files` entries. On save, upload each new file to `/api/media` (WebP/PNG/JPEG/GIF are allowed already) and store only `fileId -> mediaId`; on load, fetch and rebuild data URLs. This keeps scene JSON small and reuses the 500 MB quota.
- Snapshot: on save (debounced, and on close) the client runs `exportToSvg`/`exportToBlob` and uploads. **SVG is not accepted by media.ts**, so the snapshot is a **PNG** (2x, transparent or theme background) through the existing route; a later optional enhancement is a dedicated `/api/drawings/:id/svg` route that serves sanitised SVG with `Content-Type: image/svg+xml` and `Content-Security-Policy: sandbox`. The SVG gives crisp zoom on the share page; PNG is the safe first step.
- Versioning: bump `version` on every save; keep the last N scenes (say 20) per drawing in a `drawing_versions` table so the existing note history UX can later show drawing diffs; each save is one row, pruned.
- Offline: cache the scene in IndexedDB keyed by drawing id, and queue saves like the app's offline bar does for notes.

### 6.3 Copy vs reference

Pasting a drawing block into another note or duplicating a note must not make two notes edit the same drawing silently. Decision: the block keeps a reference (live link) inside one note; "copy to another note" creates a new drawing row (clone scene and media references). Document this in the block menu ("Duplicate drawing").

### 6.4 API

`GET /api/drawings/:id`, `PUT /api/drawings/:id` (If-Match on `version`; 409 on conflict), `POST /api/drawings`, `DELETE`, `GET /api/drawings` (list for the Drawings page), `POST /api/drawings/:id/snapshot`. Auth reuses the note access rules (owner, space member, share-edit). Rate-limit like other write routes. Also expose to the MCP tools later (`get_note` returns the snapshot URL and the drawing id; AI can describe a drawing via `describeImage` on the PNG, giving search for free through the existing media description pipeline).

## 7. Sharing and the public share page

- Share page needs nothing from Excalidraw for read-only: the Markdown has an image line, so `marked` renders the PNG; `useFileFrames`-style hydration can upgrade it to an interactive **pan/zoom viewer** later by lazy-loading Excalidraw with `viewModeEnabled` and `zenModeEnabled`, fetching the scene from a public, token-scoped route `GET /api/share/:token/drawings/:id` (only drawings referenced by the shared note; checks `shareToken`, expiry, and that the id appears in the note content).
- Edit-access shares (`shareEdit`): the visitor edits through the same collab ticket path, with drawing saves going through `PUT` authorised by the share token.
- Sanitisation: DOMPurify already runs. Scene text is never injected as HTML. Embeddable elements are stripped from shared scenes unless `validateEmbeddable` allow-lists the host.
- Search and AI: element text is extracted on save into a plain "drawing text" string used for search and embeddings (and the media description), so drawings are findable.

## 8. Real-time collaboration with the existing stack

The package gives no server, so build on what Peblo has:

- Reuse the `/collab` WebSocket and ticket flow with a **second Yjs doc per drawing** (room `drawing:<id>`), so awareness (cursor, name, colour via `colorFor`) matches note collaboration.
- Model: a `Y.Map` of element id -> element JSON (with Excalidraw's per-element `version` and `versionNonce`). Local `onChange` diffs changed elements into the map; remote map changes call `api.updateScene({ elements: reconcileElements(local, remote, appState), captureUpdate: CaptureUpdateAction.NEVER })`. This is the same reconciliation excalidraw.com uses; it is last-writer-wins per element, which is correct for drawing.
- Pointers: `onPointerUpdate` feeds Yjs awareness; render with `updateScene({ collaborators: Map })` (Excalidraw draws the cursors).
- Persistence: server debounces the Y.Map into `drawings.scene` (server already persists note Yjs state in `services/collab.ts`; mirror that), and regenerates nothing else (snapshots are made by a client on idle: the last client to leave posts the snapshot).
- Presence reuse: the "presence badges" and peer cursor code on the share page can be shared.
- Fallback: if the socket is down, fall back to optimistic `PUT` with version check and a "keep mine / take theirs" prompt, same as the note save path.

## 9. Export

- In-editor menu: PNG (1x/2x/3x, background on/off, dark/light, with optional embedded scene), SVG (same, text kept as text), copy to clipboard (PNG/SVG), `.excalidraw` JSON download, and import of `.excalidraw`, `.excalidrawlib` and images.
- Whole-note export: the existing PDF/Markdown export (`html2pdf.js`, jspdf) gets the PNG snapshot automatically because it is an image line. Peblo's zip export (`routes/transfer.ts`) should include `drawings/<id>.excalidraw` so nothing is locked in.
- Embedded-scene PNG lets users drop an exported PNG back into a drawing and keep editing.

## 10. Theming (Soft Studio and dark mode)

- Pass `theme={isDark ? 'dark' : 'light'}` from the app theme store; Excalidraw's own dark mode inverts the canvas colours with a filter, which keeps strokes legible. Saved scenes store neutral colours, so a drawing looks right in both modes.
- Restyle the chrome via Excalidraw's CSS variables on a wrapper class `.pb-draw`: `--island-bg-color` -> `--s-surface`, `--color-primary` / `--color-primary-darker` -> `--s-accent` / `--s-accent-ink`, `--default-border-color` -> `--s-line`, `--text-primary-color` -> `--s-fg`, radius 14 px and `--s-soft-shadow`. Canvas default background `--s-bg` (`#FBF6EE`) for light.
- Default stroke palette seeded with the Soft pastels (peach, mint, butter, lilac, sky) plus ink `#241F1A` and accent `#C4441C` via the colour picker's custom palette (`UIOptions` does not set this; use the `--color-picker` customisation or pre-fill `currentItem*` in `appState`).
- Keep the hand-drawn font (Excalifont) as the default text face; the app UI keeps its own fonts. Hide the Excalidraw+ promo, the library "browse" link opens libraries.excalidraw.com in a new tab, and the GitHub/Discord items are removed through `<MainMenu>` composition.
- Compactness: hide the top-right share/collab button, use `zenModeEnabled` inside notes, show only the tool island and a minimal footer (zoom, undo/redo), no welcome screen. Icons only, no emojis.

## 11. Risks and open questions

1. **React 19.2 compatibility** of the current 0.18.x package: verify in the spike (peer range, `react-dom` warnings, `useSyncExternalStore` use). Fallback: `@excalidraw/excalidraw@next` or pin React types. Highest-priority check.
2. **Bundle weight and cold start.** Mitigated by lazy loading and a separate chunk; measure with `vite build` + rollup visualizer, and target under ~1.2 MB gzip for the on-demand chunk. The Express server does not serve static assets in production (Render/Vercel deploy from branch `supabase`), so the fonts folder must be in the Vite `public/` output.
3. **BlockNote focus and keyboard capture.** Excalidraw handles keys itself; leave `handleKeyboardGlobally=false`, stop propagation of key and clipboard events at the block wrapper, and set `contentEditable=false` on the block. Test paste, undo (Ctrl+Z must not hit BlockNote's undo), arrow keys and Delete.
4. **Yjs doc growth and note history.** Drawings stay outside the note doc, so note history, backups and diff (`VersionDiff.jsx`) are unaffected; the block only stores an id and a snapshot URL.
5. **SVG in media.** Deliberately blocked; PNG snapshot first, hardened SVG route later.
6. **Security.** Embeddables off by default; no remote library auto-import beyond user-initiated `.excalidrawlib` files; validate scene shape with a server-side schema (zod, like `schemas/index.ts`) and cap element count (e.g. 20 000) and size.
7. **Mobile.** Touch works, but the full UI is dense; default to full-screen editing on narrow screens, 44 px hit areas for our own buttons, and test on Pixel/iPhone viewports with Playwright. Palm rejection and stylus are handled by Excalidraw's pointer events.
8. **Licensing/branding.** MIT permits embedding; keep the licence notice in the third-party notices file. The excalidraw.com logo and name must not be used as Peblo branding.
9. **Upstream churn.** 0.x semver with breaking minor releases; pin the exact version, upgrade deliberately, and keep our scene JSON in the documented `.excalidraw` v2 format so a version bump is a restore() away.
10. **Open question for the owner:** is "per-block, live-linked drawing" (section 6.3) acceptable, or should a drawing be embedded by value? Also: per-account drawing limit.

## 12. Effort and phased build plan

Rough effort for one developer with Claude: phase 1 about 3-4 days, phase 2 about 3 days, phase 3 about 3 days, phase 4 about 2 days.

**Phase 0 – spike (half a day).** Install `@excalidraw/excalidraw` in `client`, render it on a scratch route with React 19.2, measure the chunk, confirm fonts self-hosting and CSS variable theming, confirm paste/undo isolation inside a BlockNote block.

**Phase 1 – drawing block in notes, single user.**
- Dependency, lazy chunk, self-hosted assets, `.pb-draw` theme CSS (light and dark).
- `DrawingBlock.jsx` + `drawingSpec` registered in `BlockEditor.jsx`; slash menu item; Markdown pack/unpack in a `utils/drawings.js` with unit tests (`utils/drawings.test.mjs`: pack/unpack round-trip, scene trim of deleted elements, size cap, element text extraction).
- Server: migration, `routes/drawings.ts` (create/get/put with version check, snapshot upload), schema validation, access checks; server tests for authz and conflict.
- Save/load, debounced autosave, PNG snapshot, dark mode switch, Export PNG/SVG/JSON.
- Playwright e2e (`e2e/drawing.mjs`): create a note, insert a Drawing from the slash menu, draw a rectangle and arrow via mouse, reload and assert the scene persisted and the snapshot shows, toggle dark mode, export, share the note and assert the public page shows the picture; screenshots saved for light, dark and mobile viewport.

**Phase 2 – sharing and read-only viewer.** Token-scoped scene route, interactive view-only viewer on the share page, text extraction into search, MCP/AI description, zip export of `.excalidraw`.

**Phase 3 – standalone Drawings (Notes section filter + page), library persistence, folders, duplicate/copy semantics, versions list.**

**Phase 4 – real-time collaboration** on the existing `/collab` socket with awareness cursors (section 8), offline queue, and conflict fallback; e2e with two browser contexts.

Definition of done for every phase: unit tests, Playwright e2e with screenshots, no existing feature removed, no emojis in the UI, Soft Studio tokens only, build green, committed with the Co-Authored-By trailer and pushed to `supabase`, `main` and `fix/focus-bar`.

## 13. Sources

- https://github.com/excalidraw/excalidraw (README: features, MIT, integrations)
- https://plus.excalidraw.com/docs/sdk/excalidraw/installation (install, self-hosting fonts, container size)
- https://plus.excalidraw.com/docs/sdk/excalidraw/api/props (props)
- https://plus.excalidraw.com/docs/sdk/excalidraw/api/utils/export (export utilities and appState export options)
- https://plus.excalidraw.com/docs/sdk/codebase/json-schema (scene JSON format)
- https://npmjs.com/package/@excalidraw/excalidraw (version 0.18.x, MIT, package size)

## 14. Run log and next steps

- Run 1 (2026-11-11): created this report from web research plus a read of the Peblo codebase. Not yet done: hands-on exploration of excalidraw.com in the browser, bundle measurement, React 19 check (all scheduled for the phase 0 spike).
- Next run: check `git log` for edits; deepen sections 6 (migration numbering and encryption helper usage), 8 (read `services/collab.ts` and `routes/collab.ts` and write the exact server changes), and 11.1/11.2 with measurements; then start Phase 0/1.
