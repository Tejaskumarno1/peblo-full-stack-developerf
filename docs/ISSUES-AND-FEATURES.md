# Peblo: issues and missing features (working checklist)

**Status summary** (reconciled against the merged code of R1-R4 on 2026-11-17; [x] done, [~] partly done, [ ] open; each item names the file or the passing check)

| Section | Items | Done [x] | Partly [~] | Open [ ] |
|---|---|---|---|---|
| 1. Notes page (N) | 52 | 45 | 4 | 3 |
| 2. Themes (T) | 25 | 19 | 2 | 4 |
| 3. Members and sharing (M) | 25 | 12 | 6 | 7 |
| 4a. Missing: themes (FT) | 25 | 15 | 4 | 6 |
| 4b. Missing: team (FM) | 25 | 20 | 5 | 0 |
| **Total** | **152** | **111** | **21** | **20** |

Older notes further down (history of each round, "Still true", "Not started") predate this reconciliation; the boxes are the current state.

Found by reading the code (no live run). Items marked *(check)* are inferred and still need confirming before work starts.
Tick a box when the item is done and verified. Scope notes: the notes-page list covers the **Soft** style only; River and Orbit have their own notes screens that were not reviewed.

**Contents**
1. Notes page: 52 issues
2. Themes and appearance: 25 issues
3. Team members and sharing: 25 issues
4. Missing basic features: themes (25) and team (25)

Key finding: there is no team, workspace, member, role or invite model in the database. The only collaboration is share links, where a guest is a browser session with a typed display name.

---

## 1. Notes page (Soft): 52 issues

### A. Folders and organising notes
- [x] N1. Taking a note out of a folder often fails: new folders default to "Also collect notes tagged #firstword", so a tagged note stays in the folder after "Take out of folder" (`inFolder` in `folders.js`). Probable root of "can't segregate". — **Merged check 2026-11-17:** `soft/folders.js` (`inFolder`: a note taken out stays out)
- [x] N2. Folders collect notes you never put in them: "Project Alpha" and "Project Beta" both collect `#project`, so one note shows in both and counts disagree. — **Merged check 2026-11-17:** `soft/folders.js` (collect-by-tag is opt-in)
- [ ] N3. A note can be in only one folder. — **Merged check 2026-11-17:** open: `meta.folder` is still one string per note
- [x] N4. Folders are linked to notes by name; renaming sends one request per note and a failure leaves notes split between old and new names. — **Merged check 2026-11-17:** `server/src/routes/notesBulk.ts` POST /notes/folders/rename and /folders/clear (one transaction), `soft/notesBulkApi.js`; smoke "R2 folders" passes on a real database
- [x] N5. Subfolders go one level deep; "Include sub-folders" is off by default so a parent does not show its children's notes. — **Merged check 2026-11-17:** `soft/folders.js` (sub-folders on by default, fixes3)
- [~] N6. Folder row is one sideways-scrolling strip of chips; no search, collapse or reorder; breaks down past about 8 folders. — **Merged check 2026-11-17:** folder cards grid exists (`SoftNotes.jsx` `setCards`, R39 card menu); missing: folder search and reorder
- [x] N7. No drag-and-drop of a note onto a folder; only menu "Move to folder" or select mode. — **Merged check 2026-11-17:** `SoftNotes.jsx` drag tray "Drop on a folder"
- [x] N8. Folder rename/delete had no visible control (double-click or right-click only). Fixed: the open-folder header has Edit (and a New note button). — **Merged check 2026-11-17:** `SoftNotes.jsx` open-folder header (`np-fhead`, `folder-new-note`)
- [x] N9. Opening a folder gave no way to create a note in it, and new notes did not land in it. Fixed. — **Merged check 2026-11-17:** `SoftNotes.jsx` open-folder header (`np-fhead`, `folder-new-note`)
- [x] N10. Archive and Trash stayed filtered by the last open folder and looked empty. Fixed. — **Merged check 2026-11-17:** `SoftNotes.jsx` open-folder header (`np-fhead`, `folder-new-note`)
- [x] N11. The open folder is not in the URL; refresh or Back loses it; cannot link to a folder. — **Merged check 2026-11-17:** `SoftNotes.jsx` `setFSel` pushes `?folder=<id>`, popstate listener; e2e "R2" checks
- [x] N12. Smart folders support AND only; no OR, no text/content rule, cannot be made from a search. — **Merged check 2026-11-17:** `soft/folders.js` `smartMatch` (OR and text rule)
- [x] N13. Only six folder colours; no icons. — **Merged check 2026-11-17:** `soft/notespanel.css` `.fc` colours and folder icons
- [x] N14. Inbox is a hidden `inbox` tag shown as a folder; behaviour not explained. — **Merged check 2026-11-17:** `SoftNotes.jsx` inbox help (fixes3)

