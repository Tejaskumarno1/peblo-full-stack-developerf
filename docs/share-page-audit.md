# Share page audit

Scope: the public share page (`/s/note/:token`, `/s/todo/:token`) compared with the owner's note page. Code read from the `fix/focus-bar` worktree. No app code was changed.

Files: `client/src/pages/SharedPage.jsx` (1175 lines), `useShareReader.js` (161), `shared-page.css` (542), `server/src/routes/share.ts` (`publicRoutes`), `server/src/index.ts` (agent route), `components/{FindBar,CollabPanel,PagePolls,PictureView,GuestTour,CommentsDock,VersionHistory,FocusMode,MediaTools,VoiceButtons}`.

Line numbers below are for `SharedPage.jsx` unless another file is named.

---

## 1. Features that exist

| # | Feature | Where | Notes |
|---|---|---|---|
| 1 | Read-only render of a note | `toHtml` ~L30-140, `DocHtml` | marked + DOMPurify, heading ids, picture groups with pills, table marks |
| 2 | Editable note for edit links | `BlockEditor guest fullPage` ~L1085 | same editor as the owner, minus owner tools |
| 3 | Live co-editing room | `collab={{share, sid, name}}`, `collabState`, `/api/public/collab` | falls back to polled save when the room fails (`collabOff`) |
| 4 | Task link page | `data.kind==='todo'`, `.taskcard` | title, priority, tags, due, done toggle, linked note |
| 5 | Header | `<header className="top">` | brand, crumb, role pill (Can view / Can edit), Preview, Save, Copy link, Full screen, Appearance, More |
| 6 | Reading progress bar | `.progress`, `updateProgress` | also hides the header on scroll down (`topHidden`) |
| 7 | Outline (on this page) | `headings`, `.toc`, `srail-fly outline`, mobile sheet | h2/h3 only, active heading by IntersectionObserver, pin/unpin (`peblo-share-look`/`tocOpen`) |
| 8 | Reading stats | `by-stats` | min read and word count |
| 9 | Byline | `.by` | author initials, "Shared by", updated time, save status for editors, link-expiry chip |
| 10 | Guest name and colour | join card (`join-card`) and inline `.welcome` strip | stored in localStorage; colour shows on the guest's cursor |
| 11 | Live presence | `presence` beat (3 s editable, 6 s read-only), `CollabPanel mode="guest"`, `CollabBar` | peers' cursors, selection, "is typing" pill, follow a person, join/leave toasts, section markers in the outline |
| 12 | Waiting room | `wait` state, `knock` loop | when the owner turned on approval; name field; declined variant |
| 13 | Link expiry and extend request | `askExtend`, `data.expiresAt`, `/extend-request` | chip turns "soon" under 24 h |
| 14 | Preview as role | `previewMode`, `preview-roles` | owner/editor sees the page as a viewer would |
| 15 | Save to my Peblo / Open in Peblo | `saveSharedCopy`, auth modal (login or sign-up) | copy kept per account in localStorage |
| 16 | Copy link | `copy()` | |
| 17 | Export | `exportShared`: Markdown, PDF, Word, HTML, plain text; "Copy as Markdown" | |
| 18 | Turn sharing off (owner only) | `turnSharingOff`, `revokeConfirm` modal | |
| 19 | Appearance menu | `look-menu`; text size, width, font, style (Owner/Soft/River/Orbit), theme, show pointers, quiet mode, keep tool bar | persisted `peblo-share-look` |
| 20 | Dark mode | `darkMode`, More menu | |
| 21 | Full screen | `toggleFullscreen`, `fs-exit` | key `F` |
| 22 | Tool dock | `.dk`, `.dh` handle, `.dk-edge` | Outline, People, Look, Full screen, Bookmarks, Keys, Save |
| 23 | Left rail with fly-outs | `.srail`: Outline, People, Comments, History, File | Comments button disabled for viewers |
| 24 | Reader memory (this browser only) | `useShareReader.js` | bookmarks (key `B`), "you stopped at", "N changes since your last visit" with marks |
| 25 | Reader find (Ctrl+F) | `readerFind`, `FindBar editable={false}` | Find only, no Replace |
| 26 | Picture viewer | `viewPic`, `PictureView` | click a picture: full size, Copy, Save |
| 27 | File frames | `useFileFrames` | embedded PDFs/docs render in place |
| 28 | Polls | `PagePolls` | vote as guest by session id |
| 29 | Keyboard shortcuts | `[` `]` `\` `/` `?` `F` `B` Esc | shown in `keys-sheet` |
| 30 | Guest tour | `GuestTour` | first-visit coach marks |
| 31 | Toasts | `toast` state, `.pb-shared .toast` | centred bottom (CSS L186) |
| 32 | Back to top | `.totop` | after 5% progress |
| 33 | Phone layout | `.mbar` bottom bar: Outline, People, Look, Link, Save; `tocSheet` | dock hidden under 640 px |
| 34 | Print | `@media print` (CSS L235) | hides chrome |
| 35 | Call to action and footer | `.cta`, `.foot` | |
| 36 | Agent access | `server/src/index.ts` `agentNote`, `<link rel=alternate>` | same link returns Markdown/JSON to bots |
| 37 | Rate limits | `guestPresenceLimit`, `guestKnockLimit`, `guestWriteLimit`, `guestSaveLimit` | |

## 2. States

| State | Trigger | What the page shows | Verdict |
|---|---|---|---|
| Loading | no `data` | "Loading your shared page…" text only | thin: no skeleton |
| View-only | `canEdit=false` | rendered HTML, "Can view" pill, Comments rail disabled | ok |
| Can edit | `canEdit=true` | title textarea, BlockEditor, status text, join card for guests | ok |
| Comment-only | not a role | does not exist. Comments are "for people who can edit" | gap |
| Guest join card | edit link, not signed in, not joined | modal: name, colour, Join / join anonymously | ok; duplicated by the inline `.welcome` strip |
| Waiting for approval | `body.waiting` | `waiting-room` card with name field | ok |
| Declined | `wait==='declined'` | "The owner did not let you in" | ok; no "ask again" button |
| Removed by owner | 403 `removed` | error card "The owner removed you" | ok |
| Role changed | 403 on save | toast "The owner changed your access" and editor becomes read-only | toast only; no banner |
| Expired / revoked / bad link | 404 | one generic "This link isn't available" card with the server error text | gap: expired, revoked and never-existed look the same; no "ask for a new link" action |
| Link expiring | `expiresAt` | chip in byline (red under 24 h) + Ask to extend | chip is small; the extend request is hidden in the menu |
| Sharing turned off (owner on page) | `shareOff` | green banner | ok |
| Saved / saving | `status` | text in byline | ok, editors only |
| Save error | `status==='error'` | "Could not save" text, no retry button | gap |
| Conflict (409) | `conflict` | `.conflict` card with actions (Keep mine / Take theirs / Keep both) | ok; looks unlike the rest |
| Offline | presence missed twice | `CollabBar` chip, `CollabPanel offline` | gap: nothing says edits are queued or lost |
| Synced again | `synced` | 4 s notice | ok |
| Typing peers | `typingText` | pill bottom-left | ok |
| Live room opening | `collabState==='wait'` | save waits up to 20 s | invisible to the user |
| Saved copy exists | `savedCopy` | button becomes "Open in Peblo" | ok |
| Password protected | none | not supported | gap, decision needed |
| Quiet mode | `look.quiet` | hides pills, bar and typing | ok |
| Preview as role | `previewMode` | peers hidden, read-only | ok |

## 3. What the owner page has that the share page lacks

| Owner page | Share page | Gap |
|---|---|---|
| Find and Replace (Ctrl+F, Ctrl+H), draggable | Find only; draggable bar exists in `FindBar` now | replace for editors is missing; check the bar sits clear of the header and the right rail |
| Word-style zoom (Office view) | text-size A- A A+ A++ only | no zoom % control |
| Focus mode / typewriter / fullscreen with bottom editorial bar | fullscreen only; no focus mode | owner bottom bar bug does not apply; share dock is fine |
| Dictation / voice to text, voice pill | none | add for editors |
| Slash menu with media, blocks, templates | BlockEditor slash menu (same component) | duplicates reported in item 7 apply here too |
| Floating selection toolbar | same component | overlap bug applies |
| Toasts bottom-left | toast centred bottom | inconsistent |
| Tags | read-only chips on tasks only; notes show none | gap |
| Version history (restore) | History fly-out shows "since your last visit" only | no versions list |
| Comments and suggestions | Comments rail disabled for viewers; needs `.pb-cbtn` from the editor | viewers cannot comment |
| Task linking, @mentions | none | not needed for guests |
| Export (md, pdf, doc, html, txt) | all five present | ok |
| Print | print CSS only; no Print button | add to menu |
| Text size, font, width | present | ok |
| Theme | Light/Dark; no "follow system" | add |
| Keyboard shortcuts | present | ok |
| Accessibility | roles and aria labels present; no skip link, focus is not trapped in the menu | gap |
| Phone layout | bottom bar; no editor toolbar for phones | gap |
| SEO / OG | `index.html` has one generic description and title "Peblo"; no per-page title, `og:title`, `og:description`, `og:image`, no `robots noindex` | gap, privacy risk |
| 404 / expired | one generic card | gap |
| Media upload by guests | no upload path on public routes | decision |
| Attachments download | links in HTML only | ok |

## 4. Broken or incomplete

1. **Document title never changes.** The tab says "Peblo" for every share. Link previews in chat apps show nothing useful.
2. **No `noindex`.** A shared link can be indexed once it is posted anywhere public.
3. **Expired, revoked, removed and missing links share one card.** The server error text is shown raw.
4. **Toast is centred at the bottom**, and the dock sits in the same area; the owner's rule is bottom-left.
5. **Two join paths for guests** (modal card plus the inline "You are editing as" strip) with two colour pickers.
6. **No retry on a failed save**, and no sign that edits made offline are kept.
7. **Conflict card styling differs** from every other card on the page.
8. **Comments are unreachable for viewers**, and the disabled rail icon only explains itself in a tooltip.
9. **No version list or restore** for editors.
10. **Loading is plain text**; the owner page has a skeleton.
11. **Header crowding.** Role pill, Preview, Preview roles, Save, Copy link, Full screen, Appearance and More sit in one row; below ~1000 px it wraps.
12. **Dock "Look" button** opens the Appearance menu and scrolls to the top, so the menu can open off-screen.
13. **Find bar on the share page** is the reader version; edit pages get no Replace.
14. **Poll attribute**: `PagePolls` is shown to everyone; no empty state.
15. **`tocLinks` use `h2/h3` only**, so notes that use `h1` for sections show an empty outline.
16. **Presence polling continues in hidden tabs**; it should slow down.
17. **Typing-pill and CollabBar** both bottom-left and can overlap with the toast.

## 5. Prioritised gap list

**P0 (privacy and trust)**
- Per-link `<title>`, OG tags, `noindex` (server-rendered head for `/s/*`).
- Distinct pages for expired, revoked, removed, declined, never existed, with the right action on each ("Ask for a new link", "Ask again", "Go to Peblo").
- Retry button and offline banner for editors.

**P1 (core use)**
- Toast moved to bottom-left, one queue, clear of the dock and presence pills.
- One guest join flow (the card), with the inline strip reduced to a "Change name" link.
- Comment-only role (view + comment), with Comments rail enabled.
- Find with Replace for editors; zoom control.
- Mobile layout with an editor toolbar and a safe-area aware bottom bar.
- Version history list for editors (restore asks first).

**P2 (polish)**
- Voice dictation pill, draggable, for editors.
- Focus mode on the share page.
- Print button, "follow system" theme, tags on notes, skeleton loading.
- Header consolidation: role pill + Share/Save + one More menu.
- Accessibility pass: skip link, focus trap in menus and dialogs, visible focus on rail buttons.
- Slow down presence in hidden tabs.

## 6. Decisions needed from the owner

1. Add a **comment-only** link role?
2. Add **password protection** for links?
3. Allow **guest media upload** on edit links?
4. Should a signed-out viewer be asked to **join with a name** on view-only links too (for the presence list), or stay anonymous?
5. Should share pages be **indexable** (no, recommended) and should previews show the **first lines** of the note in chat apps (title only is safer)?
6. Which voice engine for dictation (browser speech, or an open-source model such as Whisper in the browser)? Same engine as the owner page.

## 7. Mockup boards

Boards `WsS01` to `WsS16` (light and dark) on the canvas show every state above. See the board list in the report.
