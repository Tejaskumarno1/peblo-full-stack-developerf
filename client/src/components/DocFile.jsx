import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createReactBlockSpec } from '@blocknote/react';
import { Download, Maximize2, MoreHorizontal, Presentation, FileText, Table2, File as FileIcon, Check, X, Search, ChevronLeft, ChevronRight, Upload, Link2, Type, Trash2, Eye, Lock, ChevronUp, ChevronDown, RotateCw } from 'lucide-react';
import { KINDS, baseOf, canShow, downloadUrl, extOf, forgetBytes, kindOf, packProps, sizeText, unpackProps, isFileUrl, uploadDoc, describe, bytesOf, rememberFile, pdfjs, escapeRe } from '../utils/docFiles';
import { DocPagesView, FileCard, PdfView, Problem, SheetView, SlidesView, ZoomBar, useBytes, usePdf, useSheets, ROW_CAP } from './DocViews';
import './docfile.css';

// A file in a note, drawn as a frame (mockups F2, F3, F4, F5). Previews are made in the browser; the download is always the exact original.

export const KIND_ICON = { ppt: Presentation, doc: FileText, xls: Table2, pdf: FileText, any: FileIcon };
export const TypeIcon = ({ kind, size = 18, big }) => {
  const I = KIND_ICON[kind] || FileIcon;
  return <span className={`df-ty ${kind}${big ? ' big' : ''}`}><I size={size} /></span>;
};
const FRAMES = [['small', 'Small'], ['medium', 'Medium'], ['wide', 'Wide'], ['tall', 'Tall']];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A small floating panel anchored under a button; closes on an outside click or Escape. */
function Pop({ anchor, onClose, width = 290, children, testid, align = 'right' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const r = anchor?.getBoundingClientRect?.(); if (!r) return undefined;
    const left = align === 'right' ? clamp(r.right - width, 8, window.innerWidth - width - 8) : clamp(r.left, 8, window.innerWidth - width - 8);
    const below = r.bottom + 8 + 360 < window.innerHeight;
    setPos(below ? { left, top: r.bottom + 8 } : { left, bottom: window.innerHeight - r.top + 8 });
    const off = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose, width, align]);
  return createPortal(<div ref={ref} className="df-pop" role="menu" data-testid={testid} style={{ width, ...(pos || { visibility: 'hidden' }) }}>{children}</div>, document.body);
}
const Row = ({ icon, children, onClick, on, danger, right, tid, disabled }) => (
  <button type="button" role="menuitem" className={`df-r${on ? ' on' : ''}${danger ? ' bad' : ''}`} data-testid={tid} disabled={disabled} onClick={onClick}>{icon}<span>{children}</span>{right}</button>
);