### B. Tabs
- [x] N15. Closing the last tab left the last note showing. Fixed (also stops the list reopening a note by itself, keeps the tab strip visible, drops tabs of deleted/trashed/archived notes). — **Merged check 2026-11-17:** `soft/NoteTabs.jsx`
- [x] N16. Back/forward history and the "reopen closed tab" list live in memory only; a refresh wipes them. — **Merged check 2026-11-17:** `soft/NoteTabs.jsx`
- [x] N17. Open tabs are saved per browser, not per account; another account on the same machine inherits them. — **Merged check 2026-11-17:** `soft/NoteTabs.jsx`
- [x] N18. A draft has no tab; an unsaved "New note" is invisible in the strip and the list. — **Merged check 2026-11-17:** `soft/NoteTabs.jsx`
- [~] N19. No Ctrl+W (close tab) and no Ctrl+N (new note) in this page's code. — **Merged check 2026-11-17:** Alt+W / Alt+N in `soft/NoteTabs.jsx:157-158`; missing: Ctrl+W and Ctrl+N are not bound on this page
- [x] N20. Many tabs: no overflow menu, no drag to reorder, no "close to the right" or "close all". — **Merged check 2026-11-17:** `soft/NoteTabs.jsx`
- [x] N21. Tab accessibility: nested close button inside the tab; arrow keys do not move between tabs. — **Merged check 2026-11-17:** `soft/NoteTabs.jsx`

### C. Saving and data safety
- [x] N22. A failed save is never retried and there is no Retry button (status says "Couldn't save"); autosave only reruns when you type more. Orbit has Retry; Soft does not. — **Merged check 2026-11-17:** `utils/noteSync.js`, `hooks/index.js` `useAutoSave`, `SoftNotes.jsx` save status
- [x] N23. Closing the app with a save waiting may lose it: the exit save is a normal request with no `keepalive`. — **Merged check 2026-11-17:** `utils/noteSync.js`, `hooks/index.js` `useAutoSave`, `SoftNotes.jsx` save status
- [x] N24. The "Saved to your account" text is visually hidden; most of the time you see nothing. — **Merged check 2026-11-17:** `utils/noteSync.js`, `hooks/index.js` `useAutoSave`, `SoftNotes.jsx` save status
- [x] N25. No offline or "connection lost" warning; the list does not say it is stale. — **Merged check 2026-11-17:** `utils/noteSync.js`, `hooks/index.js` `useAutoSave`, `SoftNotes.jsx` save status
- [x] N26. Autosave waits 1.5 seconds (long window for a crash). — **Merged check 2026-11-17:** `utils/noteSync.js`, `hooks/index.js` `useAutoSave`, `SoftNotes.jsx` save status
- [x] N27. After a merge with someone else's edit the editor reloads and may jump the cursor and scroll. *(check)* — **Merged check 2026-11-17:** `NotesExtras.jsx` `captureCaret` / `restoreCaret`, used in `SoftNotes.jsx:546`
- [x] N28. Draft creation changes the note id while the old id's pending save is still being flushed; could in theory create a duplicate note. *(check)* — **Merged check 2026-11-17:** `SoftNotes.jsx` `draftJobs` / `draftKeyRef` and `hooks/index.js` `useAutoSave` `{ newId }`; e2e "R2" one POST for a fast-typed draft

