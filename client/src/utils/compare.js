// Turns two versions of a note (Markdown) into marked-up pages for the Compare box.
import { diffRows } from './diff';

const PIC = /^\s*(?:!\[[^\]]*\]\([^)]*\)|<figure>[\s\S]*<img[\s\S]*<\/figure>|<img[^>]*>)\s*$/;
export const isPicture = (line) => PIC.test(line || '');
const PREFIX = /^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|#{1,6}\s+|>\s+)?)([\s\S]*)$/;
const splitPrefix = (line) => { const m = PREFIX.exec(line || ''); return [m[1], m[2]]; };
export const wordsOf = (md) => (String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#>*_`\-\[\]()]/g, ' ').match(/\S+/g) || []).length;

/** [{ t: 'same' | 'del' | 'add', s }] word by word (spaces stay with the words). */
export function wordDiff(a, b) {
  const x = a.split(/(\s+)/).filter((s) => s !== '');
  const y = b.split(/(\s+)/).filter((s) => s !== '');
  const n = x.length; const m = y.length;
  if (n * m > 250000) return [{ t: 'del', s: a }, { t: 'add', s: b }];
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = [];
  const push = (k, s) => { const l = out[out.length - 1]; if (l && l.t === k) l.s += s; else out.push({ t: k, s }); };
  let i = 0; let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (j < m && (i === n || t[i][j + 1] >= t[i + 1][j])) { push('add', y[j]); j++; }
    else { push('del', x[i]); i++; }
  }
  return out;
}

const span = (cls, idx, text) => (text ? `<span class="cb-${cls}"${idx != null ? ` data-chg="${idx}"` : ''}>${text}</span>` : '');
// the first marked word of a change carries the number, so Next / Previous can scroll to it
const run = (ops, keep, cls, idx) => { let first = true; return ops.map((o) => { if (o.t === 'same') return o.s; if (o.t !== keep) return ''; const h = span(cls, first ? idx : null, o.s.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$2')); first = false; return h + (/\s$/.test(o.s) ? ' ' : ''); }).join(''); };

/**
 * -> { changes: [{ i, kind: 'text added' | ..., }], earlier, now, merged }
 * earlier / now / merged are Markdown with <span class="cb-add|cb-del"> marks and picture lines as <span class="cb-pic ..">.
 */
export function compareModel(oldMd, newMd, who = '') {
  const rows = diffRows(String(oldMd || ''), String(newMd || ''));
  const L = []; const R = []; const M = []; const changes = [];
  const tag = who ? ` <b class="cb-tag add">${who.toUpperCase()}</b>` : '';
  for (const r of rows) {
    if (r.kind === 'same') { L.push(r.l); R.push(r.r); M.push(r.r); continue; }
    // a blank line coming or going is layout, not a change
    if ((r.l == null || !String(r.l).trim()) && (r.r == null || !String(r.r).trim())) { if (r.l != null) L.push(r.l); if (r.r != null) { R.push(r.r); M.push(r.r); } continue; }
    const idx = changes.length;
    if (r.kind === 'change' && r.l != null && r.r != null) {
      if (isPicture(r.l) || isPicture(r.r)) {
        changes.push({ i: idx, kind: 'picture changed' });
        L.push(`<span class="cb-pic del" data-chg="${idx}">${r.l}</span>`); R.push(`<span class="cb-pic add" data-chg="${idx}">${r.r}</span>`);
        M.push(`<span class="cb-pic del">${r.l}</span>`); M.push(`<span class="cb-pic add" data-chg="${idx}">${r.r}</span>`);
        continue;
      }
      const [pl, tl] = splitPrefix(r.l); const [pr, tr] = splitPrefix(r.r);
      const ops = wordDiff(tl, tr);
      const hasDel = ops.some((o) => o.t === 'del'); const hasAdd = ops.some((o) => o.t === 'add');
      changes.push({ i: idx, kind: hasAdd && hasDel ? 'text changed' : hasAdd ? 'text added' : 'text removed' });
      L.push(pl + run(ops, 'del', 'del', idx)); R.push(pr + run(ops, 'add', 'add', idx));
      const merged = ops.map((o) => (o.t === 'same' ? o.s : o.t === 'del' ? span('del', null, o.s.trim()) + ' ' : span('add', null, o.s.trim()) + ' ')).join('').replace(/<span class="cb-(add|del)">/, (m, k) => `<span class="cb-${k}" data-chg="${idx}">`);
      M.push(pr + merged + (hasDel ? ' <b class="cb-tag del">REMOVED</b>' : '') + (hasAdd ? tag : ''));
    } else if (r.kind === 'del') {
      const pic = isPicture(r.l);
      changes.push({ i: idx, kind: pic ? 'picture removed' : 'text removed' });
      if (pic) { L.push(`<span class="cb-pic del" data-chg="${idx}">${r.l}</span>`); M.push(`<span class="cb-pic del" data-chg="${idx}">${r.l}</span> <b class="cb-tag del">REMOVED</b>`); }
      else { const [p, t] = splitPrefix(r.l); L.push(p + span('del', idx, t)); M.push(p + span('del', idx, t) + ' <b class="cb-tag del">REMOVED</b>'); }
    } else {
      const pic = isPicture(r.r);
      changes.push({ i: idx, kind: pic ? 'picture added' : 'text added' });
      if (pic) { R.push(`<span class="cb-pic add" data-chg="${idx}">${r.r}</span>`); M.push(`<span class="cb-pic add" data-chg="${idx}">${r.r}</span>`); }
      else { const [p, t] = splitPrefix(r.r); R.push(p + span('add', idx, t)); M.push(p + span('add', idx, t) + tag); }
    }
  }
  return { changes, earlier: L.join('\n'), now: R.join('\n'), merged: M.join('\n') };
}
