import api from '../api/client';

// Files that sit in a note as a frame: PowerPoint, Word, Excel, PDF and anything else (mockups F1 to F7).
// The original bytes live on the server (/api/files/<id>); previews are drawn in the browser, so nothing here needs a paid service.

export const MAX_FILE = 25 * 1024 * 1024;

export const KINDS = {
  ppt: { label: 'Presentation', exts: ['pptx', 'ppt', 'key', 'odp'], word: 'PowerPoint' },
  doc: { label: 'Document', exts: ['docx', 'doc', 'odt', 'rtf'], word: 'Word' },
  xls: { label: 'Spreadsheet', exts: ['xlsx', 'xls', 'csv'], word: 'Excel' },
  pdf: { label: 'PDF', exts: ['pdf'], word: 'PDF' },
  any: { label: 'Any other file', exts: [], word: 'Any file' },
};
// the formats a preview can be drawn for (the rest stay as a card to download)
export const SHOWN = new Set(['pptx', 'docx', 'xlsx', 'xls', 'csv', 'pdf']);

export const extOf = (name) => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
export const kindOf = (name) => {
  const e = extOf(name);
  return Object.keys(KINDS).find((k) => KINDS[k].exts.includes(e)) || 'any';
};
export const canShow = (name) => SHOWN.has(extOf(name));
export const acceptOf = (kind) => (kind && KINDS[kind] && KINDS[kind].exts.length ? KINDS[kind].exts.map((e) => '.' + e).join(',') : '');

export const sizeText = (n) => {
  n = Number(n) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
};
export const idOf = (url) => (/\/api\/files\/([\w-]+)/.exec(String(url || '')) || [])[1] || '';
export const baseOf = (url) => String(url || '').split('#')[0];
export const downloadUrl = (url) => `${baseOf(url)}?dl=1`;

/** A named problem the person can act on (mockup F5 b). */
export class FileProblem extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function checkFile(file) {
  if (!file || !file.size) return new FileProblem('empty', 'That file is empty.');
  if (file.size > MAX_FILE) return new FileProblem('big', 'Over the 25 MB limit. Nothing was added to your note.');
  return null;
}

export async function uploadDoc(file, { onProgress, signal } = {}) {
  const bad = checkFile(file);
  if (bad) throw bad;
  try {
    const { data } = await api.post('/files', file, {
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Type': file.type || '' },
      transformRequest: [(d) => d],
      onUploadProgress: (e) => onProgress?.(Math.min(1, e.loaded / (e.total || file.size))),
      signal,
    });
    return data;
  } catch (e) {
    if (e?.code === 'ERR_CANCELED') throw new FileProblem('cancel', 'Cancelled.');
    if (e?.response?.status === 413) throw new FileProblem('big', 'Over the 25 MB limit. Nothing was added to your note.');
    if (e?.response?.status === 401) throw new FileProblem('auth', 'Sign in to add files to a note.');
    throw new FileProblem('net', e?.response?.data?.error || 'The file could not be uploaded. Check the connection and try again.');
  }
}

const bufferCache = new Map();
/** The file's bytes, kept so flicking between frames and the full-screen viewer reads it once. */
export async function bytesOf(url) {
  const base = baseOf(url);
  if (!bufferCache.has(base)) {
    bufferCache.set(base, (async () => {
      const res = await fetch(base);
      if (!res.ok) throw new FileProblem('gone', res.status === 404 ? 'This file is no longer stored.' : 'The file could not be loaded.');
      return res.arrayBuffer();
    })().catch((e) => { bufferCache.delete(base); throw e; }));
  }
  return bufferCache.get(base);
}
export const forgetBytes = (url) => bufferCache.delete(baseOf(url));

/* ---- what is kept inside the note's address, so Markdown carries it ("/api/files/<id>#nm=..&sz=..&fr=wide") ---- */
const FRAMES = ['small', 'medium', 'wide', 'tall'];
export const packProps = (p) => {
  const q = new URLSearchParams();
  if (p.name) q.set('nm', p.name);
  if (p.size) q.set('sz', String(p.size));
  if (p.meta) q.set('mt', p.meta);
  if (p.frame && p.frame !== 'medium') q.set('fr', p.frame);
  if (p.download === false) q.set('dl', '0');
  if (p.pages && p.pages !== 'all') q.set('pg', p.pages);
  if (p.caption) q.set('cp', p.caption);
  const s = q.toString().replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `${baseOf(p.url)}${s ? '#' + s : ''}`;
};
export const unpackProps = (url) => {
  const [base, ...h] = String(url || '').split('#');
  const q = new URLSearchParams(h.join('#'));
  const name = q.get('nm') || 'file';
  const fr = q.get('fr');
  return {
    url: base, name, size: Number(q.get('sz')) || 0, meta: q.get('mt') || '', kind: kindOf(name),
    frame: FRAMES.includes(fr) ? fr : 'medium', download: q.get('dl') !== '0', pages: q.get('pg') || 'all', caption: q.get('cp') || '',
  };
};
export const isFileUrl = (url) => /^\/api\/files\/[\w-]{8,64}(?:[#?]|$)/.test(String(url || ''));

/* ---- a little about the file, worked out once when it is added ("12 slides", "6 pages", "3 sheets") ---- */
export async function describe(buf, name) {
  const ext = extOf(name);
  try {
    if (ext === 'pptx') {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buf);
      const n = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
      return n ? `${n} slide${n === 1 ? '' : 's'}` : '';
    }
    if (ext === 'docx') {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buf);
      const app = await zip.file('docProps/app.xml')?.async('string');
      const n = Number((/<Pages>(\d+)<\/Pages>/.exec(app || '') || [])[1]);
      return n ? `${n} page${n === 1 ? '' : 's'}` : '';
    }
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      const X = await import('xlsx');
      const wb = X.read(buf, { type: 'array', bookSheets: true });
      const n = wb.SheetNames.length;
      return `${n} sheet${n === 1 ? '' : 's'}`;
    }
    if (ext === 'pdf') {
      const pdf = await pdfOpen(buf);
      const n = pdf.numPages;
      pdf.destroy?.();
      return `${n} page${n === 1 ? '' : 's'}`;
    }
  } catch { /* the frame will say what is wrong */ }
  return '';
}