### D. Writing and typing experience
- [x] N29. The "···" menu does nothing on a new draft (renders only for saved notes): no folder, share or text size until first save. — **Merged check 2026-11-17:** `SoftNotes.jsx`
- [x] N30. The title box does not wrap (long titles cut off); Enter in the title does not move to the body. — **Merged check 2026-11-17:** `SoftNotes.jsx`
- [x] N31. Untitled notes pile up; placeholder says "Untitled note", list says "Untitled"; no title suggested from the first line. — **Merged check 2026-11-17:** `SoftNotes.jsx`
- [x] N32. Text size and page width change by cycling through "···" menu items; options are not visible first. — **Merged check 2026-11-17:** `NotesExtras.jsx` `SegRow` (S / M / L and Narrow / Wide shown at once); e2e "R2"
- [x] N33. The "···" menu has about 16 items in one flat list with no separators. — **Merged check 2026-11-17:** `SoftNotes.jsx`
- [x] N34. "Preview" is redundant in a WYSIWYG editor (only makes the note read-only). — **Merged check 2026-11-17:** `SoftNotes.jsx`
- [ ] N35. Text colour, alignment and background may not survive: notes are stored as Markdown and callouts are encoded as quotes. *(check)* — **Merged check 2026-11-17:** open: still unverified; no test that colour, alignment or callouts survive the Markdown round trip
- [x] N36. Outline treats `#` lines inside code blocks as headings, stops at three levels and 20 items; jump-to-heading finds the first heading with the same text. — **Merged check 2026-11-17:** `SoftNotes.jsx` outline skips code fences
- [ ] N37. The Outline card only appears with two or more headings. — **Merged check 2026-11-17:** open: Orbit still needs two headings (`orbit/OrbitNotes.jsx:309`); Soft has no Outline card
- [x] N38. Word count counts symbols (Markdown characters, table borders). — **Merged check 2026-11-17:** `soft/noteStats.js`; lock and favourite in `SoftNotes.jsx`
- [x] N39. Soft has no read-only lock, icon, or favourites, which Orbit has; styles are unequal. — **Merged check 2026-11-17:** `soft/noteStats.js`; lock and favourite in `SoftNotes.jsx`

### E. The notes list
- [~] N40. Every note's full text is loaded into the list (sidebar and list both fetch all notes with content); slow for large accounts, no virtualisation. — **Merged check 2026-11-17:** light list `fields=list` (`SoftNotes.jsx`, `notesController.ts`; smoke "list shape" passes); missing: no list virtualisation
- [x] N41. Date grouping stops at Today / This week / Earlier; no month or year. — **Merged check 2026-11-17:** `soft/noteGroups.js`, row menu in `SoftNotes.jsx`
- [x] N42. Group by tag uses only a note's first tag. — **Merged check 2026-11-17:** `soft/noteGroups.js`, row menu in `SoftNotes.jsx`
- [x] N43. Rows have no right-click menu or hover actions (pin, move, duplicate, delete). — **Merged check 2026-11-17:** `soft/noteGroups.js`, row menu in `SoftNotes.jsx`
- [x] N44. No arrow-key navigation in the list; no shift-click range select in select mode. — **Merged check 2026-11-17:** arrow keys plus shift-click range (`SoftNotes.jsx:519-526` `lastPick`, `notesKeys.js`)
- [x] N45. Rows show only one tag and a relative time; the created date is shown nowhere. — **Merged check 2026-11-17:** `SoftNotes.jsx` row meta; account saved searches (`savedSearchesCore`)
- [x] N46. Saved searches are per browser and capped at 8. — **Merged check 2026-11-17:** `SoftNotes.jsx` row meta; account saved searches (`savedSearchesCore`)
- [x] N47. Tag filtering is hard to find; the any/all setting is never changed in `SoftNotes.jsx`. *(check)* — **Merged check 2026-11-17:** `NotesExtras.jsx` `TagFilterBar` with Any / All (`tag-match-any|all`)

### F. Deleting, pinning, sharing and extras
- [x] N48. Deleting uses `window.confirm`; the project already has an Undo toast for deletes that this page does not use. — **Merged check 2026-11-17:** `soft/ConfirmDialog.jsx` + Undo toast
- [x] N49. "Empty Trash" sends one delete per note; no restore-all; no note of how long the Trash keeps notes. — **Merged check 2026-11-17:** `server/src/routes/notesBulk.ts` /trash/empty, /trash/restore, /trash/info; Soft "Restore all" and retention line; smoke "R2 trash" passes
- [x] N50. The 3-pin limit is enforced only on this screen. — **Merged check 2026-11-17:** server pin limit (`notesController.ts`, smoke "pin limit")
- [x] N51. "Copy link to note" uses `window.location.origin`; in the desktop app that is a private 127.0.0.1 address with a random port. — **Merged check 2026-11-17:** `api/publicUrl` used by the copy-link action
- [~] N52. Smaller: "Ask about this note" leaves the page; "Linked tasks" shows 8 with no "show more"; "Mentioned in" is title-text matching and rescans every note on each title keystroke; version history lists 8; toasts share one timer; PDF export uses a screenshot approach that can blur or split long notes *(check)*. — **Merged check 2026-11-17:** done: inline Ask (`NoteAskPanel`), linked tasks "Show all" (`SoftNotes.jsx:1380`), deferred mention scan (`useDeferredValue`, :989), one toast timer (:930); missing: version menu still lists 8 (`SoftNotes.jsx:1417`), PDF still an html2pdf screenshot (`utils/exportNote.js:44`)

