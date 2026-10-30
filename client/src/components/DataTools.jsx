import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notesAPI, todosAPI } from '../api';
import { downloadBlob, safeFileName } from '../utils/download';
import { zipBlob } from '../utils/zip';
import { docsToMarkdown } from '../utils/exporters';
import { tasksToCsv, tasksToIcs, parseTasksCsv } from '../utils/taskExport';

const SECRET_KEYS = ['openAiKey', 'geminiKey', 'groqKey', 'huggingFaceKey', 'unreadableKeys'];

/** "Download all my data" (a zip) and a task import with a preview (PEB-165, PEB-213). */
export default function DataTools() {
  const { settings } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [plan, setPlan] = useState(null); // { name, tasks, errors }
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const downloadAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const [{ data: n }, { data: t }] = await Promise.all([notesAPI.getAll({}), todosAPI.getAll({})]);
      const notes = n.notes || [];
      const todos = t.todos || [];
      const safeSettings = Object.fromEntries(Object.entries(settings || {}).filter(([k]) => !SECRET_KEYS.includes(k)));
      const used = new Map(); // two notes with the same title must not overwrite each other in the zip
      const noteFile = (x) => {
        const base = safeFileName(x.title, 'Untitled');
        const n = (used.get(base.toLowerCase()) || 0) + 1;
        used.set(base.toLowerCase(), n);
        return `notes/${n === 1 ? base : `${base} (${n})`}.md`;
      };
      const files = [
        { name: 'README.txt', data: `Peblo export, ${new Date().toISOString().slice(0, 10)}\r\nnotes/ one Markdown file per note\r\ntasks.csv and tasks.ics your tasks\r\nsettings.json your preferences (AI keys are never included)\r\n` },
        ...notes.map((x) => ({ name: noteFile(x), data: docsToMarkdown([x]) })),
        { name: 'tasks.csv', data: tasksToCsv(todos) },
        { name: 'tasks.ics', data: tasksToIcs(todos) },
        { name: 'settings.json', data: JSON.stringify(safeSettings, null, 2) },
      ];
      downloadBlob(`peblo-all-my-data-${new Date().toISOString().slice(0, 10)}.zip`, zipBlob(files));
      setMsg({ ok: true, text: `Saved ${notes.length} note${notes.length === 1 ? '' : 's'}, ${todos.length} task${todos.length === 1 ? '' : 's'} and your settings.` });
    } catch (e) {
      console.error('Full export failed', e);
      setMsg({ ok: false, text: 'Could not collect your data. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMsg(null);
    try {
      const text = await f.text();
      setPlan({ name: f.name, ...parseTasksCsv(text) });
    } catch (err) {
      console.error('Could not read the CSV file', err);
      setPlan(null);
      setMsg({ ok: false, text: 'Could not read that file. Choose a CSV file with a Task column.' });
    }
  };

  const confirm = async () => {
    if (!plan?.tasks.length) return;
    setImporting(true);
    const failed = [];
    let made = 0;
    for (const [i, t] of plan.tasks.entries()) {
      try {
        const { completed, ...body } = t;
        const { data } = await todosAPI.create(body);
        if (completed && data?.todo?.id) await todosAPI.update(data.todo.id, { completed: true });
        made++;
      } catch (err) {
        failed.push(`Task ${i + 1} (${t.text.slice(0, 30)}): ${err.response?.data?.error || 'could not be saved'}`);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    setPlan(null);
    setImporting(false);
    setMsg({ ok: failed.length === 0, text: `Added ${made} task${made === 1 ? '' : 's'}.${failed.length ? ` ${failed.length} failed: ${failed.slice(0, 3).join('; ')}` : ''}` });
  };

  return (
    <div className="settings-toggle-row" style={{ display: 'block', marginTop: '1rem' }}>
      <div className="settings-toggle-info" style={{ marginBottom: '0.75rem' }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Download size={16} /> Download all my data</h4>
        <p>One zip with every note (Markdown), your tasks (.csv and .ics) and your settings. AI keys are never included.</p>
      </div>
      <button type="button" className="btn" onClick={downloadAll} disabled={busy}>{busy ? 'Collecting…' : 'Download everything (.zip)'}</button>

      <div className="settings-toggle-info" style={{ margin: '1.25rem 0 0.75rem' }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Upload size={16} /> Import tasks from a CSV file</h4>
        <p>Use a file made by the export above, or any CSV with a Task column (optional: Done, Priority, Due date as 2026-10-21, Start, End, Topics). You see what will be created before anything is saved.</p>
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Choose a tasks CSV file" onChange={pick} />
      {plan && (
        <div role="status" style={{ marginTop: '0.75rem' }}>
          <p><strong>{plan.name}</strong>: {plan.tasks.length} task{plan.tasks.length === 1 ? '' : 's'} will be added{plan.errors.length ? `, ${plan.errors.length} row${plan.errors.length === 1 ? '' : 's'} skipped` : ''}.</p>
          {plan.tasks.slice(0, 5).map((t, i) => <p key={i} style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t.text}{t.deadline ? ` · ${t.deadline.slice(0, 10)}` : ''}{t.priority ? ` · ${t.priority}` : ''}</p>)}
          {plan.tasks.length > 5 && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>…and {plan.tasks.length - 5} more</p>}
          {plan.errors.slice(0, 5).map((er, i) => <p key={i} style={{ fontSize: '0.85rem', color: '#ef4444' }}>{er}</p>)}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn" onClick={confirm} disabled={importing || !plan.tasks.length}>{importing ? 'Adding…' : `Add ${plan.tasks.length} task${plan.tasks.length === 1 ? '' : 's'}`}</button>
            <button type="button" className="btn" onClick={() => setPlan(null)} disabled={importing}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p role="status" style={{ marginTop: '0.75rem', color: msg.ok ? 'inherit' : '#ef4444' }}>{msg.text}</p>}
    </div>
  );
}
