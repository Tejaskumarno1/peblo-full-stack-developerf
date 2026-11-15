# Peblo: issues and missing features (working checklist)

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
- [x] N1. Taking a note out of a folder often fails: new folders default to "Also collect notes tagged #firstword", so a tagged note stays in the folder after "Take out of folder" (`inFolder` in `folders.js`). Probable root of "can't segregate".
- [x] N2. Folders collect notes you never put in them: "Project Alpha" and "Project Beta" both collect `#project`, so one note shows in both and counts disagree.
- [ ] N3. A note can be in only one folder.
- [ ] N4. Folders are linked to notes by name; renaming sends one request per note and a failure leaves notes split between old and new names.
- [ ] N5. Subfolders go one level deep; "Include sub-folders" is off by default so a parent does not show its children's notes.
- [ ] N6. Folder row is one sideways-scrolling strip of chips; no search, collapse or reorder; breaks down past about 8 folders.
- [x] N7. No drag-and-drop of a note onto a folder; only menu "Move to folder" or select mode.
- [x] N8. Folder rename/delete had no visible control (double-click or right-click only). Fixed: the open-folder header has Edit (and a New note button).
- [x] N9. Opening a folder gave no way to create a note in it, and new notes did not land in it. Fixed.
- [x] N10. Archive and Trash stayed filtered by the last open folder and looked empty. Fixed.
- [ ] N11. The open folder is not in the URL; refresh or Back loses it; cannot link to a folder.
- [ ] N12. Smart folders support AND only; no OR, no text/content rule, cannot be made from a search.
- [ ] N13. Only six folder colours; no icons.
- [ ] N14. Inbox is a hidden `inbox` tag shown as a folder; behaviour not explained.

### B. Tabs
- [x] N15. Closing the last tab left the last note showing. Fixed (also stops the list reopening a note by itself, keeps the tab strip visible, drops tabs of deleted/trashed/archived notes).
- [x] N16. Back/forward history and the "reopen closed tab" list live in memory only; a refresh wipes them.
- [x] N17. Open tabs are saved per browser, not per account; another account on the same machine inherits them.
- [x] N18. A draft has no tab; an unsaved "New note" is invisible in the strip and the list.
- [x] N19. No Ctrl+W (close tab) and no Ctrl+N (new note) in this page's code.
- [x] N20. Many tabs: no overflow menu, no drag to reorder, no "close to the right" or "close all".
- [x] N21. Tab accessibility: nested close button inside the tab; arrow keys do not move between tabs.

### C. Saving and data safety
- [x] N22. A failed save is never retried and there is no Retry button (status says "Couldn't save"); autosave only reruns when you type more. Orbit has Retry; Soft does not.
- [x] N23. Closing the app with a save waiting may lose it: the exit save is a normal request with no `keepalive`.
- [x] N24. The "Saved to your account" text is visually hidden; most of the time you see nothing.
- [x] N25. No offline or "connection lost" warning; the list does not say it is stale.
- [x] N26. Autosave waits 1.5 seconds (long window for a crash).
- [ ] N27. After a merge with someone else's edit the editor reloads and may jump the cursor and scroll. *(check)*
- [ ] N28. Draft creation changes the note id while the old id's pending save is still being flushed; could in theory create a duplicate note. *(check)*

### D. Writing and typing experience
- [x] N29. The "···" menu does nothing on a new draft (renders only for saved notes): no folder, share or text size until first save.
- [x] N30. The title box does not wrap (long titles cut off); Enter in the title does not move to the body.
- [x] N31. Untitled notes pile up; placeholder says "Untitled note", list says "Untitled"; no title suggested from the first line.
- [ ] N32. Text size and page width change by cycling through "···" menu items; options are not visible first.
- [x] N33. The "···" menu has about 16 items in one flat list with no separators.
- [ ] N34. "Preview" is redundant in a WYSIWYG editor (only makes the note read-only).
- [ ] N35. Text colour, alignment and background may not survive: notes are stored as Markdown and callouts are encoded as quotes. *(check)*
- [x] N36. Outline treats `#` lines inside code blocks as headings, stops at three levels and 20 items; jump-to-heading finds the first heading with the same text.
- [ ] N37. The Outline card only appears with two or more headings.
- [ ] N38. Word count counts symbols (Markdown characters, table borders).
- [ ] N39. Soft has no read-only lock, icon, or favourites, which Orbit has; styles are unequal.

