import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import api from '../api/client';
import './live-editors.css';

const initials = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'G';

/**
 * Shows, on the note you have open, who is on its share link right now and who is typing
 * ("Guest is typing…"). While you type, people on the link see that you are typing too.
 * It does nothing (one cheap request every 10 s) when the open note is not shared.
 * Mounted once for every look of the app, so it needs no change in the note screens.
 */
export default function LiveEditors() {
  const { pathname } = useLocation();
  const noteId = matchPath('/notes/:id', pathname)?.params.id || null;
  const [live, setLive] = useState({ shared: false, viewers: [] });
  const typedAt = useRef(0);
  const sharedRef = useRef(false);

  // typing anywhere in the note editor or its title marks you as typing
  useEffect(() => {
    if (!noteId) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.key.length > 1 && e.key !== 'Backspace' && e.key !== 'Enter' && e.key !== 'Delete') return;
      if (e.target?.closest?.('.bn-editor, .block-editor-container, input, textarea')) typedAt.current = Date.now();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [noteId]);

  useEffect(() => {
    setLive({ shared: false, viewers: [] });
    sharedRef.current = false;
    if (!noteId || noteId === '__draft__') return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const typing = Date.now() - typedAt.current < 3000 ? 1 : 0;
        const { data } = await api.get(`/share/note/${noteId}/live`, { params: typing ? { typing: 1 } : {} });
        if (stop) return;
        sharedRef.current = !!data.shared;
        setLive({ shared: !!data.shared, viewers: data.viewers || [] });
      } catch { /* offline or note gone: try again later */ }
      // a shared note is checked every 3 s, an unshared one only every 10 s
      if (!stop) timer = setTimeout(tick, sharedRef.current ? 3000 : 10000);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [noteId]);

  if (!noteId || !live.shared || live.viewers.length === 0) return null;
  const typers = live.viewers.filter((v) => v.typing);
  const lead = typers[0] || live.viewers[0];
  const text = typers.length === 1 ? `${typers[0].name} is typing`
    : typers.length === 2 ? `${typers[0].name} and ${typers[1].name} are typing`
      : typers.length > 2 ? `${typers.length} people are typing`
        : live.viewers.length === 1 ? `${live.viewers[0].name} is viewing this note` : `${live.viewers.length} people are viewing this note`;
  return (
    <div className={`pb-live${typers.length ? ' is-typing' : ''}`} role="status" aria-live="polite" data-testid="live-editors">
      <span className="pb-live-avs" aria-hidden="true">
        {live.viewers.slice(0, 3).map((v) => <span key={v.id} className={v.typing ? 'on' : ''}>{initials(v.name)}</span>)}
      </span>
      <span className="pb-live-text">{text}</span>
      {typers.length > 0 && <span className="pb-live-dots" aria-hidden="true"><i /><i /><i /></span>}
      <span className="pb-live-tag">shared link</span>
      <span hidden>{lead.id}</span>
    </div>
  );
}
