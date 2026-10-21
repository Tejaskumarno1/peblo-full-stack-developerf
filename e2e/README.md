# End-to-end checks (real server + real client in Chrome)

Run against an EMPTY test database, never your data:

    npm run build
    cd e2e; npm i playwright-core dotenv   # once
    $env:DATABASE_URL set automatically: lib.mjs rewrites server/.env's database name to peblo_test and refuses to run otherwise
    node notes-flow.mjs

notes-flow.mjs = delete/restore/archive/reopen (PEB-70). draft-dup.mjs = slow-network new-note check (did not reproduce the duplicate; kept as a guard).

shortcuts.mjs = Ctrl+K palette, exact modifiers, Ctrl+N new note (PEB-78).
xss.mjs = AI Hub reply with script/javascript: content is neutralised (PEB-61).
signout.mjs = account data is removed on sign-out, device prefs kept (PEB-60).

calendar.mjs = Calendar day-view arrows, drag keeps the time of day, inline edit saves once (PEB-79).
river.mjs = River Move keeps an all-day task all-day, Delete from the drawer (PEB-85).
settings.mjs = dead settings removed, editor text size works, one AI routing choice in Settings and Your AI, profile save errors (PEB-82).
focus.mjs = keyboard focus shows a solid 2px outline at every Tab stop in all 5 styles and on the active nav link (PEB-120).
parity.mjs = week start (Monday/Sunday) in Tasks, Calendar and Soft; the style follows the account onto a new device and is saved when picked (PEB-90).
series.mjs = repeating task is one series: delete asks this / following / all, Cancel changes nothing, "Every weekday" in the Calendar (PEB-76).
themeflash.mjs = the saved theme is applied before the app script runs: dark/midnight/system in all 5 styles (PEB-102).
riverfix.mjs = River: a failed tick shows a message and rolls back; "+ N more" on a deep stack reaches the hidden meeting (PEB-85).
security.mjs = Content-Security-Policy: no violation in any style or page, injected inline script / onerror do not run (PEB-65).
aioff.mjs = Settings > AI Providers > "Turn off all AI": saved on the account, status line says AI is off, server refuses AI, calls disabled, unticking restores it (PEB-106).
orbit-due.mjs = Orbit: ticked tasks stay struck through, Hide completed, Undo after tick and delete, notes list folds and pages (PEB-122/123/124).
undo-styles.mjs = Undo after a tick in Studio, Console, Soft and River; Soft delete undo (PEB-123).
orbit-help.mjs = Orbit map guide (PEB-147/148/150). help-dialog.mjs = Help dialog in all styles (PEB-167/171).
deleteaccount.mjs = Settings > Data > Delete account: needs a password and a tick, a wrong password changes nothing, success signs this device out and the token stops working (PEB-25).
small-ui.mjs = Ctrl+J in every style, 06:xx tasks on the timeline, delete confirm, sidebar Inbox highlight, Hub error text, one link-preview request, capture window follows style (PEB-86).
orbit-notelist.mjs = Orbit notes list: sort, filters, group, layout, pin, highlight, select + bulk, recent (PEB-125..135).
orbit-due2.mjs = Orbit Due: filters, sort, overdue tools, reschedule, edit, counters, progress, keys, drag to a day (PEB-136..146).
orbit-map2.mjs = Orbit map: starter templates, shortcut tooltips, fit/reset, remembered view, hover card, jump box, filter (PEB-149..158).
orbit-study.mjs = Orbit study: mastery explainer, quiz length + missed-question review, Study today, streak and week (PEB-159..162). orbit-export.mjs = Orbit export: note/topic/map downloads, print, tasks .ics/.csv, full zip, CSV import (PEB-163..166).
`orbit-topics.mjs` — topic manager: list, rename, merge, colour, delete
`orbit-notes4.mjs` — note templates, outline, find and replace
`orbit-trash.mjs` — trash and archive: restore, unarchive, empty trash
`orbit-checklist.mjs` — getting-started checklist on the map
`orbit-map3.mjs` — map topic colours and icons, arrow-key navigation, PNG/SVG download
`orbit-backup.mjs` — backup and restore, example data
`orbit-search2.mjs` - map search recents and scopes, date format setting
