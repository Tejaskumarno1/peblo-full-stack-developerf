import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, Check, Copy, X } from 'lucide-react';
import { notesAPI } from '../api';
import { Backdrop, iconOf, toneOf, useCurrentSpace, useWorkspaces } from './spaces';

/** Move a note to another space, or share a copy (mockups A05, A06, A07, A07b). Shown only to people who belong to an organization. */
export default function MoveNote({ noteId, title }) {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('move');
  const [dest, setDest] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const orgs = data?.orgs || [];
  if (!orgs.length || !noteId) return null;
  const spaces = orgs.flatMap((o) => o.spaces.map((s) => ({ ...s, orgName: o.name })));
  const here = spaces.find((s) => s.id === current) || null;
  const writable = spaces.filter((s) => s.role !== 'viewer' && s.id !== current);
  const options = [...(here ? [{ id: null, name: 'Personal', kind: 'personal', note: 'Only you' }] : []), ...writable.map((s) => ({ id: s.id, name: s.name, kind: s.kind, note: `${s.members} member${s.members === 1 ? '' : 's'}` }))];
  const chosen = options.find((o) => o.id === dest) || null;

  const close = () => { setOpen(false); setErr(''); setDest(undefined); setBusy(false); };
  const confirm = async () => {
    if (!chosen || busy) return;
    setBusy(true); setErr('');
    try {
      if (mode === 'move') {
        await notesAPI.move(noteId, chosen.id);
        await qc.invalidateQueries();
        navigate('/notes');
        window.dispatchEvent(new CustomEvent('peblo:moved', { detail: { id: noteId, from: current, to: chosen.id, name: chosen.name } }));
      } else {
        await notesAPI.copy(noteId, chosen.id);
        window.dispatchEvent(new CustomEvent('peblo:moved', { detail: { copy: true, name: chosen.name } }));
      }
      close();
    } catch (e) { setErr(e.response?.data?.error || 'That did not work. Nothing was changed.'); setBusy(false); }
  };
  return (
    <>
      <button type="button" className="s-dashed s-add-tag" data-testid="move-open" onClick={() => setOpen(true)}><ArrowRightLeft size={12} /> Move or share</button>
      {open && (
        <Backdrop onClose={close} label="Move or share a copy">
          <div className="s-share-head"><div><b>{mode === 'move' ? 'Move to a space' : 'Share a copy'}</b><small>{title || 'Untitled'}</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={close}><X size={16} strokeWidth={2.4} /></button></div>
          <div className="s-move-modes" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'move'} className={mode === 'move' ? 'on' : ''} onClick={() => setMode('move')}>Move</button>
            <button type="button" role="tab" aria-selected={mode === 'copy'} className={mode === 'copy' ? 'on' : ''} onClick={() => setMode('copy')}>Share a copy</button>
          </div>
          <div className="s-move-list" data-testid="move-options">
            {options.length === 0 && <p className="s-share-msg">There is nowhere else you can add notes to.</p>}
            {options.map((o) => { const R = iconOf(o.kind); return (
              <button key={o.id || 'personal'} type="button" className={`s-space-row${dest === o.id ? ' on' : ''}`} onClick={() => setDest(o.id)}>
                <i style={{ background: `var(--s-${toneOf(o.kind)})` }}><R size={16} /></i><span><b>{o.name}</b><small>{o.note}</small></span>{dest === o.id && <Check size={15} />}
              </button>); })}
          </div>
          {chosen && (
            <p className="s-share-msg" data-testid="move-effect">
              {mode === 'move'
                ? <><b>Loses access:</b> {here ? `everyone in ${here.name} except you` : 'nobody'}. <b>Gains access:</b> {chosen.id ? `everyone in ${chosen.name}` : 'only you'}. Its tasks, images and comments go with it.</>
                : <>A new note with the same words is added to <b>{chosen.name}</b>. The original stays where it is, and the two are not kept in sync.</>}
            </p>
          )}
          {err && <p className="s-space-err" role="alert">{err}</p>}
          <div className="s-space-btns"><button type="button" className="s-share-go" data-testid="move-confirm" disabled={!chosen || busy} onClick={confirm}>{mode === 'move' ? 'Move note' : 'Share a copy'}</button><button type="button" className="s-space-ghost" onClick={close}>Cancel</button></div>
        </Backdrop>
      )}
    </>
  );
}

/** The "Moved to ..." toast with Undo. Lives in the app shell, because the note view it came from is gone once the note has moved. */
export function MoveToast() {
  const qc = useQueryClient();
  const [undo, setUndo] = useState(null);
  useEffect(() => {
    let t;
    const on = (e) => { setUndo(e.detail); clearTimeout(t); t = setTimeout(() => setUndo(null), e.detail.copy ? 6000 : 12000); };
    window.addEventListener('peblo:moved', on);
    return () => { window.removeEventListener('peblo:moved', on); clearTimeout(t); };
  }, []);
  if (!undo) return null;
  const back = async () => {
    const u = undo; setUndo(null);
    try { await notesAPI.move(u.id, u.from, u.to); await qc.invalidateQueries(); } catch { /* it stays where it is */ }
  };
  return (
    <div className="s-toast s-move-toast" role="status" data-testid="move-toast">
      {undo.copy ? <><Copy size={14} /> Copy added to {undo.name}</> : <><Check size={14} /> Moved to {undo.name}</>}
      {!undo.copy && <button type="button" onClick={back}>Undo</button>}
    </div>
  );
}