---

## 2. Themes and appearance: 25 issues
- [x] T1. Light/Dark/Midnight saved only in `localStorage`; style is synced to the account but theme is not. — **Merged check 2026-11-17:** `context/AuthContext.jsx` theme saved on the account
- [x] T2. Account settings do not reach other devices: when both have a value the local copy wins (except week start and folders). — **Merged check 2026-11-17:** `context/AuthContext.jsx:118` the account copy wins (R42)
- [x] T3. First run is always Light; ignores the OS dark setting unless "System" is chosen. — **Merged check 2026-11-17:** `client/index.html` pre-paint + System default
- [ ] T4. Each style (Soft, River, Orbit, plus Studio/Console) has its own dark/midnight CSS; every fix must be repeated. — **Merged check 2026-11-17:** open: dark / midnight still defined per style (`soft.css`, `river.css`, `orbit.css`, `tokens.css`)
- [~] T5. Hard-coded colours ignore the theme (`.theme-dark .soft .cp-chip.ok` `#18302A`, Inbox dot `#FFB48C`, overlay `rgba(58,42,26,.18)`). — **Merged check 2026-11-17:** Soft dialogs and panels use `--s-*` variables (`soft/dialogs.css`); missing: hard-coded backdrops remain in `components/docfile.css:122`, `components/editedby.css:22`, `pages/shared-page.css`
- [x] T6. Folder colours are the same six pastels in dark mode. — **Merged check 2026-11-17:** `soft/notespanel.css:206-207` dark folder variants
- [x] T7. Theme cards in the old settings window are clickable `div`s, not buttons (no keyboard access). — **Merged check 2026-11-17:** `button role="radio"` theme cards in `soft/settings/sections1.jsx:194` and `components/SettingsModal.jsx` (R1)
- [x] T8. Contrast failures: River home meeting text recorded at 2.75:1 (needs 4.5:1). — **Merged check 2026-11-17:** River meeting text fixed (`river/river.css`); `scripts/contrast-check.mjs` 266 checks pass
- [x] T9. Text size is set in three places (account `fontSize`, Notes setting, "···" menu). — **Merged check 2026-11-17:** one global text size (`utils/a11yPrefs.js`); note text is one setting `settings.fontSize` (Settings > Notes, and the "..." S / M / L writes the same value)
- [x] T10. Density is set in two places (global Compact mode, notes-list Cozy/Compact). — **Merged check 2026-11-17:** one density (`utils/appearance.js` `effectiveDensity`, R48)
- [x] T11. Wrong theme may flash at startup (dark class added in an effect after first render). *(check)* — **Merged check 2026-11-17:** `client/index.html` pre-paint script matches the app defaults (R43)
- [x] T12. Changing style saves to the account with `.catch(console.error)`; failure is silent. — **Merged check 2026-11-17:** `AuthContext.jsx` `setUiStyle` returns false on failure; Settings shows it (R44)
- [x] T13. Accent colour picker exists only in the old settings window, not Soft/River/Orbit. *(check)* — **Merged check 2026-11-17:** `soft/settings/AppearanceExtras.jsx` `AccentCard` (the Soft settings are used by River and Orbit too)
- [ ] T14. River and Orbit settings are the Soft page re-coloured, not native. — **Merged check 2026-11-17:** open: `river/RiverSettings.jsx` / Orbit wrap `SoftSettings`
- [ ] T15. Desktop screens are a fixed 1440x900 canvas that is scaled: tiny text in small windows, huge in big ones. — **Merged check 2026-11-17:** open by design: fixed 1440x900 canvas (CLAUDE.md); only the accessibility text-size zoom
- [x] T16. Midnight is pure black with no step between page and card. *(check)* — **Merged check 2026-11-17:** Midnight surfaces one step above the page (`styles/tokens.css`, `soft.css`, `river.css`, `orbit.css`; contrast-check "Midnight step")
- [x] T17. White-background images glare in dark notes; nothing dims them. *(check)* — **Merged check 2026-11-17:** dark image dimming (fixes3)
- [x] T18. Editor dark detection (`dark` / `themeOverride`) is separate from the page and can disagree. *(check)* — **Merged check 2026-11-17:** `components/BlockEditor.jsx:1260` follows the page theme, incl. Auto
- [x] T19. Names differ: code says Paper/Graphite/Midnight, UI says Light/Dark/Midnight. — **Merged check 2026-11-17:** `utils/appearance.js` `THEME_LABELS` / `themeLabel`
- [x] T20. No preview before applying a theme. — **Merged check 2026-11-17:** `utils/useThemePreview.js` (hover / focus preview); e2e "R1"
- [~] T21. Print and PDF export ignore the chosen theme. — **Merged check 2026-11-17:** print (`styles/print.css`) and the Studio PDF follow `settings.exportTheme`; missing: Soft / River / Orbit PDF (`utils/exporters.js` `toPdf`, `exportNote.js`) stay light
- [x] T22. Quick-capture window follows the theme only through a storage event; blocked storage breaks it. — **Merged check 2026-11-17:** `pages/QuickCapturePage.jsx` `useAccountAppearance` reads /profile on show
- [ ] T23. Switching style swaps the whole screen; unsaved text relies on the autosave flush. — **Merged check 2026-11-17:** open: `setUiStyle` (`AuthContext.jsx:226`) does not flush the open note first
- [x] T24. "Look and feel" has only Appearance and Notes pages; no home for fonts, motion, contrast. — **Merged check 2026-11-17:** Appearance page has Text, Accessibility, Colour and export cards (`soft/settings/AppearanceExtras.jsx`)
- [x] T25. Timezone is a short list of abbreviations (UTC, EST, PST, IST, CET): ambiguous and wrong for most places. — **Merged check 2026-11-17:** `Intl.supportedValuesOf('timeZone')` picker (`soft/settings/sections1.jsx:212`, `ProfilePage.jsx:39`)

