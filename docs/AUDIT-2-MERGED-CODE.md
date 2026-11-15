# Re-audit of the merged code (notes, themes, teams)

Read-only audit of branch `notes-ux-fixes` (remote `supabase` work + the notes fixes). It replaces the stale parts of `ISSUES-AND-FEATURES.md`. Items marked *(unverified)* were inferred, not proved. Tick a box when fixed and tested.

## 1. Old checklist items that are already fixed or obsolete
- **Fixed in the notes page:** N1, N2, N7, N8-N10, N15-N18, N20-N26, N29-N31, N33, N36 (fences), N41, N43, N44 (arrow keys), N48, N51. N19 partly (Alt+W, Alt+N exist; Ctrl+W and Ctrl+N do not).
- **Fixed in themes:** T1, T3, T7, T25, FT1, FT2, FT25. FT6, FT7, FT15 partly (an Accessibility card exists, device-only and Soft-only).
- **Obsolete (teams now exist):** M1, FM1-FM5 (organizations, invites, roles, members page), M5/FM11 (share password), FM10 (edit requests), FM15-FM19 (task comments with mentions, activity, workload, board), FM20 (audit log), FM25 (export), M25/FM21 (notifications). M21/FM6 partly (leave org/team; no delete organization).
- **Still true:** N47 (tag any/all), T4, T5, T9, T10, T12, T13, T16-T24, M20 (new tables are raw SQL, not in schema.prisma), FM24 (no domain restriction or SSO).

## 2. Confirmed issues (R1-R49)

### Teams: authorization and integrity
- [~] R1 **(fixed in code 94ced39, NOT yet run against a database)** **HIGH** Deleting an account removes the person's team notes and tasks, and a sole organization owner's deletion leaves the org with no owner. `routes/auth.ts:274-283`, `services/accountDeletion.ts:10`.
- [~] R2 **(fixed in code 94ced39, NOT yet run against a database)** **HIGH** In a Team any writer can trash, archive or move a colleague's note (author-only check exists only for Offices). `utils/scope.ts:49-61`, `notesController.ts:530`, `notesMove.ts:24`.
- [~] R3 **(fixed in code 94ced39, NOT yet run against a database)** **HIGH** A note shared "can view" can still be trashed or moved by teammates ("manage" needs are not checked). `scope.ts:50-52`, `noteAccess.ts:57`.
- [~] R4 **(fixed in code 94ced39, NOT yet run against a database)** Read-only members can request a review, which reopens a finished task. `teamTalk.ts:22-77`.
- [~] R5 **(fixed in code 94ced39, NOT yet run against a database)** No "last lead" guard when changing team roles; an org guest can be made lead. `routes/orgs.ts:291-302`.
- [~] R6 **(fixed in code on feat-team, NOT yet run against a database)** No way to remove another person from one team (leads can only set "viewer").
- [~] R7 **(fixed in code 94ced39, NOT yet run against a database)** Guests can list every member's email, role and spaces. `orgs.ts:30-48`.
- [~] R8 **(fixed in code on feat-team, NOT yet run against a database)** A leaving member's private Office notes become unreadable to everyone; no note handover (tasks only). `orgs.ts:263-272`.
- [ ] R9 Org policy "publicShares" is not applied to existing links; per-team public-links toggle is never read; team notes cannot be shared by link yet the UI offers it. `utils/orgPolicy.ts`, `share.ts:288`.
- [~] R10 **(fixed in code on branch feat-versions, NOT yet run against a database)** Version history (restore, name) is broken for team notes (queries ignore the space). `notesController.ts:628-770`.
- [~] **(built in code on feat-realtime, NOT run against a database)** R11 Live events only reach the editing user's own room; teammates see nothing until a refetch. `index.ts:234`, `teamTalk.ts:55`.
- [~] R12 **(fixed in code 94ced39, NOT yet run against a database)** A removed member can still live-edit their own team note. `services/collab.ts:403`.
- [~] R13 (accept is now atomic, 94ced39; token in notification/URL still open) Invite token stored in plaintext in the notification, sent in a URL query, reminder not throttled, accept not atomic. `orgs.ts:48-150`.
- [~] R14 **(fixed in code 94ced39, NOT yet run against a database)** Join-link use is counted before the inserts and the org status is not checked. `orgs.ts:200-247`.
- [~] R15 **(fixed in code on feat-team, NOT yet run against a database)** Seat limit and trial are shown but never enforced. `orgs.ts:427-437`. (Seat limit and guest expiry are now enforced and a guest can be extended; the trial is still NOT enforced.)
- [~] R16 **(fixed in code on feat-team, NOT yet run against a database)** Any lead can close a team and there is no reopen. `orgs.ts:390-396`. (Reopen and a soft-closing Delete organization exist now; there is no purge job and no restore of a deleted organization.)
- [ ] R17 Tags are per user; a teammate's tag edit replaces the author's links. `notesController.ts:498`.
- [~] R18 **(fixed in code 94ced39, NOT yet run against a database)** Task assignment ignores paused orgs and expired guests. `utils/access.ts:22-65`.
- [ ] R19 Org export has no paging, includes trashed text and has no extra rate limit. `orgs.ts:331-352`.

