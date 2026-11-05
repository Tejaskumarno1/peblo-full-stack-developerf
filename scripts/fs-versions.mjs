import fs from 'node:fs';
const f = 'client/src/soft/SoftNotes.jsx';
let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
const anchor = "<button type=\"button\" role=\"menuitem\" onClick={() => { setMenuOpen(false); setShareOpen(true); }}><Share2";
if (!s.includes(anchor)) throw new Error('anchor');
const item = "{!doc.isDeleted && !doc.isDraft && <button type=\"button\" role=\"menuitem\" data-testid=\"menu-versions\" disabled={!versions.length} onClick={() => { setMenuOpen(false); if (versions[0]) setDiffV(versions[0]); }}><History size={15} />{versions.length ? `Version history (${versions.length} kept)` : 'No earlier versions'}</button>}\n";
s = s.replace(anchor, item + anchor);
fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('ok');
