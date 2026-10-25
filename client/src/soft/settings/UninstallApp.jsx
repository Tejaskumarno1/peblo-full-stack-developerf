import { useEffect, useState } from 'react';
import { Card, Row } from './ui';

/**
 * Settings > About > Uninstall Peblo. Desktop app only: asks what to do with the files kept on this computer
 * (keep them, remove them, back them up first) and then the app closes and removes itself.
 */
export default function UninstallApp() {
  const desktop = typeof window !== 'undefined' ? window.pebloDesktop : null;
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [removeData, setRemoveData] = useState(false);
  const [backup, setBackup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (desktop && desktop.getUninstallInfo) desktop.getUninstallInfo().then(setInfo).catch(() => {});
  }, [desktop]);

  if (!desktop || !desktop.uninstall || !info) return null;

  if (!info.available) {
    return (
      <Card title="Uninstall Peblo" hint="Remove the app from this computer.">
        <p className="s-set-static">{info.reason}</p>
      </Card>
    );
  }

  const run = async () => {
    setBusy(true);
    setMsg(null);
    const res = await desktop.uninstall({ removeData, backup }).catch(() => ({ ok: false, error: 'Could not reach the desktop app.' }));
    if (res.ok) {
      setMsg({ ok: true, text: `Peblo is closing and removing itself.${res.backupDir ? ` Your backup is in ${res.backupDir}.` : ''}` });
      return; // the window closes by itself in a moment
    }
    setBusy(false);
    if (!res.cancelled) setMsg({ ok: false, text: res.error || 'Could not uninstall.' });
  };

  return (
    <Card title="Uninstall Peblo" hint="Remove the app from this computer. Your notes and tasks stay in your Peblo account.">
      {!open ? (
        <div className="s-set-actions">
          <button type="button" className="s-outline s-set-btn" onClick={() => setOpen(true)}>Uninstall Peblo…</button>
        </div>
      ) : (
        <>
          <Row label="Files on this computer" hint={`Settings and caches in ${info.dataDir}`}>
            <div role="radiogroup" aria-label="What to do with the files Peblo keeps on this computer" style={{ display: 'grid', gap: 8 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="radio" name="un-data" checked={!removeData} onChange={() => setRemoveData(false)} />
                <span><b>Keep them.</b> A later install picks up where you left off.</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="radio" name="un-data" checked={removeData} onChange={() => setRemoveData(true)} />
                <span><b>Remove everything.</b> Settings, caches and update downloads are deleted too.</span>
              </label>
            </div>
          </Row>
          <Row label="Backup" hint="Saved as a folder in Documents before anything is removed.">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
              <span>Back up the files on this computer first</span>
            </label>
          </Row>
          <div className="s-set-actions">
            <button type="button" className="s-outline s-set-btn" onClick={run} disabled={busy}>{busy ? 'Working…' : removeData ? 'Back up and remove everything' : 'Uninstall'}</button>
            <button type="button" className="s-link-btn" onClick={() => { setOpen(false); setMsg(null); }} disabled={busy}>Cancel</button>
          </div>
        </>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 's-set-ok' : 's-set-bad'}>{msg.text}</p>}
    </Card>
  );
}