### Notes: saving and data loss
- [x] R20 **HIGH** Switching space sends the old note's last save with the NEW space header; the save 404s and the text is lost. `soft/spaces.jsx:57-65`, `api/client.js`, `hooks/index.js`.
- [x] R21 **HIGH** "Move to team" does not flush the editor first. `soft/MoveNote.jsx:30-45`.
- [x] R22 The flush on note switch is fire-and-forget with no retry. `hooks/index.js:68-82`.
- [x] R23 (client; fixed, browser-checked) While a live connection is down typed text is neither sent nor kept; text typed during an AI request is not marked dirty. `components/BlockEditor.jsx:831-858`.
- [ ] R24 Switching notes by keyboard may drop the last 200 ms of typing *(unverified)*. `BlockEditor.jsx:881`.
- [x] R25 (client; fixed, browser-checked) Notes over about 55 KB lose their last edits when the window closes. `utils/noteSync.js:144`.
- [~] R26 **(fixed in code on feat-team (browser-checked with a fake API in e2e/notes-mock.mjs); the server part is NOT yet run against a database)** A team note shared "can view" opens editable for non-authors (the list has no userId), so saves fail forever. `SoftNotes.jsx:148,1069`.
- [~] R27 **(fixed in code on feat-team (browser-checked); the server part is NOT yet run against a database)** Archive, Pin, Move, Trash, Duplicate and Share are shown to read-only viewers. `SoftNotes.jsx:779-800`.
- [x] R28 (no more silent folder divergence; bulk runs through `bulkRun`, failures listed per note) Bulk actions use one `Promise.all` and report one generic error. `SoftNotes.jsx:638,649`.
- [x] R29 A failed account save is ignored while the notes are renamed or cleared (folders and notes diverge). `SoftNotes.jsx:593-621`.
- [ ] R30 Open tabs of one space are written under another space's key after a switch *(partly unverified)*. `NoteTabs.jsx:9-18`.
- [x] R31 A link to a note in another space or the Trash silently goes to /notes. `SoftNotes.jsx:343`.
- [ ] R32 Move dialog text is wrong for non-authors; Undo failures are swallowed. `MoveNote.jsx:66,91`.
- [~] R33 **(fixed in code on feat-team (browser-checked); the server part is NOT yet run against a database)** Team notes show no author in the list or "Shared by" strip. `TeamNoteStrip.jsx:37`.

