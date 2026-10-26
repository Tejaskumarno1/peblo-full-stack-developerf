# Peblo roadmap: real-time, speed, presence, share page, presenting

Written 26 Oct 2026. Status: DONE = shipped and tested, NEXT = ready to build, LATER = good idea, needs design.

## 1. How real-time works today (and what Supabase does)

- Live editing, cursors, pointers, presence and presenting already run over **WebSockets**: the browser opens `wss://<host>/collab` (y-websocket) and the server relays Yjs updates and awareness (pointer, typing, presenting) to everyone in the room. There is no polling and no database hop on that path.
- **Supabase is only the Postgres database** (notes, tasks, share settings, history). A note's text is saved to it a few seconds after typing stops. It is not in the pointer path, so moving pointers to Supabase would add delay, not remove it.
- Supabase Realtime (Postgres changes / Broadcast) is still useful for a different job: **telling other devices that data changed** (a task added on the phone appears on the laptop without a refresh). See section 3.

### Why the pointer looked laggy (fixed, DONE)
1. Sender throttled to one update per 40 ms (25 per second). Now one per frame (16 ms).
2. Receiver "glided" each pointer 32% of the way per frame, so it trailed the real mouse by about 150 ms and crawled across long drops. Now 60% per frame, and a jump over 260 px snaps.
3. Biggest one: when person A **scrolled the page with a still mouse**, no mouse event fired, so B kept showing the old spot until A moved the mouse, then it jumped. A now re-sends the pointer on every scroll.
- Test: `e2e/pointer-sync.mjs` (move shows within 160 ms, scroll under a still mouse updates within 300 ms).
- What is left is the network itself: browser to Render and back. NEXT: pick the Render region closest to users, and use a paid instance that never sleeps (a sleeping free instance adds seconds to the first connection).

## 2. Speed and "agile" ideas

NEXT (cheap, high value)
- Lazy-load the heavy chunks: editor (1.2 MB) and PDF (0.98 MB) only when a note or an export is opened; shrinks first load a lot.
- Use the Supabase **connection pooler** (port 6543, transaction mode) for the server; add indexes for notes by owner + updated_at, tasks by due date, share tokens.
- Turn off websocket per-message compression for awareness messages (tiny, CPU cost > gain) and keep compression for document updates.
- Optimistic UI everywhere: show the change instantly, reconcile after the server answers (already done for notes; extend to tasks, tags, folders).
- Prefetch the next likely note on hover; cache lists with React Query `staleTime`.
- Virtualize the notes and tasks lists (render only visible rows) once someone has hundreds of notes.
- Brotli + long-cache headers for hashed assets; put Cloudflare (free) in front of Render for static files.

LATER
- Service worker: open the app instantly offline and queue edits; Yjs merges them on reconnect.
- Send pointers as a compact binary message instead of JSON awareness (about 5x smaller, matters with 20+ people).
- Client-side prediction: draw the remote pointer slightly ahead using its last velocity so network jitter never shows.

## 3. Where Supabase Realtime and sockets help

- NEXT: a single "changes" channel per user (Supabase Realtime on `notes`, `tasks`, `share_guests`) so lists, badges and the notification bell update on every device without polling.
- NEXT: reconnect banner + automatic resync after sleep/wake of the laptop (y-websocket already retries; show it clearly).
- LATER: presence in the app shell: "Maya is editing 'Roadmap'" next to the note in the list, from the same awareness data.

## 4. Presence and collaboration features

DONE: avatars with typing/away state, follow someone, live pointers on the same words, edge markers, reading rail with where everyone is, comments with margin badges, @-style names, ping (Alt+click), per-person roles and a waiting room.

NEXT
- Block-level presence: a small avatar in the margin of the block each person is in.
- Cursor chat: press `/` and type a short message that floats at your pointer for 5 seconds.
- Emoji reactions that float up from your pointer.
- Selection highlight: see the text another person has selected, in their colour.
- "Request edit access" button for viewers, approved by the owner from the bell.
- Who changed what: show the author of each paragraph on hover (from note history).

LATER
- Voice huddle (WebRTC) inside a shared note; screen share for presenting.
- Shared task boards with live cards and pointers.

## 5. Presenting

DONE (this round): the presenter toolbar can be **dragged anywhere**, snaps to the screen edges (turns vertical on the left/right), **folds to a small pill**, double-click the grip to reset, remembers its place, stays on screen, the audience panel moves aside when the dock is on the right. Test: `e2e/share-dock.mjs`.

NEXT
- Draw on the page: pen and highlighter that fade after a few seconds, for everyone.
- Laser colour and size; a short trail behind the laser.
- Slide mode: each heading becomes a full-screen slide, arrow keys move, the audience follows.
- Presenter view: current section, next section and private notes side by side.
- Countdown timer with a gentle end alert; show-and-hide for the audience.
- Question upvotes and a queue order; keyboard-shortcut cheat sheet (`?`).
- Make the audience panel and the poll card draggable and resizable like the dock.

LATER
- Recording of a session (pointer + scroll timeline) that can be replayed from the recap.
- Breakout polls with results saved into the note.

## 6. Share page review (honest)

Good: clean reading view, live collaboration panel, roles and waiting room, reading rail, comments, QR and short link, dark mode, phone layout, presenting.
Weak or unfinished
- It is **not pixel-identical** to the "Version D" mockups; about 4 of the 50 main screens are still missing and some spacing differs.
- Fixed this week after your "mistakes" note: wasted space, cover banner, empty tail, dark panel, double user indicators, flags on the wrong scrollbar, double scrollbar in the app, menu icons.
- NEXT: a visual regression test (screenshots compared per screen) so layout drift is caught automatically.
- NEXT: finish the remaining mockup screens; list them in a tracking note and tick them off with tests.

## 7. Letting bots and agents edit (permitted)

Design: an **agent role** on share links and access tokens.
- A scoped token: can only read/edit the notes or share links you pick, expires, can be revoked in Settings.
- Edits arrive as a named "agent" in the live room (own colour, label "Agent"), so people see what it changes.
- Every agent change is stored in note history with the agent's name, with one-click revert.
- Rate limit and size limit per token; no delete without owner approval.
- Surface: the existing pebo MCP tools (`update_note`, `append_to_note`) use the same token.

## 8. Desktop builds

- Mac shows "Peblo Not Opened" because the app is not signed and notarized by Apple. Workaround: System Settings, Privacy & Security, Open Anyway (or `xattr -cr /Applications/Peblo.app`). Permanent fix: Apple Developer ID ($99/year); the workflow already signs and notarizes when the five secrets are added.
- Linux: `.deb` (Debian/Ubuntu/Mint) and `.AppImage` (any distro) for x64; **ARM64** builds were added and are built on the next release tag.
