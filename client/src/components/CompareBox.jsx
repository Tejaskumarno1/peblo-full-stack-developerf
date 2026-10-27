import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { X, SlidersHorizontal, ChevronDown, ChevronLeft, ChevronRight, History, Clock, Copy, Undo2, GripVertical, FileText, Type, List } from 'lucide-react';
import { compareModel, wordsOf } from '../utils/compare';
import { peerColor } from '../utils/peerCursors';
import './compare.css';

const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP]M)$/i, (m, x) => ` ${x.toLowerCase()}`);
/** "3 h ago", "Yesterday 6:12 pm", "Sat 4:02 pm", "12 Oct" */
export function stamp(value) {
  const d = new Date(value);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 6 && d.toDateString() === new Date().toDateString()) return `${Math.round(mins / 60)} h ago`;
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `Today ${clock(d)}`;
  if (days === 1) return `Yesterday ${clock(d)}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${clock(d)}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
const dotLabel = (v) => { const s = stamp(v.createdAt); return s.replace(/^(\w{3}) .*$/, '$1'); };
const KEY = 'peblo-compare-view';
const loadView = () => { try { return { show: 'pages', pics: 'low', ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { show: 'pages', pics: 'low' }; } };

const pageHtml = (md, show) => {
  if (show === 'text') {
    const lines = String(md || '').split('\n').map((l) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, '[picture]').replace(/^(\s*)(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+)/, '$1'));
    return DOMPurify.sanitize(lines.map((l) => `<div class="cb-line">${l || '&nbsp;'}</div>`).join(''), { ADD_ATTR: ['data-chg'] });
  }
  return DOMPurify.sanitize(marked.parse(String(md || '')), { ADD_ATTR: ['data-chg'] });
};

export default function CompareBox({ title = 'Note', now, versions, loadVersion, initialId, whoNow = '', onClose, onRestore, onKeep }) {
  const chrono = useMemo(() => [...versions].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [versions]);
  const [earlierId, setEarlierId] = useState(() => initialId || chrono[chrono.length - 1]?.id);
  const [texts, setTexts] = useState({});
  const [mode, setMode] = useState('side'); // side | overlay | marked
  const [view, setView] = useState(loadView);
  const [clean, setClean] = useState(false);
  const [menu, setMenu] = useState(null); // 'view' | 'versions'
  const [vmode, setVmode] = useState('compare'); // compare | preview
  const [pos, setPos] = useState(50);
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState('');
  const refs = { a: useRef(null), b: useRef(null), m: useRef(null), o: useRef(null) };
  const dlg = useRef(null);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(view)); } catch { /* not remembered */ } }, [view]);
  useEffect(() => {
    let live = true;
    chrono.slice(-30).forEach((v) => {
      Promise.resolve(loadVersion(v)).then((c) => { if (live) setTexts((t) => (v.id in t ? t : { ...t, [v.id]: c ?? '' })); }).catch(() => { if (live) setTexts((t) => ({ ...t, [v.id]: null })); });
    });
    return () => { live = false; };
  }, [chrono, loadVersion]);
  useEffect(() => { dlg.current?.focus(); }, []);

  const earlier = chrono.find((v) => v.id === earlierId) || chrono[chrono.length - 1];
  const oldMd = earlier ? texts[earlier.id] : null;
  const preview = vmode === 'preview';
  const model = useMemo(() => (oldMd == null ? null : compareModel(oldMd, now.content || '', whoNow)), [oldMd, now.content, whoNow]);
  const changes = model?.changes || [];
  const total = changes.length;
  useEffect(() => { setCur(0); }, [earlierId]);

  const html = useMemo(() => {
    if (!model) return { a: '', b: '', m: '' };
    if (preview) return { a: pageHtml(oldMd, view.show), b: pageHtml(now.content, view.show), m: '' };
    return { a: pageHtml(model.earlier, view.show), b: pageHtml(model.now, view.show), m: pageHtml(clean ? now.content : model.merged, view.show) };
  }, [model, preview, oldMd, now.content, view.show, clean]);

  // mark and scroll to the current change
  useEffect(() => {
    const roots = [refs.a.current, refs.b.current, refs.m.current, refs.o.current].filter(Boolean);
    roots.forEach((r) => { r.querySelectorAll('.cb-cur').forEach((n) => n.classList.remove('cb-cur')); });
    if (!total || preview) return;
    roots.forEach((r) => {
      const hits = r.querySelectorAll(`[data-chg="${cur}"]`);
      hits.forEach((n) => n.classList.add('cb-cur'));
      const first = hits[0];
      if (first) { const box = r.closest('.cb-scroll') || r; box.scrollTo?.({ top: Math.max(0, first.offsetTop - box.clientHeight / 3), behavior: 'smooth' }); }
    });
  }, [cur, mode, html, total, preview]);

  const stepChange = useCallback((d) => { if (total) setCur((c) => (c + d + total) % total); }, [total]);
  const idxOf = chrono.findIndex((v) => v.id === earlier?.id);
  const pickIdx = useCallback((i) => { const v = chrono[Math.max(0, Math.min(chrono.length - 1, i))]; if (v) setEarlierId(v.id); }, [chrono]);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (menu) setMenu(null); else onClose(); return; }
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); pickIdx(idxOf - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pickIdx(idxOf + 1); }
    else if (e.key === 'ArrowDown' || e.key === 'n') { stepChange(1); }
    else if (e.key === 'ArrowUp' || e.key === 'p') { stepChange(-1); }
  };

  // keep the two pages level when one is scrolled
  const sync = (from) => (e) => {
    const other = from === 'a' ? refs.b.current?.closest('.cb-scroll') : refs.a.current?.closest('.cb-scroll');
    const s = e.currentTarget;
    if (!other || other.dataset.lock === '1') return;
    other.dataset.lock = '1';
    other.scrollTop = (s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight)) * Math.max(0, other.scrollHeight - other.clientHeight);
    requestAnimationFrame(() => { other.dataset.lock = ''; });
  };

  const dragOverlay = (e) => {
    const box = e.currentTarget.closest('.cb-overlay'); if (!box) return;
    const move = (ev) => { const r = box.getBoundingClientRect(); setPos(Math.max(2, Math.min(98, ((ev.clientX - r.left) / r.width) * 100))); };
    e.preventDefault(); move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const dotsPos = (i, n) => (n <= 1 ? 50 : 4 + (i / (n - 1)) * 93);
  const dots = [...chrono, { id: '__now__', createdAt: Date.now(), now: true }];
  const dragSlider = (e) => {
    const track = e.currentTarget; const r = track.getBoundingClientRect();
    const at = (ev) => { const x = ((ev.clientX - r.left) / r.width) * 100; let best = 0; chrono.forEach((_, i) => { if (Math.abs(dotsPos(i, dots.length) - x) < Math.abs(dotsPos(best, dots.length) - x)) best = i; }); pickIdx(best); };
    at(e);
    const move = (ev) => at(ev); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const delta = (v) => {
    const i = chrono.findIndex((x) => x.id === v.id);
    const prev = chrono[i - 1];
    if (texts[v.id] == null || (prev && texts[prev.id] == null)) return '';
    const d = wordsOf(texts[v.id]) - (prev ? wordsOf(texts[prev.id]) : 0);
    return `${d >= 0 ? '+' : ''}${d} word${Math.abs(d) === 1 ? '' : 's'}`;
  };
  const kind = changes[cur]?.kind || '';
  const cls = `cb-page${view.pics === 'low' ? ' cb-low' : ''}${view.show === 'text' ? ' cb-text' : ''}`;
  const ready = model != null;

  const keep = async () => { if (!earlier || oldMd == null) return; setBusy('keep'); try { await onKeep?.({ title: `${title} (${stamp(earlier.createdAt)})`, content: oldMd, version: earlier }); } finally { setBusy(''); } };
  const restore = async () => { if (!earlier || oldMd == null) return; setBusy('restore'); try { await onRestore?.(earlier, oldMd); } finally { setBusy(''); } };

  return (
    <div className="cb-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cb-dlg" role="dialog" aria-label="Compare versions" tabIndex={-1} ref={dlg} onKeyDown={onKey} data-testid="compare-box" data-mode={mode}>
        <div className="cb-hd">
          <h3>Compare versions</h3>
          <button type="button" className="cb-sub" data-testid="cb-versions-btn" aria-haspopup="listbox" aria-expanded={menu === 'versions'} onClick={() => setMenu((m) => (m === 'versions' ? null : 'versions'))}>{earlier ? `${stamp(earlier.createdAt)} to now` : 'No earlier versions'}<ChevronDown size={14} /></button>
          <div className="cb-sp" />
          <span className="cb-seg" role="tablist" aria-label="How to compare">{[['side', 'Side by side'], ['overlay', 'Overlay'], ['marked', 'Marked up']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} data-testid={`cb-mode-${k}`} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</span>
          <button type="button" className={`cb-btn${menu === 'view' ? ' ac' : ''}`} data-testid="cb-view-btn" aria-expanded={menu === 'view'} onClick={() => setMenu((m) => (m === 'view' ? null : 'view'))}><SlidersHorizontal size={15} />View<ChevronDown size={14} /></button>
          <button type="button" className="cb-btn ic" aria-label="Close" data-testid="cb-close" onClick={onClose}><X size={16} /></button>
        </div>

        {menu === 'view' && <div className="cb-menu right" data-testid="cb-view-menu">
          <div><div className="cb-t">Show</div><div className="cb-gp">
            <button type="button" className={`cb-o${view.show === 'pages' ? ' on' : ''}`} data-testid="cb-show-pages" onClick={() => setView((v) => ({ ...v, show: 'pages' }))}><FileText size={16} /><span>Whole pages<small>Layout as it looks</small></span></button>
            <button type="button" className={`cb-o${view.show === 'text' ? ' on' : ''}`} data-testid="cb-show-text" onClick={() => setView((v) => ({ ...v, show: 'text' }))}><Type size={16} /><span>Text only<small>Words, no layout</small></span></button></div></div>
          <div><div className="cb-t">Pictures</div><span className="cb-seg">{[['low', 'Low quality'], ['high', 'High quality']].map(([k, l]) => <button key={k} type="button" data-testid={`cb-pics-${k}`} className={view.pics === k ? 'on' : ''} onClick={() => setView((v) => ({ ...v, pics: k }))}>{l}</button>)}</span></div>
          <div><div className="cb-t">Changes</div>
            <button type="button" className="cb-o" data-testid="cb-list-changes" disabled={!total} onClick={() => setMenu('changes')}><List size={16} /><span>List all {total} change{total === 1 ? '' : 's'}<small>Click one to jump to it</small></span></button></div>
        </div>}
        {menu === 'changes' && <div className="cb-menu right" data-testid="cb-changes-list"><div className="cb-t">{total} changes</div>
          {changes.map((c) => <button key={c.i} type="button" className={`cb-o${c.i === cur ? ' on' : ''}`} onClick={() => { setCur(c.i); setMenu(null); }}><span>Change {c.i + 1}<small>{c.kind}</small></span></button>)}</div>}
        {menu === 'versions' && <div className="cb-menu left" role="listbox" aria-label="Versions" data-testid="cb-versions">
          <div className="cb-rw"><b>Versions, {chrono.length} kept</b><div className="cb-sp" /><span className="cb-seg">{[['preview', 'Preview'], ['compare', 'Compare with now']].map(([k, l]) => <button key={k} type="button" data-testid={`cb-vm-${k}`} className={vmode === k ? 'on' : ''} onClick={() => setVmode(k)}>{l}</button>)}</span></div>
          {[...chrono].reverse().map((v) => <button key={v.id} type="button" role="option" aria-selected={v.id === earlier?.id} className={`cb-v${v.id === earlier?.id ? ' on' : ''}`} data-testid="cb-version" onClick={() => { setEarlierId(v.id); setMenu(null); }}>
            <span className="cb-av" style={{ background: peerColor(v.savedBy || 'You') }}>{(v.savedBy || 'You')[0].toUpperCase()}</span>
            <span className="cb-vt"><b>{v.savedBy || 'You'}</b><small>{stamp(v.createdAt)}{delta(v) ? `, ${delta(v)}` : ''}{v.label ? ` · ${v.label}` : ''}</small></span>
            {v.id === earlier?.id && <span className="cb-chip ok">Earlier side</span>}</button>)}
        </div>}

        <div className="cb-body" onClick={() => { if (menu === 'view') setMenu(null); }}>
          {!earlier && <p className="cb-msg">There is no earlier version to compare yet.</p>}
          {earlier && !ready && <p className="cb-msg">Loading…</p>}
          {ready && mode === 'side' && <>
            <div className="cb-box"><div className="cb-bt"><History size={15} />{preview ? 'Preview' : 'Earlier'}<span className="cb-chip">{stamp(earlier.createdAt)}</span></div><div className="cb-scroll" onScroll={sync('a')}><div className={cls} ref={refs.a} data-testid="cb-earlier" dangerouslySetInnerHTML={{ __html: html.a }} /></div></div>
            <div className="cb-box"><div className="cb-bt"><Clock size={15} />Now<span className="cb-chip acc">{whoNow ? `Edited by ${whoNow}` : stamp(now.at || Date.now())}</span></div><div className="cb-scroll" onScroll={sync('b')}><div className={cls} ref={refs.b} data-testid="cb-now" dangerouslySetInnerHTML={{ __html: html.b }} /></div></div>
          </>}
          {ready && mode === 'overlay' && <div className="cb-box wide">
            <div className="cb-bt"><History size={15} />Earlier<span className="cb-chip">{stamp(earlier.createdAt)}</span><span className="cb-hint">Drag the round handle left or right to see through</span><Clock size={15} />Now<span className="cb-chip acc">{whoNow ? `Edited by ${whoNow}` : 'Live'}</span></div>
            <div className="cb-overlay" data-testid="cb-overlay">
              <div className="cb-scroll under"><div className={cls} ref={refs.b} dangerouslySetInnerHTML={{ __html: html.b }} /></div>
              <div className="cb-scroll over" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}><div className={cls} ref={refs.a} dangerouslySetInnerHTML={{ __html: html.a }} /></div>
              <div className="cb-handle" data-testid="cb-handle" role="slider" tabIndex={0} aria-label="Overlay position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} style={{ left: `${pos}%` }}
                onPointerDown={dragOverlay} onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); setPos((p) => Math.max(2, p - 5)); } if (e.key === 'ArrowRight') { e.stopPropagation(); setPos((p) => Math.min(98, p + 5)); } }}><span><GripVertical size={16} /></span></div>
            </div>
          </div>}
          {ready && mode === 'marked' && <div className="cb-box wide">
            <div className="cb-bt"><span className="cb-seg">{[[false, 'Marked up'], [true, 'Clean']].map(([k, l]) => <button key={l} type="button" data-testid={`cb-${k ? 'clean' : 'marks'}`} className={clean === k ? 'on' : ''} onClick={() => setClean(k)}>{l}</button>)}</span>
              <span className="cb-legend"><i className="cb-add" />Added<i className="cb-del" />Removed</span></div>
            <div className="cb-scroll"><div className={`${cls} wide`} ref={refs.m} data-testid="cb-marked" dangerouslySetInnerHTML={{ __html: html.m }} /></div>
          </div>}
          {ready && !preview && <div className="cb-pill" data-testid="cb-pill"><button type="button" aria-label="Previous change" data-testid="cb-prev" disabled={!total} onClick={() => stepChange(-1)}><ChevronLeft size={16} /></button><span>{total ? `Change ${cur + 1} of ${total}: ${kind}` : 'No differences'}</span><button type="button" aria-label="Next change" data-testid="cb-next" disabled={!total} onClick={() => stepChange(1)}><ChevronRight size={16} /></button></div>}
        </div>

        <div className="cb-ft">
          <div className="cb-tl">
            <div className="cb-track" data-testid="cb-track" onPointerDown={dragSlider}>
              <u style={{ left: `${dotsPos(Math.max(0, idxOf), dots.length)}%` }} />
              {dots.map((v, i) => <i key={v.id} data-testid={v.now ? 'cb-dot-now' : 'cb-dot'} className={v.now ? 'n' : v.id === earlier?.id ? 'a' : ''} style={{ left: `${dotsPos(i, dots.length)}%` }} title={v.now ? 'Now' : stamp(v.createdAt)} />)}
              {dots.map((v, i) => { const show = v.now || v.id === earlier?.id || i === 0 || (dots.length <= 5); return show ? <s key={`l${v.id}`} style={{ left: `${dotsPos(i, dots.length)}%` }}>{v.now ? 'Now' : v.id === earlier?.id ? stamp(v.createdAt) : dotLabel(v)}</s> : null; })}
            </div>
            <div className="cb-help">Drag a dot to move through versions. <kbd>Left</kbd> <kbd>Right</kbd></div>
          </div>
          <div className="cb-rw"><button type="button" className="cb-btn" data-testid="cb-keep" disabled={!ready || !!busy} onClick={keep}><Copy size={15} />Keep as a separate note</button><button type="button" className="cb-btn ac" data-testid="cb-restore" disabled={!ready || !!busy} onClick={restore}><Undo2 size={15} />Restore this version</button></div>
        </div>
      </div>
    </div>
  );
}
