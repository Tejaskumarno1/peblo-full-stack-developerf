Set-Location D:\Peblo\peblo-wt\fix
git add client/src/soft/SoftNotes.jsx client/src/soft/notespanel.css client/src/components/focusMode.css e2e/fix-nov5.mjs scripts/find-glyphs.mjs
$msg = @"
Fix replacement glyphs, folder sheet buttons and full-screen outline overlap

- SoftNotes.jsx had U+FFFD where dots, ellipses, quotes and a dash were lost: restored, and the More button is now an icon.
- scripts/find-glyphs.mjs fails the e2e run when a source file holds a replacement or garbled character.
- The New folder sheet clears the bulk-action bar and keeps Create and Cancel pinned at the bottom of the sheet.
- The full-screen writing column keeps clear of the outline rail on both sides, with and without the drawer.
- e2e/fix-nov5.mjs covers all of it.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9GpWaduMaqknHFdWAqMR9
"@
git commit -q -m $msg
git log -1 --format=%h
git push origin HEAD:supabase 2>&1 | Select-Object -Last 1
git push origin HEAD:main 2>&1 | Select-Object -Last 1