### E. The notes list
- [ ] N40. Every note's full text is loaded into the list (sidebar and list both fetch all notes with content); slow for large accounts, no virtualisation.
- [x] N41. Date grouping stops at Today / This week / Earlier; no month or year.
- [ ] N42. Group by tag uses only a note's first tag.
- [x] N43. Rows have no right-click menu or hover actions (pin, move, duplicate, delete).
- [~] N44 (arrow keys done; shift-click range still open). No arrow-key navigation in the list; no shift-click range select in select mode.
- [ ] N45. Rows show only one tag and a relative time; the created date is shown nowhere.
- [ ] N46. Saved searches are per browser and capped at 8.
- [ ] N47. Tag filtering is hard to find; the any/all setting is never changed in `SoftNotes.jsx`. *(check)*

### F. Deleting, pinning, sharing and extras
- [x] N48. Deleting uses `window.confirm`; the project already has an Undo toast for deletes that this page does not use.
- [ ] N49. "Empty Trash" sends one delete per note; no restore-all; no note of how long the Trash keeps notes.
- [ ] N50. The 3-pin limit is enforced only on this screen.
- [x] N51. "Copy link to note" uses `window.location.origin`; in the desktop app that is a private 127.0.0.1 address with a random port.
- [ ] N52. Smaller: "Ask about this note" leaves the page; "Linked tasks" shows 8 with no "show more"; "Mentioned in" is title-text matching and rescans every note on each title keystroke; version history lists 8; toasts share one timer; PDF export uses a screenshot approach that can blur or split long notes *(check)*.

---

## 2. Themes and appearance: 25 issues
- [x] T1. Light/Dark/Midnight saved only in `localStorage`; style is synced to the account but theme is not.
- [ ] T2. Account settings do not reach other devices: when both have a value the local copy wins (except week start and folders).
- [x] T3. First run is always Light; ignores the OS dark setting unless "System" is chosen.
- [ ] T4. Each style (Soft, River, Orbit, plus Studio/Console) has its own dark/midnight CSS; every fix must be repeated.
- [ ] T5. Hard-coded colours ignore the theme (`.theme-dark .soft .cp-chip.ok` `#18302A`, Inbox dot `#FFB48C`, overlay `rgba(58,42,26,.18)`).
- [ ] T6. Folder colours are the same six pastels in dark mode.
- [ ] T7. Theme cards in the old settings window are clickable `div`s, not buttons (no keyboard access).
- [ ] T8. Contrast failures: River home meeting text recorded at 2.75:1 (needs 4.5:1).
- [ ] T9. Text size is set in three places (account `fontSize`, Notes setting, "···" menu).
- [ ] T10. Density is set in two places (global Compact mode, notes-list Cozy/Compact).
- [ ] T11. Wrong theme may flash at startup (dark class added in an effect after first render). *(check)*
- [ ] T12. Changing style saves to the account with `.catch(console.error)`; failure is silent.
- [ ] T13. Accent colour picker exists only in the old settings window, not Soft/River/Orbit. *(check)*
- [ ] T14. River and Orbit settings are the Soft page re-coloured, not native.
- [ ] T15. Desktop screens are a fixed 1440x900 canvas that is scaled: tiny text in small windows, huge in big ones.
- [ ] T16. Midnight is pure black with no step between page and card. *(check)*
- [ ] T17. White-background images glare in dark notes; nothing dims them. *(check)*
- [ ] T18. Editor dark detection (`dark` / `themeOverride`) is separate from the page and can disagree. *(check)*
- [ ] T19. Names differ: code says Paper/Graphite/Midnight, UI says Light/Dark/Midnight.
- [ ] T20. No preview before applying a theme.
- [ ] T21. Print and PDF export ignore the chosen theme.
- [ ] T22. Quick-capture window follows the theme only through a storage event; blocked storage breaks it.
- [ ] T23. Switching style swaps the whole screen; unsaved text relies on the autosave flush.
- [ ] T24. "Look and feel" has only Appearance and Notes pages; no home for fonts, motion, contrast.
- [ ] T25. Timezone is a short list of abbreviations (UTC, EST, PST, IST, CET): ambiguous and wrong for most places.

