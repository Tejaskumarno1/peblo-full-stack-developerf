// Start from a template (mockup K10): a ready set of tasks, dated from a start day, filed under a project.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Trash2, Plus } from 'lucide-react';
import { todosAPI, workspacesAPI } from '../api';
import { Backdrop, useCurrentSpace, useSpaceMembers } from './spaces';
import './teamshare.css';

const isoDay = (d) => { const x = new Date(); x.setHours(0, 0, 0, 0); return new Date(x.getTime() + d * 864e5).toISOString().slice(0, 10); };
const at = (start, day) => { const d = new Date(`${start}T09:00:00`); d.setDate(d.getDate() + day); return d.toISOString(); };

export default function TemplatePicker({ onClose, onDone }) {
  const space = useCurrentSpace();
  const qc = useQueryClient();
  const team = useSpaceMembers();
  const { data } = useQuery({ queryKey: ['templates', space], enabled: !!space, queryFn: () => workspacesAPI.templates(space).then((r) => r.data) });
  const list = data?.templates || [];
  const [pick, setPick] = useState(null);
  const [start, setStart] = useState(isoDay(0));
  const [name, setName] = useState('');
  const [assignAll, setAssignAll] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [making, setMaking] = useState(false);
  const [tName, setTName] = useState('');
  const [tText, setTText] = useState('');
  const cur = list.find((t) => t.id === pick) || list[0];

  const create = async () => {
    if (!cur || busy) return;
    setBusy(true); setErr('');
    const project = (name.trim() || cur.name).slice(0, 80);
    try {
      for (const it of cur.items) {
        await todosAPI.create({ text: it.text, deadline: at(start, it.day), meta: { list: project }, ...(assignAll ? { assignees: [assignAll] } : {}) });
      }
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['projects', space] });
      onDone?.(project, cur.items.length);
      onClose();
    } catch (x) { setErr(x.response?.data?.error || 'Could not create the tasks. Try again.'); setBusy(false); }
  };
  const save = async () => {
    const items = tText.split('\n').map((l) => l.trim()).filter(Boolean).map((text, i) => ({ text, day: i }));
    if (!tName.trim() || !items.length) { setErr('Give the template a name and at least one task.'); return; }
    try { const r = await workspacesAPI.saveTemplate(space, { name: tName.trim(), items }); await qc.invalidateQueries({ queryKey: ['templates', space] }); setPick(r.data.id); setMaking(false); setTName(''); setTText(''); setErr(''); }
    catch (x) { setErr(x.response?.data?.error || 'Could not save the template.'); }
  };
  const remove = async (id) => { try { await workspacesAPI.deleteTemplate(space, id); await qc.invalidateQueries({ queryKey: ['templates', space] }); setPick(null); } catch { /* stays listed */ } };

  return (
    <Backdrop onClose={onClose} label="Start from a template">
      <div className="s-share-head"><div><b>Start from a template</b><small>A ready set of tasks for a repeatable job</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <div className="tp" data-testid="template-picker">
        <ul className="tp-list" aria-label="Templates">
          {list.map((t) => (
            <li key={t.id}><button type="button" data-testid="template-option" className={cur?.id === t.id ? 'on' : ''} onClick={() => { setPick(t.id); setMaking(false); }}><b>{t.name}</b><small>{t.items.length} tasks{t.builtin ? '' : ' - yours'}</small></button></li>
          ))}
          <li><button type="button" data-testid="template-new" className="plain" onClick={() => setMaking(true)}><Plus size={14} /> Save your own</button></li>
        </ul>
        {making ? (
          <div className="tp-body">
            <label>Template name<input aria-label="Template name" value={tName} maxLength={60} onChange={(e) => setTName(e.target.value)} /></label>
            <label>One task per line, in order<textarea aria-label="Template tasks" rows={7} value={tText} onChange={(e) => setTText(e.target.value)} /></label>
            {err && <p className="s-space-err" role="alert">{err}</p>}
            <div className="s-space-btns"><button type="button" className="s-share-go" data-testid="template-save" onClick={save}>Save template</button><button type="button" className="s-space-ghost" onClick={() => { setMaking(false); setErr(''); }}>Cancel</button></div>
          </div>
        ) : cur && (
          <div className="tp-body">
            <ol className="tp-items" data-testid="template-preview">{cur.items.map((it, i) => <li key={i}><span>{it.text}</span><small>{it.day === 0 ? 'start day' : `day ${it.day + 1}`}</small></li>)}</ol>
            <label>Start on<input type="date" aria-label="Start date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label>Project name<input aria-label="Project name" placeholder={cur.name} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
            {team.canAssign && <label>Give every task to<select aria-label="Assign all" value={assignAll} onChange={(e) => setAssignAll(e.target.value)}><option value="">Nobody yet</option>{team.people.map((p) => <option key={p.id} value={p.id}>{p.id === team.me ? 'Me' : p.name}</option>)}</select></label>}
            {err && <p className="s-space-err" role="alert">{err}</p>}
            <div className="s-space-btns">
              <button type="button" className="s-share-go" data-testid="template-create" disabled={busy} onClick={create}>Create {cur.items.length} tasks</button>
              {!cur.builtin && <button type="button" className="s-space-ghost" aria-label="Delete template" onClick={() => remove(cur.id)}><Trash2 size={14} /></button>}
              <button type="button" className="s-space-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Backdrop>
  );
}
