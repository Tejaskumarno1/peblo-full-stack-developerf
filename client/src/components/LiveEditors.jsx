import { useCallback, useEffect, useRef, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { Clock, X } from 'lucide-react';
import api from '../api/client';
import { caretBlock, showPeers, peerColor } from '../utils/peerCursors';
import './live-editors.css';

const initials = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'G';
const ago = (value) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const left = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const h = ms / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(ms / 60000))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};
const SOON = 48 * 3600 * 1000;
const WORDS = { viewed: 'opened the link', edited: 'edited the note', merged: 'edited (merged with other changes)', clash: 'edited (both versions kept)' };

/**
 * On the note you have open: who is on its share link right now, who is typing, where in the text they are,
 * what happened on the link, and when the link ends (with a one-click extend). Mounted once for every look of the app.
 * It does nothing (one cheap request every 10 s) when the open note is not shared.
 */
export default function LiveEditors() {
  const { pathname } = useLocation();
  const noteId = matchPath('/notes/:id', pathname)?.params.id || null;
  const [live, setLive] = useState({ shared: false, viewers: [], expiresAt: null });
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState([]);
  const [busy, setBusy] = useState(false);
  const typedAt = useRef(0);
  const cursorRef = useRef(null);
  const sharedRef = useRef(false);

  // typing anywhere in the note editor or its title marks you as typing; the caret tells others where you are
  useEffect(() => {
    if (!noteId) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || (e.key.length > 1 && e.key !== 'Backspace' && e.key !== 'Enter' && e.key !== 'Delete')) return;
      if (e.target?.closest?.('.bn-editor, .block-editor-container, input, textarea')) typedAt.current = Date.now();
    };
    const onSel = () => { const at = caretBlock(); if (at !== null) cursorRef.current = at; };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('selectionchange', onSel);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('selectionchange', onSel); };
  }, [noteId]);

  useEffect(() => {
    setLive({ shared: false, viewers: [], expiresAt: null });
    setOpen(false);
    sharedRef.current = false;
    if (!noteId || noteId === '__draft__') return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const params = {};
        if (Date.now() - typedAt.current < 3000) params.typing = 1;
        if (cursorRef.current !== null) params.cursor = cursorRef.current;
        const { data } = await api.get(`/share/note/${noteId}/live`, { params });
        if (stop) return;
        sharedRef.current = !!data.shared;
        setLive({ shared: !!data.shared, viewers: data.viewers || [], expiresAt: data.expiresAt || null });
      } catch { /* offline or note gone: try again later */ }
      // a shared note is checked every 3 s, an unshared one only every 10 s
      if (!stop) timer = setTimeout(tick, sharedRef.current ? 3000 : 10000);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); showPeers([]); };
  }, [noteId]);

  // mark where the others are in the text
  useEffect(() => {
    const draw = () => showPeers(live.viewers);
    draw();
    const t = window.setInterval(draw, 1000);
    return () => window.clearInterval(t);
  }, [live.viewers]);

  const loadActivity = useCallback(async () => {
    try { const { data } = await api.get(`/share/note/${noteId}/activity`); setActivity(data.activity || []); } catch { /* shown empty */ }
  }, [noteId]);
  useEffect(() => {
    if (!open || !noteId) return undefined;
    void loadActivity();
    const t = window.setInterval(loadActivity, 5000);
    return () => window.clearInterval(t);
  }, [open, noteId, loadActivity]);

  const extend = async (days) => {
    setBusy(true);
    try {
      await api.post(`/share/note/${noteId}`, { expiresInDays: days });
      const { data } = await api.get(`/share/note/${noteId}/live`);
      setLive({ shared: !!data.shared, viewers: data.viewers || [], expiresAt: data.expiresAt || null });
    } finally { setBusy(false); }
  };

  const soon = live.expiresAt && new Date(live.expiresAt).getTime() - Date.now() < SOON;
  if (!noteId || !live.shared || (live.viewers.length === 0 && !soon && !open)) return null;

  const typers = live.viewers.filter((v) => v.typing);
  const text = typers.length === 1 ? `${typers[0].name} is typing`
    : typers.length === 2 ? `${typers[0].name} and ${typers[1].name} are typing`
      : typers.length > 2 ? `${typers.length} people are typing`
        : live.viewers.length === 1 ? `${live.viewers[0].name} is viewing this note`
          : live.viewers.length > 1 ? `${live.viewers.length} people are viewing this note`
            : soon ? `Shared link ends in ${left(live.expiresAt)}` : 'Shared link';
  return (
    <div className="pb-live-wrap">
      {open && <div className="pb-live-panel" role="dialog" aria-label="Shared link activity" data-testid="live-panel">
        <div className="pb-live-head"><b>Shared link</b><button type="button" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button></div>
        <div className="pb-live-sec">On the link now</div>
        {live.viewers.length === 0 && <p className="pb-live-empty">Nobody right now.</p>}
        {live.viewers.map((v) => (
          <div key={v.id} className="pb-live-row">
            <span className="pb-live-av" style={{ background: peerColor(v.id) }}>{initials(v.name)}</span>
            <span className="pb-live-who">{v.name}{v.owner ? ' (owner)' : ''}</span>
            <span className="pb-live-state">{v.typing ? 'typing…' : v.cursor != null ? `paragraph ${v.cursor + 1}` : 'viewing'}</span>
          </div>
        ))}
        <div className="pb-live-sec">Link ends</div>
        <div className={`pb-live-exp${soon ? ' soon' : ''}`} data-testid="live-expiry">
          <Clock size={14} />
          <span>{live.expiresAt ? `in ${left(live.expiresAt)} (${new Date(live.expiresAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : 'Never ends'}</span>
        </div>
        <div className="pb-live-ext">
          <button type="button" disabled={busy} onClick={() => extend(1)}>+1 day</button>
          <button type="button" disabled={busy} onClick={() => extend(7)}>+7 days</button>
          <button type="button" disabled={busy} onClick={() => extend(null)}>Never</button>
        </div>
        <div className="pb-live-sec">Recent activity</div>
        {activity.length === 0 && <p className="pb-live-empty">Nothing yet.</p>}
        <ul className="pb-live-log" data-testid="live-activity">
          {activity.map((a, i) => <li key={`${a.at}-${i}`}><b>{a.actor}</b> {WORDS[a.action] || a.action}<span>{ago(a.at)}</span></li>)}
        </ul>
      </div>}
      <button type="button" className={`pb-live${typers.length ? ' is-typing' : ''}${soon ? ' is-soon' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="live-editors" title="Who is on this link, and what happened">
        {live.viewers.length > 0 && <span className="pb-live-avs" aria-hidden="true">
          {live.viewers.slice(0, 3).map((v) => <span key={v.id} className={v.typing ? 'on' : ''}>{initials(v.name)}</span>)}
        </span>}
        <span className="pb-live-text">{text}</span>
        {typers.length > 0 && <span className="pb-live-dots" aria-hidden="true"><i /><i /><i /></span>}
        {soon && live.viewers.length > 0 && <span className="pb-live-tag warn">ends in {left(live.expiresAt)}</span>}
        <span className="pb-live-tag">shared link</span>
      </button>
    </div>
  );
}