---

## 3. Team members and sharing: 25 issues
- [x] M1. No member concept: a collaborator is a session id plus a typed name. — **Merged check 2026-11-17:** organizations, spaces and members (`server/src/routes/orgs.ts`, models in `schema.prisma`)
- [x] M2. Anyone can type any name; guests can pose as a colleague. — **Merged check 2026-11-17:** `services/collab.ts` `stampAwareness`, `share_viewers.user_id` (054); smoke "R3 FM22/M2"
- [~] M3. Roles belong to a browser session; clearing storage or switching browser loses edit rights and cannot be re-granted to a person. — **Merged check 2026-11-17:** people have roles in teams and Office notes (`NoteAccess`); missing: a link guest's role is still per session (`share_guests.session_id`)
- [ ] M4. Blocking blocks a session; a private window is a new session. *(check)* — **Merged check 2026-11-17:** open: `share_blocked` is keyed by session (`routes/share.ts:129`)
- [x] M5. Only the link (plus optional waiting room) protects a note; no password option. — **Merged check 2026-11-17:** link password (`046_share_password.sql`, `routes/share.ts`)
- [x] M6. Link expiry is only 1/7/30/90 days or never; no custom date or time. — **Merged check 2026-11-17:** `POST /share/:kind/:id {expiresAt}` (`routes/share.ts`); smoke "R3 M6"
- [x] M7. Guest names live in a server memory map (`viewerNames`); a restart loses them and several instances would not share it. — **Merged check 2026-11-17:** guest names are stored in `share_viewers` / `share_guests`; `viewerNames` is now only a 5-minute cache of account names (`routes/share.ts:374,516`)
- [x] M8. Declined guests are deleted after a day; no record of who asked and was refused. — **Merged check 2026-11-17:** declined guests kept 30 days (`routes/share.ts` prunePresence); smoke "R3 M8"
- [~] M9. Only the note's owner manages roles or revokes; no co-owners or admins. — **Merged check 2026-11-17:** team leads / admins manage team notes (`utils/scope.ts`); missing: a link's guest roles are still owner-only
- [~] M10. An edit link is all-or-nothing until someone has joined; cannot set a person's role in advance. — **Merged check 2026-11-17:** Office access can be given to named members ahead of time (`soft/OfficeAccess.jsx`, `controllers/notesAccess.ts`); missing: link roles only after someone joined
- [x] M11. Edit requests and "extend link" requests show only when the share dialog is opened. *(check)* — **Merged check 2026-11-17:** `services/shareExtras.ts` notifies the owner (`share_request`); smoke "R3 M11"
- [ ] M12. Sharing is per note or task only; not folders, tags or smart folders. — **Merged check 2026-11-17:** open: links are per note or task only
- [x] M13. "Shared links" settings shows links and live viewers but not who opened a link last week. — **Merged check 2026-11-17:** `GET /share/:kind/:id/opens` (`routes/share.ts`, `share_reads.user_id/visits`); smoke "R3 M13"
- [ ] M14. Guest comments show unverified names. — **Merged check 2026-11-17:** open: comment author names are still typed (`services/comments.ts` only marks the owner)
- [ ] M15. Simultaneous edits to the same sentence may be kept twice (`keepBoth`). *(check)* — **Merged check 2026-11-17:** open: `keepBoth` merge (`notesController.ts:490`) not verified
- [ ] M16. Folder, pin and colour are properties of the note, so an editor changes them for everyone. *(check)* — **Merged check 2026-11-17:** open: folder and pin are still note meta
- [x] M17. Cursor colour comes from a hash of the id; two people can share a colour. — **Merged check 2026-11-17:** per-room colours `PEER_COLORS` in `services/collab.ts`, `utils/peerCursors.js` `assignPeerColors`; smoke "R3 FM22/M2"
- [ ] M18. "Switch account" is local multi-account and is easily mistaken for team accounts. — **Merged check 2026-11-17:** open: "Switch account" is still local multi-account
- [ ] M19. API tokens and connected AI apps are the only non-human "members"; scope but no per-note limits. *(check)* — **Merged check 2026-11-17:** open: tokens have scopes but no per-note limits
- [~] M20. Per-guest role rows use raw SQL (`$executeRawUnsafe`), bypassing the schema; migrations can drift from the code. — **Merged check 2026-11-17:** Prisma models now cover the workspace tables 035-055 (`schema.prisma`: R4, plus `OrgGroup` / `OrgGroupMember` added at the merge); missing: `share_*` tables and per-guest roles still use `$executeRawUnsafe` (`routes/share.ts`)
- [~] M21. No transfer of ownership or leave; deleting an owner's account removes shared notes. — **Merged check 2026-11-17:** ownership transfer (owner role change, `orgs.ts:353`), leave (`orgs.ts:402`), note handover (`teamAdmin.ts:61`), sole-owner guard (smoke); missing: deleting a member's account still cascades their team notes (`routes/auth.ts:286`)
- [x] M22. Shared notes show no "last edited by" in the main list (`EditedBy` is in the editor only). — **Merged check 2026-11-17:** "edited by" in team rows (`SoftNotes.jsx:104`)
- [~] M23. A link copied from the desktop app is private (127.0.0.1) unless a public address is set; the dialog warns but cannot fix it. — **Merged check 2026-11-17:** a public address setting is used when set (`api/publicUrl`, `ShareDialog.jsx:59`); missing: without it the desktop link is still private
- [x] M24. "Copy link to note" gives the owner's own address that nobody else can open. — **Merged check 2026-11-17:** copy link uses the public address (`api/publicUrl`, N51)
- [x] M25. No notification (email or in-app) when something is shared with you; no inbox. — **Merged check 2026-11-17:** `note_shared` notifications (`controllers/notesAccess.ts:103`, `teamShare.ts:41`) and the notifications inbox