let pdfLib = null;
export async function pdfjs() {
  if (!pdfLib) {
    pdfLib = (async () => {
      const lib = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      lib.GlobalWorkerOptions.workerSrc = worker;
      return lib;
    })();
  }
  return pdfLib;
}
export async function pdfOpen(buf, password) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(buf.slice(0)), password, isEvalSupported: false });
  try { return await task.promise; } catch (e) {
    if (e?.name === 'PasswordException') throw new FileProblem(e.code === 2 ? 'wrongpw' : 'password', 'Password protected');
    throw e;
  }
}

/** Some tools list parts in the package that are not there; the slide previewer stops at the first one. Dropping those entries lets the deck open. */
export async function tidyPackage(buf) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const ct = zip.file('[Content_Types].xml');
  if (!ct) return buf;
  const xml = await ct.async('string');
  const fixed = xml.replace(/<Override\b[^>]*\/>/g, (tag) => {
    const part = (/PartName="([^"]+)"/.exec(tag) || [])[1];
    return part && !zip.file(part.replace(/^\//, '')) ? '' : tag;
  });
  if (fixed === xml) return buf;
  zip.file('[Content_Types].xml', fixed);
  return zip.generateAsync({ type: 'arraybuffer' });
}

/** Office files saved with a password are encrypted as an old-style container; they cannot be opened here. */
export const isEncryptedOffice = (buf) => {
  const b = new Uint8Array(buf.slice(0, 8));
  return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
};

/* ---- recent files, for "Use again" in the add dialog (kept on this computer) ---- */
const RKEY = 'peblo-recent-files';
export const recentFiles = () => { try { const v = JSON.parse(localStorage.getItem(RKEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export const rememberFile = (f) => {
  try {
    const list = [f, ...recentFiles().filter((x) => x.url !== f.url)].slice(0, 5);
    localStorage.setItem(RKEY, JSON.stringify(list));
  } catch { /* not kept */ }
};

/* ---- plain text of a file, for search inside it ---- */
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Speaker notes of a deck, one string per slide in slide order ("" where a slide has none). */
export async function readNotes(buf) {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const text = async (p) => (zip.file(p) ? zip.file(p).async('string') : '');
    const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const relMap = (xml) => { const m = {}; for (const r of xml.matchAll(/<Relationship\b[^>]*>/g)) { const id = /Id="([^"]+)"/.exec(r[0]); const t = /Target="([^"]+)"/.exec(r[0]); const ty = /Type="([^"]+)"/.exec(r[0]); if (id && t) m[id[1]] = { target: t[1], type: ty ? ty[1] : '' }; } return m; };
    const abs = (t) => (t.startsWith('/') ? t.slice(1) : 'ppt/' + t.replace(/^\.\.\//, ''));
    const pres = await text('ppt/presentation.xml');
    const rels = relMap(await text('ppt/_rels/presentation.xml.rels'));
    const slidePaths = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => rels[m[1]]).filter(Boolean).map((r) => abs(r.target));
    const out = [];
    for (const sp of slidePaths) {
      const rp = sp.replace('slides/', 'slides/_rels/') + '.rels';
      const sr = relMap(await text(rp));
      const nrel = Object.values(sr).find((r) => /notesSlide$/.test(r.type));
      if (!nrel) { out.push(''); continue; }
      const xml = await text('ppt/' + nrel.target.replace(/^\.\.\//, '').replace(/^\/?ppt\//, ''));
      const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
      const body = shapes.filter((x) => /<p:ph[^>]*type="body"/.test(x));
      const use = body.length ? body : shapes.filter((x) => !/type="(sldNum|sldImg|hdr|dt|ftr)"/.test(x));
      const paras = use.flatMap((x) => [...x.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((p) => decode([...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(''))));
      out.push(paras.join('\n').trim());
    }
    return out;
  } catch { return []; }
}
