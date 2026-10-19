import { useState } from 'react';
import { Download } from 'lucide-react';
import { useDismiss } from './OrbitShell';
import { exportDocs } from '../utils/exporters';
import { tasksToIcs, tasksToCsv } from '../utils/taskExport';
import { downloadText } from '../utils/download';
import '../styles/print.css';

/** A Download button with Markdown, PDF, Word and Print for a note, a topic or the whole map (PEB-163, PEB-166). */
export default function DownloadMenu({ label = 'Download', name, docs, className = 'o-btn ghost small', up = false, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const ref = useDismiss(open, () => setOpen(false));
  const run = async (fmt) => {
    setBusy(fmt);
    setErr('');
    try {
      await exportDocs(docs(), fmt, name);
      setOpen(false);
    } catch (e) {
      console.error('Export failed', e);
      setErr(e?.message || 'Could not export. Try again.');
    } finally {
      setBusy('');
    }
  };
  const ITEMS = [['md', 'Markdown (.md)'], ['pdf', 'PDF (.pdf)'], ['doc', 'Word (.doc)'], ['print', 'Print']];
  return (
    <span className="o-menu-wrap o-dl" ref={ref}>
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Download size={14} strokeWidth={2.2} /> {label}</button>
      {open && (
        <div className={`o-pop${align === 'right' ? ' right' : ''}`} role="menu" style={{ width: 200, ...(up ? { top: 'auto', bottom: 'calc(100% + 6px)' } : null) }}>
          {ITEMS.map(([fmt, text]) => (
            <button key={fmt} type="button" role="menuitem" disabled={!!busy} onClick={() => run(fmt)}>{busy === fmt ? 'Preparing…' : text}</button>
          ))}
          {err && <span className="o-err" role="alert" style={{ padding: '4px 10px', fontSize: 12.5 }}>{err}</span>}
        </div>
      )}
    </span>
  );
}

/** Tasks to a calendar file or a spreadsheet (PEB-164). `tasks` is a function so it is read when you click. */
export function TaskExportMenu({ tasks, label = 'Export' }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <span className="o-menu-wrap o-dl" ref={ref}>
      <button type="button" className="o-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Download size={13} strokeWidth={2.2} /> {label}</button>
      {open && (
        <div className="o-pop right" role="menu" style={{ width: 230 }}>
          <button type="button" role="menuitem" onClick={() => { downloadText(`peblo-tasks-${stamp}.ics`, tasksToIcs(tasks()), 'text/calendar'); setOpen(false); }}>Calendar file (.ics)</button>
          <button type="button" role="menuitem" onClick={() => { downloadText(`peblo-tasks-${stamp}.csv`, tasksToCsv(tasks()), 'text/csv'); setOpen(false); }}>Spreadsheet (.csv)</button>
        </div>
      )}
    </span>
  );
}
