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
calls.mjs = AI voice call: Call me now, snooze brings back the same agenda, all-day tasks read as today, setting turns calls off (PEB-81).
small-ui.mjs = Ctrl+J in every style, 06:xx tasks on the timeline, delete confirm, sidebar Inbox highlight, Hub error text, one link-preview request, capture window follows style (PEB-86).