/* ------------------------- the frame in the note ------------------------- */
export function DocFrame({ p, editable, onChange, onRemove, onReplace, title = '' }) {
  const kind = p.kind || kindOf(p.name);
  const shown = canShow(p.name);
  const ext = extOf(p.name);
  const { buf, err: loadErr, retry } = useBytes(shown ? p.url : null);
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const [strip, setStrip] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [menu, setMenu] = useState(false);
  const [rangeMenu, setRangeMenu] = useState(false);
  const [view, setView] = useState(false);
  const [capEdit, setCapEdit] = useState(false);
  const [twoUp, setTwoUp] = useState(true);
  const menuBtn = useRef(null); const rangeBtn = useRef(null);
  const frame = useRef(null);
  const sheetsState = useSheets(kind === 'xls' && buf ? buf : null);
  const pdfState = usePdf(kind === 'pdf' && buf ? buf : null);
  const sheetKey = `pb-sheet:${baseOf(p.url)}`;
  const [sheetAt, setSheetAt] = useState(() => { try { return Number(localStorage.getItem(sheetKey)) || 0; } catch { return 0; } });
  const pickSheet = (i) => { setSheetAt(i); try { localStorage.setItem(sheetKey, String(i)); } catch { /* not kept */ } };

  // which pages of a PDF the note shows
  const total = pdfState.pdf ? pdfState.pdf.numPages : 0;
  const m = /^(\d+)-(\d+)$/.exec(p.pages || '');
  const first = m ? clamp(Number(m[1]), 1, Math.max(1, total || 9999)) : 1;
  const last = m ? clamp(Number(m[2]), first, Math.max(first, total || 9999)) : (total || 9999);
  const span = total ? last - first + 1 : 0;
  const wide = frame.current ? frame.current.clientWidth > 640 : true;
  const step = kind === 'pdf' && twoUp && wide ? 2 : 1;

  const n = kind === 'ppt' ? count : kind === 'pdf' ? span : kind === 'xls' ? (sheetsState.sheets || []).length : count;
  const go = (d) => {
    if (kind === 'doc') { setIdx((i) => clamp(i + d, 0, Math.max(0, count - 1))); return; }
    setIdx((i) => clamp(i + d * step, 0, Math.max(0, n - 1)));
  };
  const onKey = (e) => {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Enter' && e.target === frame.current) setView(true);
  };
  const meta = [p.meta || (kind === 'ppt' && count ? `${count} slide${count === 1 ? '' : 's'}` : ''), sizeText(p.size)].filter(Boolean).join(' · ');
  const canGet = editable || p.download !== false;
  const copyLink = async () => { try { await navigator.clipboard.writeText(location.origin + baseOf(p.url)); } catch { /* not allowed */ } setMenu(false); };
  const pdfLabel = m ? `Pages ${first} to ${last}` : 'All pages';

  return (
    <div className={`df-wrap fr-${p.frame || 'medium'}`} contentEditable={false} suppressContentEditableWarning>
      <div className="df-fr" ref={frame} tabIndex={0} onKeyDown={onKey} data-testid="docfile" data-kind={kind} aria-label={`${KINDS[kind].label}: ${p.name}`}>
        <div className="df-h">
          <TypeIcon kind={kind} />
          <div className="df-hn"><b title={p.name}>{p.name}</b><small data-testid="df-meta">{meta}</small></div>
          <span className="df-sp" />
          {kind === 'ppt' && count > 1 && <button type="button" className={`df-chip btn${strip ? ' on' : ''}`} data-testid="df-slides" aria-pressed={strip} onClick={() => setStrip((v) => !v)}>Slides</button>}
          {kind === 'pdf' && total > 0 && <button type="button" ref={rangeBtn} className="df-chip btn" data-testid="df-range" onClick={() => setRangeMenu((v) => !v)}>{pdfLabel}</button>}
          {canGet
            ? <a className={`df-btn${editable ? ' ic' : ''}`} href={downloadUrl(p.url)} download={p.name} data-testid="df-download" aria-label="Download" title="Download the original file"><Download size={15} />{!editable && 'Download'}</a>
            : <span className="df-chip off" data-testid="df-dl-off"><Lock size={12} />Download off</span>}
          {shown && <button type="button" className="df-btn ic" data-testid="df-expand" aria-label="Full screen" title="Full screen" onClick={() => setView(true)}><Maximize2 size={15} /></button>}
          {editable && <button type="button" ref={menuBtn} className="df-btn ic" data-testid="df-more" aria-label="More" title="More" onClick={() => setMenu((v) => !v)}><MoreHorizontal size={16} /></button>}
        </div>

        <div className="df-b">
          {!shown && <FileCard name={p.name} url={p.url} why={ext === 'pages' || ext === 'key' ? 'No preview for this type' : 'No preview for this type'} />}
          {shown && loadErr && (
            <Problem title={loadErr.code === 'gone' ? 'This file is no longer stored' : 'We could not make a preview'} body="The file itself is safe.">
              <button type="button" className="df-btn ac" data-testid="df-retry" onClick={() => { forgetBytes(p.url); retry(); }}><RotateCw size={14} />Try again</button>
              <a className="df-btn" href={downloadUrl(p.url)} download={p.name}><Download size={14} />Download</a>
            </Problem>
          )}
          {shown && !loadErr && !buf && <div className="df-busy" role="status"><i className="df-spin" />Loading the file…</div>}
          {shown && buf && kind === 'ppt' && (
            <div className="df-stagewrap">
              <SlidesView buf={buf} index={idx} setIndex={setIdx} onCount={setCount} mode="frame" strip={strip} />
              {count > 1 && <>
                <button type="button" className="df-arr l" aria-label="Previous slide" data-testid="df-prev" disabled={idx === 0} onClick={() => go(-1)}><ChevronLeft size={18} /></button>
                <button type="button" className="df-arr r" aria-label="Next slide" data-testid="df-next" disabled={idx >= count - 1} onClick={() => go(1)}><ChevronRight size={18} /></button>
                <span className="df-cnt" data-testid="df-count">{idx + 1} / {count}</span>
              </>}
            </div>
          )}
          {shown && buf && kind === 'doc' && (
            <div className="df-stagewrap">
              <DocPagesView buf={buf} onCount={setCount} zoom={zoom} setZoom={setZoom} pageNo={idx} setPageNo={(i, fromScroll) => { if (fromScroll) setIdx(i); else setIdx(i); }} mode="frame" />
              {count > 1 && <span className="df-cnt" data-testid="df-count">Page {idx + 1} of {count}</span>}
            </div>
          )}
          {shown && buf && kind === 'xls' && <SheetView sheets={sheetsState.sheets} err={sheetsState.err} at={sheetAt} mode="frame" />}
          {shown && buf && kind === 'pdf' && (
            <div className="df-stagewrap">
              <PdfView {...pdfState} onPassword={(pw) => pdfState.open(pw)} first={first} last={last} at={idx} mode="frame" twoUp={twoUp && wide} />
              {span > 1 && !pdfState.ask && pdfState.pdf && <>
                <button type="button" className="df-arr l" aria-label="Previous page" data-testid="df-prev" disabled={idx === 0} onClick={() => go(-1)}><ChevronLeft size={18} /></button>
                <button type="button" className="df-arr r" aria-label="Next page" data-testid="df-next" disabled={idx + step >= span} onClick={() => go(1)}><ChevronRight size={18} /></button>
                <span className="df-cnt" data-testid="df-count">{step === 2 && first + idx + 1 <= last ? `Pages ${first + idx} and ${first + idx + 1}` : `Page ${first + idx}`} of {total}</span>
              </>}
            </div>
          )}
        </div>

        {shown && buf && kind === 'doc' && count > 0 && (
          <div className="df-foot">
            {count > 1 ? <>
              <button type="button" className="df-btn sm" data-testid="df-prev" disabled={idx === 0} onClick={() => go(-1)}><ChevronLeft size={14} />Previous page</button>
              <ZoomBar zoom={zoom} fit={0} setZoom={setZoom} />
              <button type="button" className="df-btn sm" data-testid="df-next" disabled={idx >= count - 1} onClick={() => go(1)}>Next page<ChevronRight size={14} /></button>
            </> : <ZoomBar zoom={zoom} fit={0} setZoom={setZoom} />}
          </div>
        )}
        {shown && buf && kind === 'xls' && sheetsState.sheets && (
          <div className="df-tabs" role="tablist" aria-label="Sheets">
            {sheetsState.sheets.map((s, i) => <button key={s.name} type="button" role="tab" aria-selected={i === sheetAt} className={i === sheetAt ? 'on' : ''} data-testid="df-sheet-tab" onClick={() => pickSheet(i)}>{s.name}</button>)}
          </div>
        )}
      </div>

      {(p.caption || capEdit) && (editable
        ? <input className="df-cap" data-testid="df-caption" value={p.caption} autoFocus={capEdit} placeholder="Add a caption" aria-label="Caption" onChange={(e) => onChange({ caption: e.target.value })} onBlur={() => setCapEdit(false)} />
        : <div className="df-cap">{p.caption}</div>)}

      {menu && <Pop anchor={menuBtn.current} onClose={() => setMenu(false)} testid="df-menu">
        <Row tid="dm-replace" icon={<Upload size={15} />} onClick={() => { setMenu(false); onReplace(); }}>Replace file</Row>
        <Row tid="dm-download" icon={<Download size={15} />} onClick={() => { setMenu(false); const a = document.createElement('a'); a.href = downloadUrl(p.url); a.download = p.name; a.click(); }}>Download</Row>
        <Row tid="dm-link" icon={<Link2 size={15} />} onClick={copyLink}>Copy link to this file</Row>
        <hr />
        <div className="df-g">Frame size</div>
        <div className="df-seg" role="radiogroup" aria-label="Frame size">{FRAMES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={(p.frame || 'medium') === k} className={(p.frame || 'medium') === k ? 'on' : ''} data-testid={`dm-size-${k}`} onClick={() => onChange({ frame: k })}>{l}</button>)}</div>
        <Row tid="dm-caption" icon={<Type size={15} />} onClick={() => { setMenu(false); setCapEdit(true); }}>{p.caption ? 'Edit caption' : 'Add caption'}</Row>
        <label className="df-r sw" data-testid="dm-download-row"><Eye size={15} /><span>Readers can download</span><span className="df-swi"><input type="checkbox" role="switch" data-testid="dm-readers" checked={p.download !== false} onChange={(e) => onChange({ download: e.target.checked })} /><i /></span></label>
        <hr />
        <Row tid="dm-remove" danger icon={<Trash2 size={15} />} onClick={() => { setMenu(false); onRemove(); }}>Remove from note</Row>
      </Pop>}

      {rangeMenu && <Pop anchor={rangeBtn.current} width={250} onClose={() => setRangeMenu(false)} testid="df-range-menu">
        <div className="df-g">Show in the note</div>
        <Row tid="dr-all" icon={<Check size={15} style={{ opacity: m ? 0 : 1 }} />} onClick={() => { onChange({ pages: 'all' }); setIdx(0); setRangeMenu(false); }}>All pages</Row>
        <Row tid="dr-3" icon={<Check size={15} style={{ opacity: m && first === 1 && last === 3 ? 1 : 0 }} />} onClick={() => { onChange({ pages: '1-3' }); setIdx(0); setRangeMenu(false); }}>Pages 1 to 3</Row>
        <RangePicker total={total} first={first} last={last} editable={editable} onPick={(a, b) => { onChange({ pages: `${a}-${b}` }); setIdx(0); setRangeMenu(false); }} />
        <hr />
        <Row tid="dr-two" icon={<Eye size={15} />} right={twoUp ? <Check size={15} /> : null} onClick={() => setTwoUp((v) => !v)}>Two pages side by side</Row>
      </Pop>}

      {view && <DocViewer p={p} kind={kind} title={title} canDownload={canGet} onClose={() => setView(false)} startAt={idx} onAt={setIdx} />}
    </div>
  );
}