---

## 4. Missing basic features

### Themes and appearance (25)
- [x] FT1. Save the chosen theme to the account. — **Merged check 2026-11-17:** `AuthContext.jsx`, `client/index.html`
- [x] FT2. Follow the system theme by default on first run. — **Merged check 2026-11-17:** `AuthContext.jsx`, `client/index.html`
- [x] FT3. Schedule dark mode (for example after sunset). — **Merged check 2026-11-17:** "Auto by time" `ScheduleRow` (`AppearanceExtras.jsx`), `normalizeSchedule` (`utils/appearance.js`)
- [x] FT4. Custom accent colour in every style. — **Merged check 2026-11-17:** `AccentCard` in every style (`AppearanceExtras.jsx`)
- [x] FT5. Hex colour picker. — **Merged check 2026-11-17:** `<input type="color">` plus hex field (`AppearanceExtras.jsx:37`)
- [x] FT6. High-contrast mode. — **Merged check 2026-11-17:** high contrast in every style (`styles/a11y.css`, R47)
- [x] FT7. "Reduce motion" switch. — **Merged check 2026-11-17:** reduce motion (`utils/a11yPrefs.js`; OS setting honoured in `a11y.css`)
- [x] FT8. Colour-blind-friendly palette. — **Merged check 2026-11-17:** `settings.colourBlind` -> `html[data-cb]` (`styles/appearance-extra.css`)
- [x] FT9. Font choice (serif, sans, mono, dyslexia-friendly). — **Merged check 2026-11-17:** `TextCard` note font sans / serif / mono / easy (`AppearanceExtras.jsx`)
- [~] FT10. Line height and letter spacing controls. — **Merged check 2026-11-17:** line height (`settings.lineHeight`); missing: letter spacing
- [x] FT11. One text-size control in one place. — **Merged check 2026-11-17:** one global text size (`a11yPrefs.js`) and one note text setting (`settings.fontSize`)
- [x] FT12. Live preview before applying a theme. — **Merged check 2026-11-17:** `utils/useThemePreview.js`
- [ ] FT13. "Reset appearance to default". — **Merged check 2026-11-17:** open: only the accent has a Reset; no "reset appearance"
- [ ] FT14. Light and dark chosen separately per style. — **Merged check 2026-11-17:** open: one theme for all styles
- [~] FT15. UI zoom or scale control. — **Merged check 2026-11-17:** text size S-XL zooms the whole UI (`utils/a11yPrefs.js`); missing: a free UI scale
- [ ] FT16. Remember sidebar width and collapsed state. — **Merged check 2026-11-17:** open: `peblo-sidebar-collapsed` is only listed in `AuthContext.jsx:14`; nothing stores width or collapse
- [~] FT17. Code-block syntax themes. — **Merged check 2026-11-17:** code blocks follow the theme (`--pb-code-*`, `styles/appearance-extra.css`); missing: token colours (no `createHighlighter` in `BlockEditor.jsx`)
- [x] FT18. Folder colours that adapt to dark mode. — **Merged check 2026-11-17:** fixes3 (`notespanel.css`, dark image dimming, `components/ThemeShortcut.jsx`)
- [x] FT19. Dim images in dark mode. — **Merged check 2026-11-17:** fixes3 (`notespanel.css`, dark image dimming, `components/ThemeShortcut.jsx`)
- [x] FT20. Keyboard shortcut to toggle dark mode. — **Merged check 2026-11-17:** fixes3 (`notespanel.css`, dark image dimming, `components/ThemeShortcut.jsx`)
- [ ] FT21. Custom note cover or colour. — **Merged check 2026-11-17:** open: notes have an emoji, no cover or colour
- [ ] FT22. Import and export a theme. — **Merged check 2026-11-17:** open
- [~] FT23. A theme for printing and exporting. — **Merged check 2026-11-17:** `settings.exportTheme` drives print and the Studio PDF; missing: Soft / River / Orbit PDF stay light (`utils/exporters.js`)
- [ ] FT24. Tray and app icon that match the theme (desktop). — **Merged check 2026-11-17:** open: tray / app icon do not follow the theme (`electron/main.cjs`)
- [x] FT25. A proper timezone picker. — **Merged check 2026-11-17:** `Intl.supportedValuesOf('timeZone')` (`sections1.jsx:212`)

