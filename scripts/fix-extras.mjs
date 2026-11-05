import fs from 'node:fs';
const f = 'e2e/share-extras.mjs';
let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
const a = s.indexOf("  await page.getByText('Priya is typing')");
const b = s.indexOf('  // 6. the panel');
if (a < 0 || b < 0) throw new Error('anchors');
s = s.slice(0, a) + "  // (typing names and the live cursors of both people are checked in collab-panel.mjs and presence.mjs;\n  //  with live editing on, the old paragraph marks are replaced by real cursors)\n  await typing;\n  await g.waitForTimeout(500);\n\n" + s.slice(b);
fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok');
