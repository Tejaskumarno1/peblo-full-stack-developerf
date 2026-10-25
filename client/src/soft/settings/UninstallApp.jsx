import { useEffect, useState } from 'react';
import { Card } from './ui';

/**
 * Settings > About > Uninstall Peblo. Desktop app only. Everything Peblo stored on this computer is removed;
 * the one choice is whether to keep a backup of it (saved in Documents) first.
 */
export default function UninstallApp() {
  const desktop = typeof window !== 'undefined' ? window.pebloDesktop : null;
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
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
    const res = await desktop.uninstall({ removeData: true, backup }).catch(() => ({ ok: false, error: 'Could not reach the desktop app.' }));
    if (res.ok) {
      setMsg({ ok: true, text: `Peblo is closing and removing itself.${res.backupDir ? ` Your backup is in ${res.backupDir}.` : ''}` });
      return; // the window closes by itself in a moment
    }
    setBusy(false);
    if (!res.cancelled) setMsg({ ok: false, text: res.error || 'Could not uninstall.' });
  };

  return (
    <Card title="Uninstall Peblo" hint="Remove the app and everything it stored on this computer. Your notes and tasks stay in your Peblo account.">
      {!open ? (
        <div className="s-set-actions">
          <button type="button" className="s-outline s-set-btn" onClick={() => setOpen(true)}>Uninstall Peblo…</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.4 }}>
            <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} style={{ marginTop: 3 }} />
            <span><b>Keep a backup of my data.</b> A copy of the settings and files stored on this computer is saved in your Documents folder before everything is removed.</span>
          </label>
          <div className="s-set-actions">
            <button type="button" className="s-outline s-set-btn" onClick={run} disabled={busy}>{busy ? 'Working…' : 'Uninstall'}</button>
            <button type="button" className="s-link-btn" onClick={() => { setOpen(false); setMsg(null); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 's-set-ok' : 's-set-bad'}>{msg.text}</p>}
    </Card>
  );
}
