import { useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOrbit } from './OrbitShell';
import { orbitPrefs } from './orbitPrefs';

/** Steps shown in the getting-started list; `done` comes from what the account already has. */
export function checklistSteps({ topics, notes, todos, mastery }) {
  return [
    { id: 'topic', label: 'Create a topic', done: topics > 0 },
    { id: 'note', label: 'Write a note', done: notes > 0 },
    { id: 'task', label: 'Add a task', done: todos > 0 },
    { id: 'quiz', label: 'Take a quiz', done: [...mastery.values()].some((m) => (m?.quizzes || 0) > 0) },
  ];
}

/** Orbit · small "Get started" card on the map. Hides itself when finished or dismissed. */
export default function OrbitChecklist({ topics }) {
  const { notes, todos, mastery } = useOrbit();
  const { settings, updateSettings } = useAuth();
  const navigate = useNavigate();
  const prefs = orbitPrefs(settings);
  const steps = checklistSteps({ topics, notes: notes.length, todos: todos.length, mastery });
  const done = steps.filter((s) => s.done).length;
  if (prefs.checklistOff || done === steps.length) return null;
  const dismiss = () => updateSettings({ orbit: { ...prefs, checklistOff: true } });
  const go = (s) => {
    if (s.id === 'note') window.dispatchEvent(new CustomEvent('peblo:capture', { detail: {} }));
    else if (s.id === 'topic') window.dispatchEvent(new Event('peblo:topics'));
    else if (s.id === 'task') navigate('/tasks');
    else navigate('/ai');
  };
  return (
    <aside className="o-pill o-checklist" aria-label="Getting started">
      <header>
        <b>Get started</b>
        <span className="o-quiet" aria-label="Progress">{done} of {steps.length}</span>
        <button type="button" className="o-checklist-x" aria-label="Hide getting started" onClick={dismiss}><X size={14} /></button>
      </header>
      <div className="o-checklist-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul>
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'done' : ''}>
            <span className="tick">{s.done && <Check size={12} strokeWidth={3} />}</span>
            {s.done ? <span>{s.label}</span> : <button type="button" onClick={() => go(s)}>{s.label}</button>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
