import { useState } from 'react';
import { X } from 'lucide-react';
import { LABELS, LABEL_HEX, metaOf, columnOf, assignmentStatus, minutesLabel, rankTasks, isBlocked } from './taskMeta';
import { topicName, tagsOfTodo, shortDate } from './orbitUtils';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Everything a task can carry besides its title: details, steps, estimate, colour, "waits for", status. */
export function TaskDetail({ t, todos, onMeta, onOpenNote, onFocus }) {
  const m = metaOf(t);
  const [details, setDetails] = useState(m.details || '');
  const [step, setStep] = useState('');
  const steps = m.subtasks || [];
  const setSteps = (next) => onMeta(t, { subtasks: next });
  const others = todos.filter((x) => x.id !== t.id && !x.completed && !(m.dependsOn || []).includes(x.id));
  return (
    <div className="o-detail" aria-label={`Details of ${t.text}`}>
      <label>Details
        <textarea rows={3} value={details} maxLength={4000} onChange={(e) => setDetails(e.target.value)} onBlur={() => details !== (m.details || '') && onMeta(t, { details })} placeholder="Notes, links, what done looks like" aria-label="Task details" />
      </label>
      <div className="o-steps">
        <span className="o-eyebrow">Steps</span>
        {steps.map((s) => (
          <div key={s.id} className="o-step">
            <input type="checkbox" checked={!!s.done} onChange={() => setSteps(steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))} aria-label={`Step: ${s.text}`} />
            <span className={s.done ? 'done' : ''}>{s.text}</span>
            <button type="button" className="del" aria-label={`Remove step ${s.text}`} onClick={() => setSteps(steps.filter((x) => x.id !== s.id))}><X size={14} /></button>
          </div>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); const v = step.trim(); if (v && steps.length < 30) { setSteps([...steps, { id: uid(), text: v.slice(0, 200), done: false }]); setStep(''); } }}>
          <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" aria-label="New step" />
          <button type="submit" className="o-btn small" disabled={!step.trim()}>Add step</button>
        </form>
      </div>
      <div className="o-detail-row">
        <label>Estimate
          <select value={m.estimateMin || ''} onChange={(e) => onMeta(t, { estimateMin: e.target.value ? Number(e.target.value) : null })} aria-label="Time estimate">
            <option value="">None</option>
            {[10, 15, 30, 45, 60, 90, 120, 180, 240].map((n) => <option key={n} value={n}>{minutesLabel(n)}</option>)}
          </select>
        </label>
        <label>Status
          <select value={m.status === 'doing' ? 'doing' : 'todo'} onChange={(e) => onMeta(t, { status: e.target.value === 'doing' ? 'doing' : null })} aria-label="Task status">
            <option value="todo">To do</option><option value="doing">Doing</option>
          </select>
        </label>
        {onFocus && !t.completed && <button type="button" className="o-btn small" onClick={() => onFocus(t)}>Focus 25 min</button>}
        {m.spentMin > 0 && <span className="o-quiet">{minutesLabel(m.spentMin)} spent</span>}
        <label className="o-toggle"><input type="checkbox" checked={!!m.assignment} onChange={(e) => onMeta(t, { assignment: e.target.checked ? true : null })} /> This is an assignment</label>
      </div>
      <label>Meeting or page link
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="url" defaultValue={m.link || ''} key={m.link || 'none'} maxLength={500} placeholder="https://meet.google.com/…" aria-label="Meeting or page link" style={{ flex: 1, minWidth: 0 }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (m.link || '')) onMeta(t, { link: v || null }); }} />
          {m.link && /^https:\/\//i.test(m.link) && <a className="o-btn small" href={m.link} target="_blank" rel="noopener noreferrer">Open</a>}
        </span>
      </label>
      <div className="o-labels" role="group" aria-label="Colour label">
        <span className="o-eyebrow">Label</span>
        <button type="button" className={`o-chip${!m.label ? ' on' : ''}`} onClick={() => onMeta(t, { label: null })}>None</button>
        {LABELS.map((c) => (
          <button key={c} type="button" className={`o-swatch${m.label === c ? ' on' : ''}`} style={{ background: LABEL_HEX[c] }} aria-label={`Label ${c}`} aria-pressed={m.label === c} onClick={() => onMeta(t, { label: c })} />
        ))}
      </div>
      <div className="o-deps">
        <span className="o-eyebrow">Waits for</span>
        {(m.dependsOn || []).map((id) => {
          const x = todos.find((y) => y.id === id);
          return x ? <span key={id} className="o-chip on">{x.text}{x.completed ? ' (done)' : ''}<button type="button" aria-label={`Stop waiting for ${x.text}`} onClick={() => onMeta(t, { dependsOn: (m.dependsOn || []).filter((d) => d !== id) })}><X size={12} /></button></span> : null;
        })}
        <select value="" onChange={(e) => e.target.value && onMeta(t, { dependsOn: [...(m.dependsOn || []), e.target.value] })} aria-label="Add a task this waits for">
          <option value="">Add a task…</option>
          {others.slice(0, 80).map((x) => <option key={x.id} value={x.id}>{x.text}</option>)}
        </select>
      </div>
      {t.note && <button type="button" className="o-btn ghost small" onClick={() => onOpenNote(t.note.id)}>Open note “{t.note.title || 'Untitled'}”</button>}
    </div>
  );
}