### Team members and sharing (25)
- [x] FM1. Create a team or workspace. — **Merged check 2026-11-17:** organizations and spaces (`routes/workspaces.ts`, `routes/orgs.ts`)
- [x] FM2. Invite by email. — **Merged check 2026-11-17:** `POST /orgs/:orgId/invites` (`routes/orgs.ts:66`); smoke "invite"
- [~] FM3. Accept or decline an invitation. — **Merged check 2026-11-17:** accept (`routes/orgs.ts:205`, `pages/InvitePage.jsx`); missing: no Decline action
- [~] FM4. Roles: owner, admin, editor, commenter, viewer. — **Merged check 2026-11-17:** org roles owner / admin / member / guest and team lead / member / viewer (`utils/access.ts`); missing: no commenter role
- [x] FM5. Members page: list, change role, remove. — **Merged check 2026-11-17:** members list, role change, remove (`routes/orgs.ts:36,346,390`, `soft/settings/OrgPages.jsx`)
- [x] FM6. Leave a team and transfer ownership. — **Merged check 2026-11-17:** leave (`routes/orgs.ts:402`, `/spaces/:id/leave`), make another owner (`orgs.ts:353-354`)
- [x] FM7. Shared folders or notebooks. — **Merged check 2026-11-17:** team spaces are shared notebooks (`Space`, `x-peblo-space` scope)
- [x] FM8. Per-note permissions for named people. — **Merged check 2026-11-17:** per-note access for named people (`NoteAccess`, `GET/PUT /notes/:id/access`)
- [x] FM9. "Shared with me" list. — **Merged check 2026-11-17:** "Shared with me" (`SoftNotes.jsx:1143`)
- [x] FM10. Request access ("ask to edit"). — **Merged check 2026-11-17:** edit requests (`043_share_edit_requests.sql`, `services/shareExtras.ts`)
- [x] FM11. Password-protected links. — **Merged check 2026-11-17:** link password (`046_share_password.sql`)
- [x] FM12. Link limits: allow or block download and copy. — **Merged check 2026-11-17:** `allowCopy` / `no_copy` (054, `routes/share.ts`, `services/agentView.ts`, `SharedPage.jsx`); smoke "R3 FM12"
- [~] FM13. Per-person expiry. — **Merged check 2026-11-17:** org guests have an end date that can be extended (smoke "guest expiry"); missing: per-person expiry on links
- [~] FM14. Revoke all links at once. — **Merged check 2026-11-17:** org policy `publicShares=false` revokes every link at once (smoke); missing: a personal "stop all my links"
- [x] FM15. `@name` mentions that notify people. — **Merged check 2026-11-17:** `services/mentions.ts`; smoke "mentions"
- [x] FM16. Comment threads with resolve and notifications. — **Merged check 2026-11-17:** threads with `parent_id`, `resolved` status, owner notified (`services/comments.ts`, `routes/collab.ts:150`)
- [x] FM17. Assign tasks to members. — **Merged check 2026-11-17:** `Todo.assignee` (`schema.prisma`), `soft/GroupPick.jsx`
- [x] FM18. Shared task board. — **Merged check 2026-11-17:** board columns (`050_board_columns.sql`, `BoardColumns`)
- [x] FM19. Activity feed. — **Merged check 2026-11-17:** task activity (`048_task_talk.sql`, `TaskActivity`)
- [x] FM20. Audit log of who changed what. — **Merged check 2026-11-17:** `GET /orgs/:orgId/audit` (`routes/orgs.ts:432`)
- [x] FM21. Email and in-app notifications. — **Merged check 2026-11-17:** `user_notifications`, `notifyUsers`; email for invites
- [x] FM22. Real names and avatars on live cursors. — **Merged check 2026-11-17:** `services/collab.ts` `stampAwareness` / `MSG_IDENT`, `components/Presence.jsx`; smoke "R3 FM22"
- [x] FM23. Groups. — **Merged check 2026-11-17:** `routes/orgGroups.ts` (055), `soft/settings/OrgSections.jsx` `GroupsPage`; smoke "R3 FM23"
- [x] FM24. Sign-in restrictions by company domain, or SSO. — **Merged check 2026-11-17:** `organizations.policy.allowedDomains` (`utils/orgPolicy.ts`, `routes/orgs.ts`); smoke "R3 FM24" (no SSO)
- [~] FM25. Admin view with team trash, retention and export. — **Merged check 2026-11-17:** export (`orgs.ts:481`), closed teams, orphaned notes (`teamAdmin.ts`), lead-only team Trash (`notesBulk.ts`); missing: no retention setting for a team's Trash