function RangePicker({ total, first, last, onPick }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(first); const [b, setB] = useState(last);
  if (!open) return <Row tid="dr-pick" icon={<span style={{ width: 15 }} />} onClick={() => setOpen(true)}>Pick pages…</Row>;
  return (
    <form className="df-pick" onSubmit={(e) => { e.preventDefault(); const x = clamp(Number(a) || 1, 1, total || 1); const y = clamp(Number(b) || x, x, total || x); onPick(x, y); }}>
      <label>From<input type="number" min="1" max={total || undefined} value={a} data-testid="dr-from" onChange={(e) => setA(e.target.value)} /></label>
      <label>To<input type="number" min="1" max={total || undefined} value={b} data-testid="dr-to" onChange={(e) => setB(e.target.value)} /></label>
      <button type="submit" className="df-btn ac sm" data-testid="dr-go">Show</button>
    </form>
  );
}

/* ------------------------- search inside a file (viewer) ------------------------- */
const hasHL = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
function rangesIn(root, term) {
  if (!root || !term) return [];
  const re = new RegExp(escapeRe(term), 'gi');
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.nodeValue; re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); out.push(r); if (!m[0].length) re.lastIndex += 1; }
  }
  return out;
}
const paint = (all, cur) => {
  if (!hasHL) return;
  try { CSS.highlights.set('df-hit', new Highlight(...all)); if (cur) CSS.highlights.set('df-cur', new Highlight(cur)); else CSS.highlights.delete('df-cur'); } catch { /* unsupported */ }
};
const unpaint = () => { if (hasHL) { CSS.highlights.delete('df-hit'); CSS.highlights.delete('df-cur'); } };