/** To do / Doing / Done as three columns; drag a card, or use its buttons. */
export function Board({ todos, onMove }) {
  const cols = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];
  const recent = Date.now() - 7 * 864e5;
  const list = todos.filter((t) => !t.completed || new Date(t.updatedAt || 0).getTime() > recent);
  return (
    <div className="o-board" aria-label="Task board">
      {cols.map(([key, label]) => {
        const items = list.filter((t) => columnOf(t) === key);
        return (
          <section key={key} className="o-col" data-col={key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const t = todos.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t && columnOf(t) !== key) onMove(t, key); }}>
            <h3>{label} · {items.length}</h3>
            {items.map((t) => (
              <div key={t.id} className={`o-card-task${t.completed ? ' done' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}>
                <span>{metaOf(t).label && <i className="o-dot" style={{ background: LABEL_HEX[metaOf(t).label] }} />}{t.text}</span>
                {t.deadline && <span className="m">{shortDate(t.deadline)}</span>}
                <span className="btns">
                  {key !== 'todo' && <button type="button" className="o-chip" onClick={() => onMove(t, 'todo')}>To do</button>}
                  {key !== 'doing' && <button type="button" className="o-chip" onClick={() => onMove(t, 'doing')}>Doing</button>}
                  {key !== 'done' && <button type="button" className="o-chip" onClick={() => onMove(t, 'done')}>Done</button>}
                </span>
              </div>
            ))}
            {!items.length && <p className="o-quiet">Nothing here.</p>}
          </section>
        );
      })}
    </div>
  );
}

const ASTAT = [['not-started', 'Not started'], ['in-progress', 'In progress'], ['submitted', 'Submitted']];

/** Assignments: tasks marked as assignments, by how far along they are. */
export function Assignments({ todos, onStatus, mastery }) {
  const list = todos.filter((t) => metaOf(t).assignment).sort((a, b) => new Date(a.deadline || 8.64e15) - new Date(b.deadline || 8.64e15));
  if (!list.length) return <p className="o-quiet">No assignments yet. Open a task’s details and tick “This is an assignment”.</p>;
  return (
    <div className="o-assign" aria-label="Assignments">
      {ASTAT.map(([key, label]) => (
        <section key={key} data-status={key}>
          <h3>{label} · {list.filter((t) => assignmentStatus(t) === key).length}</h3>
          {list.filter((t) => assignmentStatus(t) === key).map((t) => (
            <div key={t.id} className="o-card-task">
              <span>{t.text}</span>
              {tagsOfTodo(t)[0] && <span className="o-chip" style={{ height: 24, fontSize: 12 }}>{topicName(tagsOfTodo(t)[0])}</span>}
              {t.deadline && <span className="m">due {shortDate(t.deadline)}</span>}
              <select value={assignmentStatus(t)} onChange={(e) => onStatus(t, e.target.value)} aria-label={`Status of ${t.text}`}>
                {ASTAT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Finished tasks by the day they were done, with a way to bring one back. */
export function DoneLog({ todos, days, onRestore }) {
  const since = days ? Date.now() - days * 864e5 : 0;
  const done = todos.filter((t) => t.completed && new Date(t.updatedAt || 0).getTime() >= since).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const byDay = new Map();
  for (const t of done) {
    const k = new Date(t.updatedAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    byDay.set(k, [...(byDay.get(k) || []), t]);
  }
  if (!done.length) return <p className="o-quiet">Nothing finished in this time yet.</p>;
  return (
    <div className="o-donelog" aria-label="Finished tasks">
      <p className="o-quiet">{done.length} finished</p>
      {[...byDay].map(([day, items]) => (
        <section key={day}>
          <h3 className="o-day-head">{day} · {items.length}</h3>
          {items.map((t) => (
            <div key={t.id} className="o-task done"><span className="t">{t.text}</span><button type="button" className="o-chip" onClick={() => onRestore(t)}>Not done</button></div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** "What next?": the one task Peblo would do now, with the reason, and a way to skip it. */
export function NextCard({ todos, mastery, onStart, onDone, onClose }) {
  const [skip, setSkip] = useState([]);
  const ranked = rankTasks(todos, mastery, skip);
  const top = ranked[0];
  return (
    <div className="o-next" role="region" aria-label="What next">
      {top ? (
        <>
          <span className="o-eyebrow">Do this next</span>
          <strong>{top.task.text}</strong>
          <span className="o-quiet">{top.why.length ? top.why.join(' · ') : 'Nothing urgent, so this is the next in line.'}</span>
          <span className="btns">
            <button type="button" className="o-btn small" onClick={() => onStart(top.task)}>Start</button>
            <button type="button" className="o-btn ghost small" onClick={() => onDone(top.task)}>Done</button>
            <button type="button" className="o-btn ghost small" onClick={() => setSkip([...skip, top.task.id])}>Skip</button>
            <button type="button" className="o-btn ghost small" onClick={onClose}>Close</button>
          </span>
        </>
      ) : (
        <>
          <strong>Nothing left to do right now.</strong>
          <span className="btns"><button type="button" className="o-btn ghost small" onClick={() => setSkip([])}>Show skipped</button><button type="button" className="o-btn ghost small" onClick={onClose}>Close</button></span>
        </>
      )}
    </div>
  );
}

export { isBlocked };