### Notes: performance and accessibility
- [~] R34 **(done on branch feat-versions: fields=list, in-place cache patch, 5 s socket debounce; server side not run against a database)** The sidebar and the list each fetch every note with full text; every autosave refetches the library. `SoftNotes.jsx:188-197`.
- [~] R35 **(done on branch feat-versions: title/tag in SQL first, bodies only for the rest, cap 200, min 2 chars; not run against a database)** Search decrypts and scans every note per keystroke pause. `notesController.ts:~300-340`.
- [x] R36 (`folderCounts.js`, one pass in a useMemo) Folder counts are recomputed per render (folders x notes x folders). `SoftNotes.jsx:226-231`.
- [x] R37 (`bulkRun.js`: 5 at a time, 429 retried once) Bulk actions send one parallel request per note with no limit. `SoftNotes.jsx:638,649,968`.
- [~] R38 (done for NotesPanelParts sheets, View popover, smart-folder page, tag picker, failure dialog, row and tab menus; `spaces.jsx` dialogs not touched) Dialogs have no aria-modal or focus trap; menus do not take focus. `NotesPanelParts.jsx`, `spaces.jsx`.
- [ ] R39 Folder edit is double-click or right-click only; fixed pastel colours. `SoftNotes.jsx:865-889`.
- [x] R40 (`TagFilterBar` in `NotesExtras.jsx`) No tag filter UI (any/all). `SoftNotes.jsx:98-99`.
- [ ] R41 The notes page adds its own phone breakpoint and uses `window.confirm`. `SoftNotes.jsx:96,110,437,577,611`.

### Themes and appearance
- [x] R42 Settings sync: local copy wins over the account, so the account's text size never reaches a new device. `AuthContext.jsx:57-64,133-142`.
- [x] R43 The pre-paint script defaults to Light + Studio while React defaults to System + Soft (flash). `client/index.html:14-15`.
- [x] R44 Theme and style changes always report "saved" even when the account save failed. `sections1.jsx:177-189`, `AuthContext.jsx:100-111`.
- [x] R45 Hard-coded dark text on pastel fills is unreadable in dark and midnight (about 1.2:1); pills, folder colours and toggles never change. `notespanel.css:19-129`.
- [~] R46 (partly: backdrop and notes-panel colours now follow the theme) More hard-coded colours (backdrop `rgba(58,42,26,.18)`, `.theme-dark` hex); dark rules are repeated per style. `soft.css:889`, `SoftNotes.jsx:960`.
- [x] R47 (OS reduce-motion honoured; high contrast in every style; options synced to the account with a device override; text size still uses zoom) Reduce motion ignores the OS setting by default; High contrast only affects Soft; text size uses `zoom` on a fixed canvas; all device-only. `utils/a11yPrefs.js`, `styles/a11y.css`.
- [x] R48 Text size and density are still set in three places each.
- [ ] R49 SQL migrations jump from 043 to 046 *(unverified, harmless)*.

## 3. Missing basic features (from the audit)
1. Handover of a departing member's notes. 2. Remove someone from one team. 3. Delete an organization; reopen a closed team. 4. Block account deletion for the last owner. 5. Live team events. 6. Author and "last edited by" in team lists. 7. Enforce seat limit and guest expiry; extend a guest. 8. Revoke public links when policy turns off. 9. Version history for team notes. 10. View-only label and locked editor. 11. Invite link outside the query string; resend and copy. 12. Throttle or confirm org export. 13. `@name` mentions in notes. 14. Mute a team. 15. Transfer a note; request access from the list. 16. Bulk move to team with progress. 17. Paged notes list and a search index. 18. Per-note failure report for bulk actions. 19. Ctrl+W, Ctrl+N, shift-click range select, keyboard menus. 20. [x] Pre-paint theme matching the defaults; OS reduced motion. 21. [x] Sync accessibility options; one place for text size and density. 22. [x] Accent colour, contrast for River/Orbit/Studio, dark-mode schedule. 23. Refetch after the socket reconnects. 24. Space-aware cache keys and a cross-window space change. 25. Tag filter UI; per-space folders.
