import { useState } from 'react';
import { X } from 'lucide-react';
import '../styles/steps.css';

const uid = () => Math.random().toString(36).slice(2, 10);

/** A small checklist inside a task (saved as task.meta.subtasks: [{ id, text, done }]). Looks like the style around it. */
export default function TaskSteps({ steps = [], onChange, label = 'Steps' }) {
  const [draft, setDraft] = useState('');
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
    </div>
  );
}
