import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { backupAPI } from '../api';
import { downloadText } from '../utils/download';

/** Count what a parsed backup would add. Returns null when it is not a Peblo backup. */
export function describeBackup(b) {
  if (!b || b.format !== 'peblo-backup' || b.version !== 1 || !Array.isArray(b.notes) || !Array.isArray(b.todos)) return null;
  return { notes: b.notes.length, todos: b.todos.length, exportedAt: b.exportedAt || null };
}

/** Orbit · back up everything to a file, and restore from one. Opened by the user menu through events. */
export default function OrbitBackup() {
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState(null); // { data, info }
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('restore'); // 'restore' shows the file picker; 'info' only a message
  const working = useRef(false); // one backup or example change at a time (a second menu click is ignored)

  useEffect(() => {
    const backup = async () => {
      if (working.current) return;
      working.current = true;
      setMode('info'); setMsg('');
      try {
        const r = await backupAPI.get();
        downloadText(`peblo-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r.data, null, 2), 'application/json');
        setOpen(true);
        setMsg(`Backed up ${r.data?.notes?.length ?? 0} notes and ${r.data?.todos?.length ?? 0} tasks.`);
      } catch (e) { console.error('Backup failed', e); setOpen(true); setMsg("Couldn't make the backup. Try again."); } finally { working.current = false; }
    };
    const restore = () => { setMode('restore'); setOpen(true); setFound(null); setMsg(''); };
    const refreshAll = () => { for (const k of ['notes', 'todos', 'tags', 'study', 'dashboard']) queryClient.invalidateQueries({ queryKey: [k] }); };
    const example = async () => {
      if (working.current) return;
      working.current = true;
      setMode('info'); setOpen(true); setFound(null); setMsg('');
      try { const r = await backupAPI.addExample(); setMsg(`Added ${r.data?.added?.notes ?? 0} example notes and ${r.data?.added?.todos ?? 0} example tasks. Clear them any time from your menu.`); }
      catch (e) { setMsg(e.response?.data?.error || "Couldn't add the example data."); }
      finally { working.current = false; refreshAll(); }
    };
    const clearExample = async () => {
      if (working.current) return;
      working.current = true;
      setMode('info'); setOpen(true); setFound(null); setMsg('');
      try { const r = await backupAPI.clearExample(); setMsg(`Removed ${r.data?.removed?.notes ?? 0} example notes and ${r.data?.removed?.todos ?? 0} example tasks. Your own notes were not touched.`); }
      catch { setMsg("Couldn't clear the example data."); }
      finally { working.current = false; refreshAll(); }
    };
    window.addEventListener('peblo:example', example);
    window.addEventListener('peblo:example-clear', clearExample);
    window.addEventListener('peblo:backup', backup);
    window.addEventListener('peblo:restore', restore);
    return () => { window.removeEventListener('peblo:backup', backup); window.removeEventListener('peblo:restore', restore); window.removeEventListener('peblo:example', example); window.removeEventListener('peblo:example-clear', clearExample); };
  }, []);

  const close = () => { setOpen(false); setFound(null); setMsg(''); };
  useEffect(() => { // Escape closes the dialog
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); setFound(null); setMsg(''); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  const choose = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMsg('');
    try {
      const data = JSON.parse(await f.text());
      const info = describeBackup(data);
      if (!info) { setFound(null); setMsg('That does not look like a Peblo backup file.'); return; }
      setFound({ data, info });
    } catch { setFound(null); setMsg('That file could not be read. Choose a .json backup made by Peblo.'); }
  };
  const run = async () => {
    if (busy || !found) return;
    setBusy(true);
    try {
      const r = await backupAPI.restore(found.data);
      setMsg(`Restored ${r.data?.restored?.notes ?? 0} notes and ${r.data?.restored?.todos ?? 0} tasks.`);
      setFound(null);
      for (const k of ['notes', 'todos', 'tags', 'study', 'dashboard']) queryClient.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      console.error('Restore failed', e);
      setMsg(e.response?.data?.error || "Couldn't restore. Nothing was changed.");
    } finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <>
      <div className="o-scrim" onMouseDown={close} />
      <div className="o-sheet o-backup" role="dialog" aria-label="Backup and restore" style={{ top: 140, width: 520 }}>
        <header className="o-sheet-head">
          <b>{mode === 'restore' ? 'Restore from a backup' : 'Done'}</b>
          <span className="grow" />
          <button type="button" className="o-btn ghost small" aria-label="Close" onClick={close}><X size={16} /></button>
        </header>
        <div className="o-backup-body">
          {msg && <p role="status" className="o-msg">{msg}</p>}
          {!found && mode === 'restore' && (
            <>
              <p className="o-quiet">Pick a backup file you saved earlier (.json). Everything in it is added next to what you have now. Nothing is overwritten or deleted.</p>
              <input ref={fileRef} type="file" accept="application/json,.json" aria-label="Backup file" onChange={choose} />
            </>
          )}
          {found && (
            <>
              <p>This backup has <b>{found.info.notes} notes</b> and <b>{found.info.todos} tasks</b>{found.info.exportedAt && !Number.isNaN(new Date(found.info.exportedAt).getTime()) ? ` (saved ${new Date(found.info.exportedAt).toLocaleDateString()})` : ''}.</p>
              <p className="o-quiet">They will be added to your account. Existing notes stay as they are, so restoring the same file twice makes copies.</p>
              <div className="o-btns">
                <button type="button" className="o-btn" disabled={busy} onClick={run}>{busy ? 'Restoring…' : 'Restore now'}</button>
                <button type="button" className="o-btn ghost" disabled={busy} onClick={() => setFound(null)}>Choose another file</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
