# End-to-end checks (real server + real client in Chrome)

Run against an EMPTY test database, never your data:

    npm run build
    cd e2e; npm i playwright-core dotenv   # once
    $env:DATABASE_URL set automatically: lib.mjs rewrites server/.env's database name to peblo_test and refuses to run otherwise
    node notes-flow.mjs

notes-flow.mjs = delete/restore/archive/reopen (PEB-70). draft-dup.mjs = slow-network new-note check (did not reproduce the duplicate; kept as a guard).

shortcuts.mjs = Ctrl+K palette, exact modifiers, Ctrl+N new note (PEB-78).
