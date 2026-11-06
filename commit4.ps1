Set-Location C:\Users\tejas\peblo-wt\fix
git add client/src/components/Avatar.jsx client/src/components/BlockEditor.jsx client/src/components/TableMenu.jsx client/src/components/TableTools.jsx e2e/fix-four.mjs
$msg = @"
Fix four bugs: row colour menu, own cursor, table Open in new tab, huge profile picture

- Row/column grip menu: unfreeze the grips when the menu unmounts after a fill, so another row opens without a reload.
- Collaboration cursors: a second window of the same person (same name and colour) is no longer drawn as a peer cursor or label.
- Table right-click menu: new Open in new tab entry.
- Avatar: load the picture size rule with the Avatar component so the header photo can never draw at full size over the Ask panel.
- e2e/fix-four.mjs covers all four.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9GpWaduMaqknHFdWAqMR9
"@
git commit -q -m $msg
git log -1 --format=%h
git push origin HEAD:supabase 2>&1 | Select-Object -Last 2
git push origin HEAD:main 2>&1 | Select-Object -Last 2
