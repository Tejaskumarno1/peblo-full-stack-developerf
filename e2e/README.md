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
small-ui.mjs = Ctrl+J in every style, 06:xx tasks on the timeline, delete confirm, sidebar Inbox highlight, Hub error text, one link-preview request, capture window follows style (PEB-86).
