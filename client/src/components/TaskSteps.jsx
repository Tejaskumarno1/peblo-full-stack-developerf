import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { aiAPI } from '../api';
import '../styles/steps.css';

const uid = () => Math.random().toString(36).slice(2, 10);

/** A small checklist inside a task (saved as task.meta.subtasks: [{ id, text, done }]). Looks like the style around it. */
export default function TaskSteps({ steps = [], onChange, label = 'Steps', taskText = '', taskDetails = '' }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const breakDown = async () => {
    setBusy(true); setAiMsg('');
    try {
      const { data } = await aiAPI.taskSteps(taskText, taskDetails);
      const have = new Set(steps.map((s) => s.text.toLowerCase()));
      const fresh = (data.steps || []).filter((t) => !have.has(t.toLowerCase())).slice(0, 30 - steps.length).map((t) => ({ id: uid(), text: t.slice(0, 200), done: false }));
      if (fresh.length) onChange([...steps, ...fresh]);
      setAiMsg(fresh.length ? `Added ${fresh.length} step${fresh.length === 1 ? '' : 's'}. Remove any you do not want.` : 'Those steps are already here.');
    } catch (e) { setAiMsg(e?.response?.data?.error || 'Could not break this down right now.'); }
    setBusy(false);
  };
  const add = (e) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v || steps.length >= 30) return;
    onChange([...steps, { id: uid(), text: v.slice(0, 200), done: false }]);
    setDraft('');
  };
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="pb-steps" role="group" aria-label={label}>
      <div className="pb-steps-head"><b>{label}</b>{steps.length > 0 && <span>{done} of {steps.length}</span>}</div>
      {steps.length > 0 && <div className="pb-steps-bar" aria-hidden="true"><i style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></div>}
      {steps.map((s) => (
        <div key={s.id} className="pb-step">
          <input type="checkbox" checked={!!s.done} onChange={() => onChange(steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))} aria-label={`Step: ${s.text}`} />
          <span className={s.done ? 'done' : ''}>{s.text}</span>
          <button type="button" aria-label={`Remove step ${s.text}`} onClick={() => onChange(steps.filter((x) => x.id !== s.id))}><X size={13} /></button>
        </div>
      ))}
      <form className="pb-step-add" onSubmit={add}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a step" aria-label="New step" maxLength={200} />
        <button type="submit" disabled={!draft.trim()}>Add step</button>
      </form>
      {taskText.trim() && <button type="button" className="pb-step-ai" data-testid="break-down" disabled={busy || steps.length >= 30} onClick={breakDown}><Sparkles size={13} /> {busy ? 'Thinking...' : 'Break it down with AI'}</button>}
      {aiMsg && <p className="pb-step-msg" role="status">{aiMsg}</p>}
    </div>
  );
}
