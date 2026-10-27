import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, Lock, RotateCw, Download, FileWarning } from 'lucide-react';
import { bytesOf, pdfOpen, FileProblem, isEncryptedOffice, tidyPackage, extOf, downloadUrl, escapeRe } from '../utils/docFiles';

// The four ways a file is drawn inside a frame or the full-screen viewer: slides, pages of a document, a sheet, PDF pages.
// Every one reports how many "places" it has (slides, pages, sheets) and which one is showing, so the frame can offer arrows.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Width of an element, kept up to date. */
function useWidth(ref) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Loads the bytes of a file once for the view that needs them. */
export function useBytes(url) {
  const [st, setSt] = useState({ buf: null, err: null, tick: 0 });
  const load = useCallback(() => {
    let off = false;
    setSt((s) => ({ buf: null, err: null, tick: s.tick }));
    if (!url) return () => { off = true; };
    bytesOf(url).then((buf) => { if (!off) setSt((s) => ({ buf, err: null, tick: s.tick })); }).catch((err) => { if (!off) setSt((s) => ({ buf: null, err, tick: s.tick })); });
    return () => { off = true; };
  }, [url]);
  useEffect(() => load(), [load]);
  return { ...st, retry: () => { setSt((s) => ({ ...s, tick: s.tick + 1 })); load(); } };
}

export function Problem({ tone = 'bad', icon, title, body, children }) {
  return (
    <div className={`df-problem ${tone}`} data-testid="df-problem" role="status">
      {icon || <FileWarning size={22} />}
      <b>{title}</b>
      {body && <span>{body}</span>}
      {children && <div className="df-problem-act">{children}</div>}
    </div>
  );
}

const Busy = ({ what }) => <div className="df-busy" role="status" aria-live="polite"><i className="df-spin" />{what}</div>;

/* =========================== Slides =========================== */
const SLIDE_W = 960;

/** The previewer draws every slide at once into a hidden stage; this takes them out one at a time. */
function useSlides(buf, onCount) {
  const hold = useRef(null);
  const [slides, setSlides] = useState(null); // [{el, h}]
  const [err, setErr] = useState(null);
  useEffect(() => {
    let off = false; let viewer = null;
    setSlides(null); setErr(null);
    (async () => {
      try {
        if (isEncryptedOffice(buf)) throw new FileProblem('password', 'Password protected');
        const { init } = await import('pptx-preview');
        const stage = hold.current; if (!stage || off) return;
        stage.innerHTML = '';
        const draw = async (bytes) => {
          stage.innerHTML = '';
          try { viewer?.destroy?.(); } catch { /* gone */ }
          viewer = init(stage, { width: SLIDE_W, height: Math.round(SLIDE_W * 9 / 16), mode: 'list' });
          await viewer.preview(bytes.slice(0));
          return [...stage.querySelectorAll('.pptx-preview-slide-wrapper')];
        };
        let els = await draw(buf);
        if (!els.length && !off) els = await draw(await tidyPackage(buf));
        if (off) return;
        if (!els.length) throw new Error('empty');
        const list = els.map((el) => ({ el, h: parseFloat(el.style.height) || el.offsetHeight || 540 }));
        setSlides(list); onCount?.(list.length);
      } catch (e) { console.warn('[docfile] slides', e); if (!off) setErr(e); }
    })();
    return () => { off = true; try { viewer?.destroy?.(); } catch { /* gone */ } };
  }, [buf]); // eslint-disable-line react-hooks/exhaustive-deps
  return { hold, slides, err };
}

export function Thumb({ el, h, w }) {
  const box = useRef(null);
  useEffect(() => {
    const c = el.cloneNode(true);
    c.style.display = 'block'; c.style.margin = '0'; c.style.transformOrigin = 'top left'; c.style.transform = `scale(${w / SLIDE_W})`; c.style.pointerEvents = 'none';
    box.current.replaceChildren(c);
  }, [el, w]);
  return <span ref={box} className="df-thumb-i" style={{ width: w, height: h * (w / SLIDE_W) }} aria-hidden="true" />;
}

