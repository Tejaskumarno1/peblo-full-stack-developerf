// One-off repair of SoftNotes.jsx: every U+FFFD becomes the character the text meant (separator dot, ellipsis, quotes, dash) or an icon.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'client/src/soft/SoftNotes.jsx';
const lines = readFileSync(f, 'utf8').split('\n');
const BAD = '�';
const dot = '·', ell = '…', dash = '—', lq = '“', rq = '”';
const kind = { 50: dot, 57: dash, 570: ell, 571: ell, 610: ell, 614: ell, 727: dot, 809: ell, 852: dot };
lines.forEach((l, i) => {
  const n = i + 1;
  if (!l.includes(BAD)) return;
  if (n === 646) lines[i] = l.replace(BAD, '').replace('><', '><X size={12} /><').replace('></button></span>)}</div>}', '></button></span>)}</div>}');
  else if (n === 740) lines[i] = l.replace(BAD + BAD + BAD, '<MoreHorizontal size={18} />');
  else if (n === 669) { let k = 0; lines[i] = l.replace(/�/g, () => (k++ % 2 === 0 ? lq : rq)); }
  else if (kind[n]) lines[i] = l.split(BAD).join(kind[n]);
});
let out = lines.join('\n');
// the clear (x) button of a saved search had only the lost glyph inside; give it the X icon
out = out.replace(/aria-label=\{`Forget the search \$\{t\}`\} onClick=\{\(\) => dropSearch\(t\)\}>(<X size=\{12\} \/>)?<\/button>/, 'aria-label={`Forget the search ${t}`} onClick={() => dropSearch(t)}><X size={12} /></button>');
out = out.replace("Image as PicIcon , MousePointer2 }", 'Image as PicIcon , MousePointer2, MoreHorizontal }');
writeFileSync(f, out, 'utf8');
console.log('left:', (out.match(/�/g) || []).length);
