import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { X, Check, Copy, GitCompare, History, Clock, ArrowRight } from 'lucide-react';
import { compareModel, wordsOf } from '../utils/compare';
import { notesAPI } from '../api/index';
import { getToken } from '../api/token';
import CompareBox from './CompareBox';
import './editedby.css';

// "Priya updated this note": when someone else's edit lands while I am on the page, say who, show before and now,
// and let me take it, keep my version as a note, or compare in detail (mockups E1a, E1b).
const SMALL_KEY = 'peblo-edit-small-quiet';
const QUIET_MS = 2500; // a burst of typing counts as one update
const SMALL_WORDS = 12;
const readSmall = () => { try { return localStorage.getItem(SMALL_KEY) === '1'; } catch { return false; } };
const wordsIn = (html, cls) => (html.match(new RegExp(`<span class="cb-${cls}"[^>]*>([\\s\\S]*?)</span>`, 'g')) || []).reduce((n, s) => n + (s.replace(/<[^>]+>/g, ' ').match(/\S+/g) || []).length, 0);
const lineOf = (md, i) => {
  const l = String(md || '').split('\n').find((x) => x.includes(`data-chg="${i}"`));
  if (!l) return '';
  const t = l.replace(/<[^>]+>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '[picture]').replace(/^[#>*\-\s\d.]+/, '').trim();
  return t.length > 130 ? `${t.slice(0, 127)}…` : t;
};
const html = (md) => DOMPurify.sanitize(marked.parse(String(md || '')));
const firstLine = (md) => (String(md || '').split('\n').map((l) => l.replace(/^#+\s*/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()).find(Boolean) || 'Untitled').slice(0, 80);

export default function EditedBy({ rt, editor, ready }) {
  const [edit, setEdit] = useState(null); // { who, color, at, base, now, model, added, removed }
  const [dlg, setDlg] = useState(false);
  const [choice, setChoice] = useState('take');
  const [cmp, setCmp] = useState(false);
  const [quiet, setQuiet] = useState(readSmall);
  const [msg, setMsg] = useState('');
  const keeping = useRef(false);
  const dlgRef = useRef(null);
  useEffect(() => { if (dlg) dlgRef.current?.focus(); }, [dlg]); // focus inside so Escape works
  const st = useRef({ prev: null, base: null, timer: null, snap: null, live: false, since: 0, edit: null });
  st.current.edit = edit;

  const snap = useCallback(async () => { try { return await editor.blocksToMarkdownLossy(editor.document); } catch { return null; } }, [editor]);

  useEffect(() => {
    if (!rt || !ready) return undefined;
    const doc = rt.doc;
    const s = st.current;
    let alive = true;
    let local = null;
    // wait for the first sync to settle, then take the starting picture of the page
    const settle = setTimeout(async () => { s.prev = await snap(); s.live = true; }, 3000);
    const keepPrev = () => { clearTimeout(local); local = setTimeout(async () => { if (alive && !s.timer) s.prev = await snap(); }, 500); };
    const onUpdate = (_u, origin) => {
      if (!s.live || origin === 'pb-editors') return;
      if (origin !== rt.provider) { keepPrev(); return; }
      if (!s.timer) { s.since = Date.now(); s.base = s.edit ? s.edit.base : s.prev; }
      clearTimeout(s.timer);
      s.timer = setTimeout(async () => {
        s.timer = null;
        const base = s.base; const now = await snap();
        if (!alive || base == null || now == null) return;
        const model = compareModel(base, now);
        if (!model.changes.length) { s.prev = now; return; }
        const added = wordsIn(model.now, 'add'); const removed = wordsIn(model.earlier, 'del');
        // who: the last editor named in the shared page after this burst began, else whoever typed most recently
        let who = ''; let color = '#7c3aed'; let best = 0;
        doc.getMap('editors').forEach((v) => { if (v && v.t >= s.since - 1500 && v.t > best && v.n !== rt.user.name) { best = v.t; who = v.n; color = v.c || color; } });
        if (!who) { let tt = 0; rt.provider.awareness.getStates().forEach((a, id) => { if (id !== doc.clientID && a?.user && (a.typingAt || 0) >= tt) { tt = a.typingAt || 0; who = a.user.name; color = a.user.color || color; } }); }
        s.prev = now;
        if (readSmall() && added + removed <= SMALL_WORDS) return;
        setEdit({ who: who || 'Someone', color, at: Date.now(), base, now, model, added, removed });
      }, QUIET_MS);
    };
    doc.on('update', onUpdate);
    return () => { alive = false; clearTimeout(settle); clearTimeout(local); clearTimeout(s.timer); s.timer = null; s.live = false; doc.off('update', onUpdate); };
  }, [rt, ready, snap]);

  const ack = useCallback(() => { setEdit(null); setDlg(false); setCmp(false); st.current.base = null; }, []);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2600); };
  const keepMine = useCallback(async () => {
    if (!edit || keeping.current) return false;
    if (!getToken()) { flash('Sign in to keep a copy as a note'); return false; }
    keeping.current = true;
    try { await notesAPI.create({ title: `${firstLine(edit.base)} (my version)`, content: edit.base, tags: [] }); flash('Saved your version as its own note'); return true; }
    catch { flash('Could not save a copy'); return false; }
    finally { keeping.current = false; }
  }, [edit]);
  const setSmall = (v) => { setQuiet(v); try { localStorage.setItem(SMALL_KEY, v ? '1' : '0'); } catch { /* not remembered */ } };
  const go = async () => {
    if (choice === 'keep') { if (await keepMine()) ack(); }
    else if (choice === 'compare') { setDlg(false); setCmp(true); }
    else ack();
  };

  const before = useMemo(() => (edit ? lineOf(edit.model.earlier, 0) : ''), [edit]);
  const nowT = useMemo(() => (edit ? lineOf(edit.model.now, 0) : ''), [edit]);
  const pseudo = useMemo(() => (edit ? [{ id: '__before__', createdAt: new Date(edit.at - 1000).toISOString(), savedBy: 'You', label: 'Before the update' }] : []), [edit]);
  const loadBefore = useCallback(() => Promise.resolve(edit?.base ?? ''), [edit]);

  if (!edit && !msg) return null;
  return (
    <>
      {edit && !dlg && !cmp && <div className="eb-toast" role="status" aria-label="Note updated" data-testid="edited-toast">
        <div className="eb-h"><span className="eb-av" style={{ background: edit.color }}>{(edit.who[0] || '?').toUpperCase()}</span>
          <span className="eb-t"><b>{edit.who} updated this note</b><small>Just now · {edit.added} added, {edit.removed} removed</small></span>
          <button type="button" className="eb-x" aria-label="Dismiss" data-testid="eb-dismiss" onClick={ack}><X size={16} /></button></div>
        <div className="eb-vs"><div className="eb-m"><b>BEFORE</b>{before || '—'}</div><ArrowRight size={16} className="eb-ar" /><div className="eb-m n"><b>NOW</b>{nowT || '—'}</div></div>
        <div className="eb-acts">
          <button type="button" data-testid="eb-compare" onClick={() => { setChoice('take'); setDlg(true); }}><GitCompare size={14} />Compare</button>
          <button type="button" data-testid="eb-keep" onClick={async () => { if (await keepMine()) ack(); }}><Copy size={14} />Keep my version as a note</button>
          <button type="button" className="dk full" data-testid="eb-got" onClick={ack}><Check size={14} />Got it, keep the page open for everyone</button>
        </div>
      </div>}
      {msg && <div className="eb-flash" role="status">{msg}</div>}
      {edit && dlg && <div className="eb-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDlg(false); }}>
        <div className="eb-dlg" role="dialog" aria-modal="true" tabIndex={-1} ref={dlgRef} aria-label={`${edit.who} updated this note`} data-testid="edited-dialog" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setDlg(false); } }}>
          <div className="eb-dh"><span className="eb-av lg" style={{ background: edit.color }}>{(edit.who[0] || '?').toUpperCase()}</span><div><h3>{edit.who} updated this note</h3><small>Just now · the public page stays open for everyone</small></div>
            <button type="button" className="eb-x" aria-label="Close" onClick={() => setDlg(false)}><X size={18} /></button></div>
          <div className="eb-panes">
            <div className="eb-pane"><div className="eb-pt"><History size={15} />Before<span className="eb-chip">Your copy</span></div><div className="eb-pg" data-testid="eb-before" dangerouslySetInnerHTML={{ __html: html(edit.model.earlier) }} /></div>
            <div className="eb-pane"><div className="eb-pt"><Clock size={15} />Now<span className="eb-chip live">Live</span></div><div className="eb-pg" data-testid="eb-now" dangerouslySetInnerHTML={{ __html: html(edit.model.now) }} /></div>
          </div>
          <div className="eb-ch" role="radiogroup" aria-label="What to do">
            {[['take', Check, 'Take the update', 'Keep reading and editing the new version.'], ['keep', Copy, 'Keep my version too', 'Saves the before copy as its own note. The page stays open.'], ['compare', GitCompare, 'Compare in detail', 'Opens the full page by page compare.']].map(([k, Ic, t, d]) => (
              <button key={k} type="button" role="radio" aria-checked={choice === k} data-testid={`eb-opt-${k}`} className={`eb-opt${choice === k ? ' on' : ''}`} onClick={() => setChoice(k)}><b><Ic size={16} />{t}</b>{d}</button>))}
          </div>
          <div className="eb-foot">
            <label className="eb-sw"><input type="checkbox" role="switch" data-testid="eb-quiet" checked={quiet} onChange={(e) => setSmall(e.target.checked)} /><span className="sw" />Do not ask me again for small edits</label>
            <span className="eb-sp" />
            <button type="button" className="eb-b" data-testid="eb-later" onClick={() => setDlg(false)}>Later</button>
            <button type="button" className="eb-b ac" data-testid="eb-go" onClick={go}>{choice === 'keep' ? 'Keep my version' : choice === 'compare' ? 'Compare in detail' : 'Take the update'}</button>
          </div>
        </div>
      </div>}
      {edit && cmp && <CompareBox title={firstLine(edit.base)} now={{ content: edit.now, at: edit.at }} versions={pseudo} loadVersion={loadBefore} initialId="__before__" whoNow={edit.who}
        onClose={() => setCmp(false)} onRestore={async (v, text) => { try { editor.replaceBlocks(editor.document, await editor.tryParseMarkdownToBlocks(text)); } catch { /* keep the page as it is */ } ack(); }}
        onKeep={async () => { if (await keepMine()) { setCmp(false); } }} />}
    </>
  );
}