/* ------------------------- the full-screen viewer ------------------------- */
export function DocViewer({ p, kind, title, canDownload = true, onClose, startAt = 0, onAt }) {
  const { buf, err: loadErr, retry } = useBytes(p.url);
  const [idx, setIdx] = useState(startAt);
  const [count, setCount] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [goto, setGoto] = useState('');
  const [find, setFind] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState({ list: [], at: 0, pages: [] });
  const root = useRef(null); const slidesRef = useRef(null);
  const sheetsState = useSheets(kind === 'xls' && buf ? buf : null);
  const pdfState = usePdf(kind === 'pdf' && buf ? buf : null);
  const [sheetAt, setSheetAt] = useState(0);
  const total = kind === 'pdf' ? (pdfState.pdf ? pdfState.pdf.numPages : 0) : kind === 'xls' ? (sheetsState.sheets || []).length : count;
  const [pdfText, setPdfText] = useState(null);
  const input = useRef(null);
  const dark = true;

  useEffect(() => { document.documentElement.classList.add('df-viewing'); return () => { document.documentElement.classList.remove('df-viewing'); unpaint(); onAt?.(idx); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (d) => setIdx((i) => clamp(i + d, 0, Math.max(0, (kind === 'xls' ? 0 : total - 1))));
  const jump = (i) => { if (kind === 'xls') setSheetAt(clamp(i, 0, Math.max(0, total - 1))); else setIdx(clamp(i, 0, Math.max(0, total - 1))); };

  // search: slides and documents look at their own text, a sheet at the rows showing, a PDF at the text of each page
  useEffect(() => {
    if (!find || !term.trim()) { setHits({ list: [], at: 0, pages: [] }); unpaint(); return undefined; }
    let off = false;
    (async () => {
      if (kind === 'pdf') {
        if (!pdfState.pdf) return;
        let texts = pdfText;
        if (!texts) {
          texts = [];
          for (let i = 1; i <= pdfState.pdf.numPages; i += 1) { const pg = await pdfState.pdf.getPage(i); const tc = await pg.getTextContent(); texts.push(tc.items.map((it) => it.str).join(' ')); if (off) return; }
          setPdfText(texts);
        }
        const re = new RegExp(escapeRe(term.trim()), 'gi');
        const list = []; texts.forEach((t, i) => { const c = (t.match(re) || []).length; for (let k = 0; k < c; k += 1) list.push({ page: i }); });
        if (!off) { setHits({ list, at: 0, pages: [] }); if (list[0]) setIdx(list[0].page); }
        return;
      }
      const el = root.current; if (!el) return;
      const rs = rangesIn(el, term.trim());
      if (off) return;
      setHits({ list: rs, at: 0, pages: [] });
    })();
    return () => { off = true; };
  }, [find, term, kind, pdfState.pdf, sheetAt, count]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // show the current match
    const cur = hits.list[hits.at];
    if (!cur) { unpaint(); return; }
    if (kind === 'pdf') { setIdx(cur.page); return; }
    paint(hits.list, cur);
    if (kind === 'ppt') {
      const sl = cur.startContainer.parentElement?.closest('.pptx-preview-slide-wrapper');
      const all = [...(root.current?.querySelectorAll('.pptx-preview-slide-wrapper') || [])];
      const i = all.indexOf(sl); if (i >= 0 && i !== idx) setIdx(i);
    } else { cur.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }, [hits.at, hits.list]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextHit = (d) => setHits((h) => (h.list.length ? { ...h, at: (h.at + d + h.list.length) % h.list.length } : h));

  useEffect(() => {
    const key = (e) => {
      const typing = e.target.closest?.('input,textarea');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (find) { setFind(false); setTerm(''); unpaint(); } else onClose(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFind(true); setTimeout(() => input.current?.focus(), 30); return; }
      if (typing) { if (e.key === 'Enter' && e.target === input.current) { e.preventDefault(); nextHit(e.shiftKey ? -1 : 1); } return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); move(-1); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); } catch { /* not allowed */ } }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  });

  const label = kind === 'ppt' ? `${idx + 1} / ${total || '…'}` : kind === 'pdf' ? `${idx + 1} / ${total || '…'}` : kind === 'doc' ? (count > 1 ? `Page ${idx + 1} of ${count}` : 'Document') : kind === 'xls' ? (sheetsState.sheets ? sheetsState.sheets[sheetAt]?.name : '') : '';

  return createPortal(
    <div className="df-view" role="dialog" aria-modal="true" aria-label={p.name} data-testid="df-viewer" data-kind={kind}>
      <div className="df-vh">
        <TypeIcon kind={kind} />
        <span className="df-vn"><b>{p.name}</b><small>{[p.meta, title && `from the note ${title}`].filter(Boolean).join(' · ')}</small></span>
        <span className="df-sp" />
        {label && <span className="df-vchip" data-testid="df-vcount">{label}</span>}
        {kind === 'doc' && <ZoomBar zoom={zoom} fit={0} setZoom={setZoom} />}
        {canDownload && <a className="df-vbtn" href={downloadUrl(p.url)} download={p.name} data-testid="dv-download"><Download size={15} />Download</a>}
        <button type="button" className={`df-vbtn ic${find ? ' on' : ''}`} aria-label="Search in this file" data-testid="dv-search" onClick={() => { setFind((v) => !v); setTimeout(() => input.current?.focus(), 30); }}><Search size={15} /></button>
        <button type="button" className="df-vbtn ic ac" aria-label="Close" data-testid="dv-close" onClick={onClose}><X size={16} /></button>
      </div>
      {find && (
        <div className="df-vfind" data-testid="dv-find">
          <Search size={14} />
          <input ref={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search in this file" aria-label="Search in this file" data-testid="dv-term" />
          <span data-testid="dv-hits">{term.trim() ? (hits.list.length ? `${hits.at + 1} of ${hits.list.length}` : 'No matches') : ''}</span>
          <button type="button" aria-label="Previous match" onClick={() => nextHit(-1)}><ChevronUp size={14} /></button>
          <button type="button" aria-label="Next match" onClick={() => nextHit(1)}><ChevronDown size={14} /></button>
          <button type="button" aria-label="Close search" onClick={() => { setFind(false); setTerm(''); unpaint(); }}><X size={14} /></button>
        </div>
      )}
      <div className="df-vbody" ref={root}>
        {loadErr && <Problem title="We could not load the file" body="The file itself is safe."><button type="button" className="df-btn ac" onClick={() => { forgetBytes(p.url); retry(); }}>Try again</button></Problem>}
        {!loadErr && !buf && <div className="df-busy"><i className="df-spin" />Loading the file…</div>}
        {buf && kind === 'ppt' && <SlidesView buf={buf} index={idx} setIndex={setIdx} onCount={setCount} mode="full" strip />}
        {buf && kind === 'doc' && <DocPagesView buf={buf} onCount={setCount} zoom={zoom} setZoom={setZoom} pageNo={idx} setPageNo={(i) => setIdx(i)} mode="full" />}
        {buf && kind === 'xls' && <><SheetView sheets={sheetsState.sheets} err={sheetsState.err} at={sheetAt} mode="full" />{sheetsState.sheets && <div className="df-tabs full" role="tablist">{sheetsState.sheets.map((s, i) => <button key={s.name} type="button" role="tab" aria-selected={i === sheetAt} className={i === sheetAt ? 'on' : ''} onClick={() => setSheetAt(i)}>{s.name}</button>)}</div>}</>}
        {buf && kind === 'pdf' && <PdfView {...pdfState} onPassword={(pw) => pdfState.open(pw)} first={1} last={9999} at={idx} mode="full" twoUp={false} />}
        {(kind === 'ppt' || kind === 'pdf') && total > 1 && <>
          <button type="button" className="df-varr l" aria-label="Previous" data-testid="dv-prev" disabled={idx === 0} onClick={() => move(-1)}><ChevronLeft size={22} /></button>
          <button type="button" className="df-varr r" aria-label="Next" data-testid="dv-next" disabled={idx >= total - 1} onClick={() => move(1)}><ChevronRight size={22} /></button>
        </>}
      </div>
      {kind === 'doc' && count > 1 && (
        <form className="df-goto" onSubmit={(e) => { e.preventDefault(); const n = Number(goto); if (n >= 1 && n <= count) setIdx(n - 1); setGoto(''); }}>
          <span>Go to page</span><input value={goto} onChange={(e) => setGoto(e.target.value.replace(/\D/g, ''))} placeholder={String(idx + 1)} aria-label="Go to page" data-testid="dv-goto" /><span>of {count}</span>
        </form>
      )}
      {kind === 'pdf' && total > 1 && (
        <form className="df-goto" onSubmit={(e) => { e.preventDefault(); const n = Number(goto); if (n >= 1 && n <= total) setIdx(n - 1); setGoto(''); }}>
          <span>Go to page</span><input value={goto} onChange={(e) => setGoto(e.target.value.replace(/\D/g, ''))} placeholder={String(idx + 1)} aria-label="Go to page" data-testid="dv-goto" /><span>of {total}</span>
        </form>
      )}
      <div className="df-keys" aria-hidden="true"><span><kbd>←</kbd> <kbd>→</kbd> move</span><span><kbd>F</kbd> full screen</span><span><kbd>Ctrl</kbd> <kbd>F</kbd> search</span><span><kbd>Esc</kbd> back to the note</span></div>
    </div>,
    document.body,
  );
}

/* ------------------------- the block ------------------------- */
const toProps = (block) => ({ url: block.props.url, name: block.props.name, size: block.props.size, meta: block.props.meta, kind: kindOf(block.props.name), frame: block.props.frame, download: block.props.download, pages: block.props.pages, caption: block.props.caption });

export const docFileSpec = createReactBlockSpec(
  {
    type: 'docfile',
    propSchema: {
      url: { default: '' }, name: { default: '' }, size: { default: 0 }, meta: { default: '' },
      frame: { default: 'medium' }, download: { default: true }, pages: { default: 'all' }, caption: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => (
      <DocFrame
        p={toProps(block)}
        editable={editor.isEditable}
        title=""
        onChange={(props) => editor.updateBlock(block, { props })}
        onRemove={() => editor.removeBlocks([block])}
        onReplace={() => window.dispatchEvent(new CustomEvent('pb-docfile', { detail: { act: 'replace', id: block.id } }))}
      />
    ),
    // Markdown, copy and paste see an ordinary picture-style line carrying the address, which loads back as this block
    toExternalHTML: ({ block }) => <p><a href={packProps(toProps(block))}>{block.props.name}</a></p>,
  },
);

export { unpackProps, isFileUrl, packProps, uploadDoc, describe, bytesOf, rememberFile, pdfjs, ROW_CAP };