export function SlidesView({ buf, index, setIndex, onCount, mode = 'frame', strip = false, onSearchRoot, onSlides, overlay = null }) {
  const { hold, slides, err } = useSlides(buf, onCount);
  const box = useRef(null);
  const w = useWidth(box);
  const cur = slides ? slides[clamp(index, 0, slides.length - 1)] : null;
  const stage = useRef(null);
  useEffect(() => { // the one slide that shows
    if (!slides) return;
    slides.forEach((s, i) => { s.el.style.display = i === clamp(index, 0, slides.length - 1) ? 'block' : 'none'; s.el.style.margin = '0'; });
  }, [slides, index]);
  useEffect(() => { if (slides && stage.current) { slides.forEach((s) => { if (s.el.parentNode !== stage.current) stage.current.appendChild(s.el); }); } }, [slides]);
  useEffect(() => { onSearchRoot?.(stage.current, slides); }, [slides, onSearchRoot]);
  useEffect(() => { onSlides?.(slides); }, [slides]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) {
    return err.code === 'password'
      ? <Problem tone="lilac" icon={<Lock size={22} />} title="Password protected" body="A slide deck with a password cannot be previewed here. Download it to open it." />
      : <Problem title="We could not make a preview" body="The file itself is safe. Try again, or download it." />;
  }
  const scale = w && cur ? w / SLIDE_W : 1;
  return (
    <div className={`df-slides ${mode}`}>
      <div className="df-hold" ref={hold} aria-hidden="true" />
      <div className="df-slide-box" ref={box} style={cur && w ? { height: cur.h * scale } : { aspectRatio: '16 / 9' }} data-testid="df-slide">
        {!slides ? <Busy what="Making the preview…" /> : <div ref={stage} className="df-slide-stage" style={{ width: SLIDE_W, transform: `scale(${scale})` }} />}
        {overlay}
      </div>
      {slides && strip && (
        <div className={`df-strip ${mode}`} data-testid="df-strip" role="tablist" aria-label="Slides">
          {slides.map((s, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === index} aria-label={`Slide ${i + 1}`} className={`df-t${i === index ? ' on' : ''}`} onClick={() => setIndex(i)}>
              <Thumb el={s.el} h={s.h} w={mode === 'full' ? 120 : 92} /><em>{i + 1}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================== Word =========================== */
export function DocPagesView({ buf, onCount, zoom, setZoom, pageNo, setPageNo, mode = 'frame', onSearchRoot }) {
  const wrap = useRef(null); const scroller = useRef(null); const holder = useRef(null);
  const [state, setState] = useState('busy'); const [pages, setPages] = useState(0);
  const w = useWidth(scroller);
  useEffect(() => {
    let off = false;
    setState('busy');
    (async () => {
      try {
        if (isEncryptedOffice(buf)) throw new FileProblem('password', 'Password protected');
        const { renderAsync } = await import('docx-preview');
        if (off || !holder.current) return;
        holder.current.innerHTML = '';
        await renderAsync(buf.slice(0), holder.current, null, { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, ignoreHeight: true, renderHeaders: false, renderFooters: false, useBase64URL: true });
        if (off) return;
        const n = holder.current.querySelectorAll('section.docx').length;
        setPages(n); onCount?.(n); setState('ok'); onSearchRoot?.(holder.current);
      } catch (e) { if (!off) setState(e?.code === 'password' ? 'password' : 'bad'); }
    })();
    return () => { off = true; };
  }, [buf]); // eslint-disable-line react-hooks/exhaustive-deps
  // fit to the width of the frame unless the person picked a zoom
  const fit = useMemo(() => {
    if (state !== 'ok' || !w) return 1;
    const sec = holder.current?.querySelector('section.docx');
    const pw = sec ? sec.offsetWidth + 40 : 834;
    return clamp(w / pw, 0.3, 2);
  }, [state, w]);
  const z = zoom || fit;
  useEffect(() => { // jump to a page
    if (state !== 'ok' || !holder.current) return;
    const sec = holder.current.querySelectorAll('section.docx')[pageNo];
    if (sec && scroller.current) scroller.current.scrollTo({ top: sec.offsetTop * z - 8, behavior: 'smooth' });
  }, [pageNo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // which page is on top, as the person scrolls
    const sc = scroller.current; if (!sc || state !== 'ok') return undefined;
    const on = () => {
      const secs = [...holder.current.querySelectorAll('section.docx')];
      let at = 0; secs.forEach((s, i) => { if (s.offsetTop * z - 40 <= sc.scrollTop) at = i; });
      setPageNo?.(at, true);
    };
    sc.addEventListener('scroll', on, { passive: true });
    return () => sc.removeEventListener('scroll', on);
  }, [state, z]); // eslint-disable-line react-hooks/exhaustive-deps
  if (state === 'password') return <Problem tone="lilac" icon={<Lock size={22} />} title="Password protected" body="A document with a password cannot be previewed here. Download it to open it." />;
  if (state === 'bad') return <Problem title="We could not make a preview" body="The file itself is safe. Try again, or download it." />;
  return (
    <div className={`df-doc ${mode}`} ref={wrap}>
      {state === 'busy' && <Busy what="Making the preview…" />}
      <div className="df-doc-scroll" ref={scroller} data-testid="df-doc" style={{ visibility: state === 'ok' ? 'visible' : 'hidden' }}>
        <div className="df-doc-inner" style={{ zoom: z }}><div ref={holder} /></div>
      </div>
      {state === 'ok' && <span className="df-zoomkeys" hidden data-pages={pages} data-zoom={Math.round(z * 100)} />}
    </div>
  );
}
export const ZoomBar = ({ zoom, fit, setZoom }) => (
  <span className="df-zoom" data-testid="df-zoom">
    <button type="button" className="df-ic" aria-label="Zoom out" onClick={() => setZoom(clamp((zoom || fit || 1) - 0.1, 0.3, 3))}><Minus size={14} /></button>
    <button type="button" className="df-chip" aria-label="Fit to width" title="Fit to width" onClick={() => setZoom(0)}>{Math.round((zoom || fit || 1) * 100)}%</button>
    <button type="button" className="df-ic" aria-label="Zoom in" onClick={() => setZoom(clamp((zoom || fit || 1) + 0.1, 0.3, 3))}><Plus size={14} /></button>
  </span>
);

/* =========================== Excel =========================== */
const colName = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
export const ROW_CAP = 200;

export function useSheets(buf) {
  const [wb, setWb] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => {
    let off = false; setWb(null); setErr(null);
    if (!buf) return () => { off = true; };
    (async () => {
      try {
        const X = await import('xlsx');
        const book = X.read(buf.slice(0), { type: 'array', cellDates: true });
        const sheets = book.SheetNames.map((name) => {
          const ws = book.Sheets[name];
          const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true });
          const cols = Math.min(40, Math.max(6, ...rows.slice(0, ROW_CAP).map((r) => r.length)));
          return { name, rows, cols };
        });
        if (!off) setWb(sheets);
      } catch (e) { if (!off) setErr(isEncryptedOffice(buf) ? new FileProblem('password', 'Password protected') : e); }
    })();
    return () => { off = true; };
  }, [buf]);
  return { sheets: wb, err };
}

export function SheetView({ sheets, err, at, mode = 'frame', onSearchRoot }) {
  const root = useRef(null);
  useEffect(() => { onSearchRoot?.(root.current); }, [sheets, at, onSearchRoot]);
  if (err) return err.code === 'password' ? <Problem tone="lilac" icon={<Lock size={22} />} title="Password protected" body="A workbook with a password cannot be previewed here. Download it to open it." /> : <Problem title="We could not make a preview" body="The file itself is safe. Try again, or download it." />;
  if (!sheets) return <Busy what="Making the preview…" />;
  const s = sheets[clamp(at, 0, sheets.length - 1)];
  if (!s) return <Problem title="This workbook has no sheets" />;
  const shown = s.rows.slice(0, ROW_CAP);
  return (
    <div className={`df-sheet ${mode}`} ref={root} data-testid="df-sheet">
      <div className="df-sheet-scroll">
        {/* divs, not a table: the editor's table handles react to any <table> under the pointer */}
        <div className="df-grid" role="table" aria-label={s.name}>
          <div className="df-gr df-gh-row" role="row"><span className="df-gc df-gh" role="columnheader" />{Array.from({ length: s.cols }, (_, i) => <span key={i} className="df-gc df-gh" role="columnheader">{colName(i)}</span>)}</div>
          {shown.map((r, ri) => (
            <div key={ri} className={`df-gr${ri === 0 ? ' h' : ''}`} role="row">
              <span className="df-gc rn" role="rowheader">{ri + 1}</span>
              {Array.from({ length: s.cols }, (_, ci) => { const v = r[ci] ?? ''; return <span key={ci} role="cell" className={`df-gc${/^[-+]?[\d,.]+%?$/.test(String(v).trim()) && v !== '' ? ' n' : ''}`}>{String(v)}</span>; })}
            </div>
          ))}
        </div>
      </div>
      {s.rows.length > ROW_CAP && <div className="df-sheet-note">Showing the first {ROW_CAP} rows of {s.rows.length.toLocaleString()}. Download for the rest.</div>}
    </div>
  );
}

/* =========================== PDF =========================== */
function PdfPage({ pdf, n, width, onSize }) {
  const canvas = useRef(null);
  useEffect(() => {
    let off = false; let task = null;
    (async () => {
      try {
        const page = await pdf.getPage(n);
        if (off || !canvas.current) return;
        const base = page.getViewport({ scale: 1 });
        const scale = (width || base.width) / base.width;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale: scale * dpr });
        const c = canvas.current; c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.style.width = `${Math.floor(vp.width / dpr)}px`; c.style.height = `${Math.floor(vp.height / dpr)}px`;
        task = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
        await task.promise;
        onSize?.(vp.height / dpr);
      } catch { /* cancelled or gone */ }
    })();
    return () => { off = true; try { task?.cancel(); } catch { /* done */ } };
  }, [pdf, n, width]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={canvas} className="df-pdf-page" aria-label={`Page ${n}`} />;
}

export function usePdf(buf) {
  const [st, setSt] = useState({ pdf: null, err: null, ask: false });
  const open = useCallback((password) => {
    let off = false;
    setSt({ pdf: null, err: null, ask: false });
    if (!buf) return () => { off = true; };
    pdfOpen(buf, password).then((pdf) => { if (!off) setSt({ pdf, err: null, ask: false }); }).catch((err) => { if (!off) setSt({ pdf: null, err, ask: err?.code === 'password' || err?.code === 'wrongpw' }); });
    return () => { off = true; };
  }, [buf]);
  useEffect(() => open(), [open]);
  useEffect(() => () => { st.pdf?.destroy?.(); }, [st.pdf]);
  return { ...st, open };
}

export function PdfView({ pdf, err, ask, onPassword, first, last, at, mode = 'frame', twoUp }) {
  const box = useRef(null);
  const w = useWidth(box);
  const [pw, setPw] = useState('');
  if (ask) {
    return (
      <Problem tone="lilac" icon={<Lock size={22} />} title={err?.code === 'wrongpw' ? 'That password did not work' : 'Password protected'} body="The password is used once here and is never saved.">
        <form onSubmit={(e) => { e.preventDefault(); onPassword(pw); }} className="df-pwform">
          <input type="password" autoComplete="off" data-testid="df-pw" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" aria-label="Password" />
          <button type="submit" className="df-btn ac" data-testid="df-pw-go"><Lock size={14} />Enter password to preview</button>
        </form>
      </Problem>
    );
  }
  if (err) return <Problem title="We could not make a preview" body="The file itself is safe. Try again, or download it." />;
  if (!pdf) return <Busy what="Making the preview…" />;
  const total = Math.min(last, pdf.numPages);
  const pages = twoUp && at + 1 <= total ? [first + at, first + at + 1 <= total ? first + at + 1 : null].filter(Boolean) : [first + at];
  const each = twoUp && pages.length > 1 ? Math.max(120, (w - 48 - 14) / 2) : Math.max(120, Math.min(w - 40, mode === 'full' ? 900 : 520));
  return (
    <div className={`df-pdf ${mode}`} ref={box} data-testid="df-pdf">
      <div className="df-pdf-row">{pages.map((n) => <PdfPage key={n} pdf={pdf} n={n} width={each} />)}</div>
    </div>
  );
}

export const FileCard = ({ name, url, why }) => (
  <Problem tone="plain" icon={<Download size={22} />} title={why || 'No preview for this type'} body="It can still sit in the note as a card, and the download is the exact file.">
    <a className="df-btn ac" href={downloadUrl(url)} download={name}><Download size={14} />Download</a>
  </Problem>
);

export { RotateCw, ChevronLeft, ChevronRight, escapeRe, extOf };
