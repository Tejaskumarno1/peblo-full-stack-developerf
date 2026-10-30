import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, LayoutGrid, StickyNote, X, CornerUpLeft } from 'lucide-react';
import { SlidesView, Thumb, useBytes, Problem } from './DocViews';
import { readNotes } from '../utils/docFiles';
import './docfile.css';

// Presenting a PowerPoint from a note (P4). The presenter steps through the deck; the slide number travels in the room's
// awareness ("deck"), people following see the same slide, can look ahead or back on their own, and return with one tap.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function DeckStage({ role, deck, lead, aw, laser, onLeave }) {
  const presenter = role === 'presenter';
  const url = presenter ? deck.url : lead.deck.u;
  const name = presenter ? deck.name : lead.deck.nm;
  const { buf, err } = useBytes(url);
  const [count, setCount] = useState(0);
  const [slides, setSlides] = useState(null);
  const [notes, setNotes] = useState([]);
  const [i, setI] = useState(0); // presenter: where the deck is; follower: where I am looking when I have wandered
  const [mine, setMine] = useState(null); // follower only: null = with the presenter
  const [strip, setStrip] = useState(false);
  const [side, setSide] = useState(() => window.innerWidth > 900);
  const [t0] = useState(() => Date.now());
  const [, tick] = useState(0);
  const box = useRef(null);

  const leadAt = presenter ? i : clamp(lead.deck.i || 0, 0, Math.max(0, (count || lead.deck.n || 1) - 1));
  const at = presenter ? i : (mine ?? leadAt);
  const n = count || (presenter ? 0 : lead?.deck?.n || 0);

  useEffect(() => { if (!buf) return undefined; let off = false; readNotes(buf).then((r) => { if (!off) setNotes(r); }).catch(() => { /* no speaker notes in this file */ }); return () => { off = true; }; }, [buf]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  // the presenter's place, for everyone following
  useEffect(() => {
    if (!presenter || !aw) return undefined;
    try { aw.setLocalStateField('deck', { u: url, nm: name, i, n: count }); } catch { /* gone */ }
    return undefined;
  }, [presenter, aw, url, name, i, count]);
  useEffect(() => () => { if (presenter && aw) { try { aw.setLocalStateField('deck', null); aw.setLocalStateField('dp', null); } catch { /* gone */ } } }, [presenter, aw]);
  useEffect(() => { // the laser dot, as a share of the slide
    if (!presenter || !aw) return undefined;
    if (!laser) { try { aw.setLocalStateField('dp', null); } catch { /* gone */ } return undefined; }
    let last = 0;
    const move = (e) => {
      const el = box.current?.querySelector('.df-slide-box'); if (!el) return;
      const r = el.getBoundingClientRect(); const now = Date.now(); if (now - last < 40) return; last = now;
      const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
      try { aw.setLocalStateField('dp', x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: +x.toFixed(4), y: +y.toFixed(4), i } : null); } catch { /* gone */ }
    };
    window.addEventListener('mousemove', move);
    return () => { window.removeEventListener('mousemove', move); try { aw.setLocalStateField('dp', null); } catch { /* gone */ } };
  }, [presenter, aw, laser, i]);

  const go = (d) => {
    const top = Math.max(0, n - 1);
    if (presenter) setI((v) => clamp(v + d, 0, top));
    else { const to = clamp(at + d, 0, top); setMine(to === leadAt ? null : to); }
  };
  const jump = (k) => {
    const to = clamp(k, 0, Math.max(0, n - 1));
    if (presenter) setI(to); else setMine(to === leadAt ? null : to);
  };
  const act = useRef(null); act.current = { go, jump, n, presenter }; // the key handler is set up once and always reads the latest
  useEffect(() => {
    const key = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input,textarea,[contenteditable="true"]')) return;
      const { go: g, jump: j, n: total, presenter: isP } = act.current;
      const k = e.key;
      let used = true;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'ArrowDown') g(1);
      else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp') g(-1);
      else if (k === 'Home') j(0);
      else if (k === 'End') j(Math.max(0, total - 1));
      else if (k === 's' || k === 'S') setStrip((v) => !v);
      else if ((k === 'n' || k === 'N') && isP) setSide((v) => !v);
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);

  const dot = !presenter && lead.dp && lead.dp.i === at ? lead.dp : null;
  const stop = (e) => e.stopPropagation(); // wheel and touch here must not count as "I scrolled the note"
  const noteText = (notes[at] || '').trim();
  const nextSlide = slides && slides[at + 1];

  return createPortal(
    <div className={`pb-deck ${role}`} role="dialog" aria-modal="true" aria-label={`Slides: ${name}`} data-testid="deck" data-role={role} onWheel={stop} onTouchMove={stop}>
      <div className="dk-main">
        <div className="dk-top">
          <span className="dk-name" title={name}>{name}</span>
          {!presenter && <span className="dk-who">{lead.name} is presenting</span>}
          <span className="dk-sp" />
          {presenter && <span className="dk-chip" data-testid="deck-timer">{mmss(Date.now() - t0)}</span>}
          {!presenter && mine !== null && mine !== leadAt && (
            <button type="button" className="dk-btn ac" data-testid="deck-back" onClick={() => setMine(null)}><CornerUpLeft size={14} />Back to presenter, slide {leadAt + 1}</button>
          )}
          {!presenter && <button type="button" className="dk-btn ic" aria-label="Stop following" title="Stop following" data-testid="deck-leave" onClick={onLeave}><X size={16} /></button>}
        </div>
        <div className="dk-stage" ref={box}>
          {err && <Problem title="The slides could not be loaded" body="The presenter's deck is not reachable right now." />}
          {!err && !buf && <div className="df-busy" style={{ color: '#e8e0d6' }}><i className="df-spin" />Loading the slides…</div>}
          {buf && <SlidesView buf={buf} index={at} setIndex={jump} onCount={setCount} onSlides={setSlides} mode="deck" strip={strip} overlay={dot ? <i className="dk-dot" style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }} data-testid="deck-dot" /> : null} />}
        </div>
        <div className="dk-bar" role="toolbar" aria-label="Slides">
          <button type="button" className="dk-btn ic" aria-label="Previous slide" data-testid="deck-prev" disabled={at <= 0} onClick={() => go(-1)}><ChevronLeft size={18} /></button>
          <span className="dk-count" data-testid="deck-count">{at + 1} / {n || '…'}</span>
          <button type="button" className="dk-btn ic" aria-label="Next slide" data-testid="deck-next" disabled={n > 0 && at >= n - 1} onClick={() => go(1)}><ChevronRight size={18} /></button>
          <span className="dk-gap" />
          <button type="button" className={`dk-btn ic${strip ? ' on' : ''}`} aria-label="All slides" aria-pressed={strip} title="All slides (S)" data-testid="deck-strip" onClick={() => setStrip((v) => !v)}><LayoutGrid size={16} /></button>
          {presenter && <button type="button" className={`dk-btn ic${side ? ' on' : ''}`} aria-label="Notes and next slide" aria-pressed={side} title="Notes and next slide (N)" data-testid="deck-side" onClick={() => setSide((v) => !v)}><StickyNote size={16} /></button>}
        </div>
      </div>
      {presenter && side && (
        <aside className="dk-side" data-testid="deck-side-panel">
          <div className="dk-lbl">Next</div>
          <div className="dk-next" data-testid="deck-next-thumb">{nextSlide ? <Thumb el={nextSlide.el} h={nextSlide.h} w={260} /> : <span className="dk-end">{n ? 'Last slide' : ''}</span>}</div>
          <div className="dk-lbl">Speaker notes</div>
          <div className="dk-notes" data-testid="deck-notes">{noteText || <em>No notes on this slide.</em>}</div>
        </aside>
      )}
    </div>, document.body);
}
