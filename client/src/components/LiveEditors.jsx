import { useCallback, useEffect, useRef, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import api from '../api/client';
import { caretSelection, scrollToPeerBlock, showPeers } from '../utils/peerCursors';
import { setLive, useLive } from '../utils/liveStore';
import { CollabBar, CollabPanel, useCollabEvents } from './CollabPanel';

const SOON = 48 * 3600 * 1000;

/**
 * On the note you have open: who is on its share link right now (and what each person is doing), where they are in the
 * text, what happened on the link, and when it ends. Mounted once for every look of the app. It costs one cheap request
 * every 10 s when the open note is not shared.
 */
export default function LiveEditors() {
  const { pathname } = useLocation();
  const noteId = matchPath('/notes/:id', pathname)?.params.id || null;
  const live = useLive();
  const [activity, setActivity] = useState([]);
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  const [now, setNow] = useState(Date.now());
  const typedAt = useRef(0);
  const cursorRef = useRef(null);
  const selRef = useRef(null);
  const sharedRef = useRef(false);
  const fails = useRef(0);
  const collab = useCollabEvents(live.viewers, live.shared);

  // Follow: keep the view on another person until you scroll, press Escape, or they leave
  const [followId, setFollowId] = useState(null);
  const followBlock = useRef(null);
  useEffect(() => {
    if (!followId) { followBlock.current = null; return undefined; }
    const who = live.viewers.find((v) => v.id === followId && !v.self);
    if (!who) { setFollowId(null); return undefined; }
    if (who.cursor != null && who.cursor !== followBlock.current) { followBlock.current = who.cursor; scrollToPeerBlock(who.cursor); }
    return undefined;
  }, [followId, live.viewers]);
  useEffect(() => {
    if (!followId) return undefined;
    const stop = () => setFollowId(null);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } }; // stop following without also closing the panel
    const scroller = document;
    scroller.addEventListener('wheel', stop, { passive: true });
    scroller.addEventListener('touchmove', stop, { passive: true });
    document.addEventListener('keydown', onKey, true);
    return () => { scroller.removeEventListener('wheel', stop); scroller.removeEventListener('touchmove', stop); document.removeEventListener('keydown', onKey, true); };
  }, [followId]);

  // typing anywhere in the note editor or its title marks you as typing; the caret tells others where you are
  useEffect(() => {
    if (!noteId) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || (e.key.length > 1 && e.key !== 'Backspace' && e.key !== 'Enter' && e.key !== 'Delete')) return;
      if (e.target?.closest?.('.bn-editor, .block-editor-container, input, textarea')) typedAt.current = Date.now();
    };
    const onSel = () => { const s = caretSelection(); if (s) { cursorRef.current = s.block; selRef.current = s; } };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('selectionchange', onSel);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('selectionchange', onSel); };
  }, [noteId]);

  const poll = useCallback(async (id) => {
    const params = {};
    if (Date.now() - typedAt.current < 3000) params.typing = 1;
    if (cursorRef.current !== null) { params.cursor = cursorRef.current; if (selRef.current) { params.selStart = selRef.current.start; params.selEnd = selRef.current.end; } }
    const { data } = await api.get(`/share/note/${id}/live`, { params });
    sharedRef.current = !!data.shared;
    setLive({ noteId: id, shared: !!data.shared, token: data.token || null, canEdit: !!data.canEdit, expiresAt: data.expiresAt || null, viewers: data.viewers || [] });
  }, []);

  useEffect(() => {
    setLive({ noteId, shared: false, token: null, viewers: [], expiresAt: null, open: false, offline: false });
    sharedRef.current = false;
    fails.current = 0;
    if (!noteId || noteId === '__draft__') return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        await poll(noteId);
        if (stop) return;
        if (fails.current >= 2) { setSynced(true); collab.note('back'); window.setTimeout(() => setSynced(false), 4000); }
        fails.current = 0;
        setLive({ offline: false });
      } catch {
        // offline or the server is waking up: say so after two misses, keep trying
        fails.current += 1;
        if (!stop && fails.current >= 2) setLive({ offline: true });
      }
      // a shared note is checked every 3 s, an unshared one only every 10 s
      if (!stop) timer = setTimeout(tick, sharedRef.current ? 3000 : 10000);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); showPeers([]); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, poll]);

  // mark where the others are in the text
  useEffect(() => {
    const others = live.viewers.filter((v) => !v.self);
    const draw = () => showPeers(others);
    draw();
    const t = window.setInterval(draw, 1000);
    return () => window.clearInterval(t);
  }, [live.viewers]);

  const loadActivity = useCallback(async () => {
    try { const { data } = await api.get(`/share/note/${noteId}/activity`); setActivity(data.activity || []); } catch { /* shown empty */ }
  }, [noteId]);
  useEffect(() => {
    if (!live.open || !noteId) return undefined;
    void loadActivity();
    const t = window.setInterval(loadActivity, 5000);
    return () => window.clearInterval(t);
  }, [live.open, noteId, loadActivity]);

  // let join / leave pop-ups fade after a few seconds
  const recent = collab.events.filter((e) => now - e.at < 5000);
  useEffect(() => {
    if (!recent.length) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [recent.length]);

  const guarded = async (fn) => { setBusy(true); try { await fn(); await poll(noteId); } catch { /* the next poll shows the truth */ } finally { setBusy(false); } };
  const extend = (days) => guarded(() => api.post(`/share/note/${noteId}`, { expiresInDays: days }));
  const removeViewer = (id) => guarded(() => api.post(`/share/note/${noteId}/viewers/${id}/remove`));
  const turnOff = async () => {
    setBusy(true);
    try { await api.delete(`/share/note/${noteId}`); setLive({ shared: false, viewers: [], open: false, token: null }); } catch { /* still shared */ } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!live.token) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/s/note/${live.token}`); } catch { /* blocked: the Share dialog has the link */ }
  };

  const others = live.viewers.filter((v) => !v.self);
  const soon = !!live.expiresAt && new Date(live.expiresAt).getTime() - Date.now() < SOON;
  if (!noteId || !live.shared) return null;
  const showBar = others.length > 0 || soon || live.open || live.offline;
  return (
    <>
      {live.open && <div className="cp-drawer">
        <CollabPanel
          mode="owner" viewers={live.viewers} canEdit={live.canEdit} expiresAt={live.expiresAt} activity={activity}
          events={collab.events} offline={live.offline} synced={synced}
          muted={collab.muted} onMute={collab.setMuted} onClearEvents={collab.clear}
          onRemove={removeViewer} onExtend={extend} onTurnOff={turnOff} onCopy={copy} busy={busy}
          followId={followId} onFollow={setFollowId} link={live.token ? `${window.location.origin}/s/note/${live.token}` : ''}
          onClose={() => setLive({ open: false })}
        />
      </div>}
      {showBar && <CollabBar
        viewers={live.viewers} open={live.open} offline={live.offline} soon={soon} expiresAt={live.expiresAt}
        toasts={collab.muted ? [] : recent.filter((e) => e.kind === 'joined' || e.kind === 'left').slice(0, 2)}
        onDismissToast={collab.dismiss} onToggle={() => setLive({ open: !live.open })}
      />}
    </>
  );
}
