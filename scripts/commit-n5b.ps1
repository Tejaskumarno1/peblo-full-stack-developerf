Set-Location D:\Peblo\peblo-wt\fix
node scripts/run-e2e.mjs picture-toolbar 2>&1 | Select-String -Pattern 'SUMMARY|=>'
git add client/src/components/BlockEditor.jsx client/src/components/blockEditor.css client/src/components/PictureView.jsx client/src/components/pictureView.css client/src/utils/copyImage.js client/src/pages/SharedPage.jsx e2e/copy-image.mjs e2e/picture-toolbar.mjs
$msg = @"
Copy picture: full-size view with Copy and Save on read-only shares, Copy in the picture toolbar

- Pictures on a read-only share link open full size (click) with Copy picture and Save buttons; Escape closes.
- The editor's picture toolbar gets a Copy picture button (the bar stays 420px wide).
- utils/copyImage.js puts a PNG on the clipboard, falling back to the picture's address.
- e2e/copy-image.mjs checks the clipboard really holds a PNG; picture-toolbar allows the 13th button.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9GpWaduMaqknHFdWAqMR9
"@
git commit -q -m $msg
git log -1 --format=%h
git push origin HEAD:supabase 2>&1 | Select-Object -Last 1
git push origin HEAD:main 2>&1 | Select-Object -Last 1