---

## 3. Team members and sharing: 25 issues
- [ ] M1. No member concept: a collaborator is a session id plus a typed name.
- [ ] M2. Anyone can type any name; guests can pose as a colleague.
- [ ] M3. Roles belong to a browser session; clearing storage or switching browser loses edit rights and cannot be re-granted to a person.
- [ ] M4. Blocking blocks a session; a private window is a new session. *(check)*
- [ ] M5. Only the link (plus optional waiting room) protects a note; no password option.
- [ ] M6. Link expiry is only 1/7/30/90 days or never; no custom date or time.
- [ ] M7. Guest names live in a server memory map (`viewerNames`); a restart loses them and several instances would not share it.
- [ ] M8. Declined guests are deleted after a day; no record of who asked and was refused.
- [ ] M9. Only the note's owner manages roles or revokes; no co-owners or admins.
- [ ] M10. An edit link is all-or-nothing until someone has joined; cannot set a person's role in advance.
- [ ] M11. Edit requests and "extend link" requests show only when the share dialog is opened. *(check)*
- [ ] M12. Sharing is per note or task only; not folders, tags or smart folders.
- [ ] M13. "Shared links" settings shows links and live viewers but not who opened a link last week.
- [ ] M14. Guest comments show unverified names.
- [ ] M15. Simultaneous edits to the same sentence may be kept twice (`keepBoth`). *(check)*
- [ ] M16. Folder, pin and colour are properties of the note, so an editor changes them for everyone. *(check)*
- [ ] M17. Cursor colour comes from a hash of the id; two people can share a colour.
- [ ] M18. "Switch account" is local multi-account and is easily mistaken for team accounts.
- [ ] M19. API tokens and connected AI apps are the only non-human "members"; scope but no per-note limits. *(check)*
- [ ] M20. Per-guest role rows use raw SQL (`$executeRawUnsafe`), bypassing the schema; migrations can drift from the code.
- [ ] M21. No transfer of ownership or leave; deleting an owner's account removes shared notes.
- [ ] M22. Shared notes show no "last edited by" in the main list (`EditedBy` is in the editor only).
- [ ] M23. A link copied from the desktop app is private (127.0.0.1) unless a public address is set; the dialog warns but cannot fix it.
- [ ] M24. "Copy link to note" gives the owner's own address that nobody else can open.
- [ ] M25. No notification (email or in-app) when something is shared with you; no inbox.

---

## 4. Missing basic features