---

## Notes for starting work
- Quick wins with no database change: N22, N23, N24, N29, N30, N48, N51/N24-M24, T1, T3, T9, T10, FT1, FT2.
- Needs a plan first (new schema): everything in FM1 to FM25 and M1 to M10. Add the next `server/prisma/sql/NNN_*.sql` and update `schema.prisma`; scope every query by `userId`.
- Rules from `CLAUDE.md` to keep in mind: update `docs/memory/` with every behaviour change; do not add responsive breakpoints to desktop screens; emit `notes_changed` on new note write paths.
- Fixed and tested (client build, `client/src/soft/folders.test.mjs`, `e2e/notes-mock.mjs` with a fake API): N1, N2, N8-N10, N15-N18, N20, N21, N22-N26, N29-N31, N33, N36, N41, N48, N51, T1, T3, FT1, FT2. Partly done: N52 (linked-tasks 'show all', deferred mentions scan, shared toast timer). Not started: the rest, and all of the team features (M1-M25, FM1-FM25) which need a database change.
- Earlier list: N1, N2, N8, N9, N10, N15, N22, N23, N24, N29, N30, N31, N48, N51 (files: `client/src/soft/SoftNotes.jsx`, `NoteTabs.jsx`, `notespanel.css`). Built, not yet tested in a browser.

- Fixes round 2 (branch feat-fixes2): R24 last typing on keyboard note switch, R38 dialogs in spaces.jsx and org dialogs, R39 folder card "..." menu, R41 in-app confirm in the Soft notes page, R46 hard-coded colours in soft2/dialogs/orgpages css, accent text colour on River and Orbit, mention chips in compare and exports, editor dark flag with Auto theme, own notification kinds (member_removed, team_reopened, org_deleted), org purge job (off by default, not run). See docs/memory/03-client.md and 04-ui-styles.md.

- Fixed on branch feat-fixes3 (unit tests plus `e2e/notes-mock.mjs` section 7n; server pin limit compiled only, not run): N5, N12, N13, N14, N34, N38, N39, N42, N45, N46, N50, T17, FT18, FT19, FT20. T20 (theme preview before applying) is a different item and is still open.