### Themes and appearance (25)
- [x] FT1. Save the chosen theme to the account.
- [x] FT2. Follow the system theme by default on first run.
- [ ] FT3. Schedule dark mode (for example after sunset).
- [ ] FT4. Custom accent colour in every style.
- [ ] FT5. Hex colour picker.
- [ ] FT6. High-contrast mode.
- [ ] FT7. "Reduce motion" switch.
- [ ] FT8. Colour-blind-friendly palette.
- [ ] FT9. Font choice (serif, sans, mono, dyslexia-friendly).
- [ ] FT10. Line height and letter spacing controls.
- [ ] FT11. One text-size control in one place.
- [ ] FT12. Live preview before applying a theme.
- [ ] FT13. "Reset appearance to default".
- [ ] FT14. Light and dark chosen separately per style.
- [ ] FT15. UI zoom or scale control.
- [ ] FT16. Remember sidebar width and collapsed state.
- [ ] FT17. Code-block syntax themes.
- [ ] FT18. Folder colours that adapt to dark mode.
- [ ] FT19. Dim images in dark mode.
- [ ] FT20. Keyboard shortcut to toggle dark mode.
- [ ] FT21. Custom note cover or colour.
- [ ] FT22. Import and export a theme.
- [ ] FT23. A theme for printing and exporting.
- [ ] FT24. Tray and app icon that match the theme (desktop).
- [ ] FT25. A proper timezone picker.

### Team members and sharing (25)
- [ ] FM1. Create a team or workspace.
- [ ] FM2. Invite by email.
- [ ] FM3. Accept or decline an invitation.
- [ ] FM4. Roles: owner, admin, editor, commenter, viewer.
- [ ] FM5. Members page: list, change role, remove.
- [ ] FM6. Leave a team and transfer ownership.
- [ ] FM7. Shared folders or notebooks.
- [ ] FM8. Per-note permissions for named people.
- [ ] FM9. "Shared with me" list.
- [ ] FM10. Request access ("ask to edit").
- [ ] FM11. Password-protected links.
- [ ] FM12. Link limits: allow or block download and copy.
- [ ] FM13. Per-person expiry.
- [ ] FM14. Revoke all links at once.
- [ ] FM15. `@name` mentions that notify people.
- [ ] FM16. Comment threads with resolve and notifications.
- [ ] FM17. Assign tasks to members.
- [ ] FM18. Shared task board.
- [ ] FM19. Activity feed.
- [ ] FM20. Audit log of who changed what.
- [ ] FM21. Email and in-app notifications.
- [ ] FM22. Real names and avatars on live cursors.
- [ ] FM23. Groups.
- [ ] FM24. Sign-in restrictions by company domain, or SSO.
- [ ] FM25. Admin view with team trash, retention and export.

---

## Notes for starting work
- Quick wins with no database change: N22, N23, N24, N29, N30, N48, N51/N24-M24, T1, T3, T9, T10, FT1, FT2.
- Needs a plan first (new schema): everything in FM1 to FM25 and M1 to M10. Add the next `server/prisma/sql/NNN_*.sql` and update `schema.prisma`; scope every query by `userId`.
- Rules from `CLAUDE.md` to keep in mind: update `docs/memory/` with every behaviour change; do not add responsive breakpoints to desktop screens; emit `notes_changed` on new note write paths.
- Fixed and tested (client build, `client/src/soft/folders.test.mjs`, `e2e/notes-mock.mjs` with a fake API): N1, N2, N8-N10, N15-N18, N20, N21, N22-N26, N29-N31, N33, N36, N41, N48, N51, T1, T3, FT1, FT2. Partly done: N52 (linked-tasks 'show all', deferred mentions scan, shared toast timer). Not started: the rest, and all of the team features (M1-M25, FM1-FM25) which need a database change.
- Earlier list: N1, N2, N8, N9, N10, N15, N22, N23, N24, N29, N30, N31, N48, N51 (files: `client/src/soft/SoftNotes.jsx`, `NoteTabs.jsx`, `notespanel.css`). Built, not yet tested in a browser.

- Fixes round 2 (branch feat-fixes2): R24 last typing on keyboard note switch, R38 dialogs in spaces.jsx and org dialogs, R39 folder card "..." menu, R41 in-app confirm in the Soft notes page, R46 hard-coded colours in soft2/dialogs/orgpages css, accent text colour on River and Orbit, mention chips in compare and exports, editor dark flag with Auto theme, own notification kinds (member_removed, team_reopened, org_deleted), org purge job (off by default, not run). See docs/memory/03-client.md and 04-ui-styles.md.
