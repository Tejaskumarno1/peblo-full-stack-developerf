import fs from 'node:fs';
const f = 'client/src/soft/TaskSheet.jsx';
let s = fs.readFileSync(f, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, () => b); };

rep("import { useMemo, useState } from 'react';", "import { useMemo, useRef, useState } from 'react';");
rep("import ShareDialog from './ShareDialog';", "import ShareDialog from './ShareDialog';\nimport { askScope } from '../utils/askScope';\nimport './tasks2.css';");
rep("import { X, FileText, Check, ChevronLeft, ChevronRight } from 'lucide-react';", "import { X, FileText, Check, ChevronLeft, ChevronRight, Copy, Repeat } from 'lucide-react';");

rep("const TAG_TONES =", `const REPEATS = [['none', 'None'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
const REMINDS = [[0, 'At the time'], [10, '10 min before'], [60, '1 hour before'], [1440, '1 day before']];
const ESTIMATES = [[15, '15 min'], [30, '30 min'], [60, '1 hour']];
const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
const TAG_TONES =`);

rep("  const [error, setError] = useState('');\n", `  const [error, setError] = useState('');
  const [recurrence, setRecurrence] = useState(task.recurrence || 'none');
  const [fromDone, setFromDone] = useState(!!task.meta?.repeatFromDone);
  const [remind, setRemind] = useState(task.meta?.remindMin ?? null);
  const [estimate, setEstimate] = useState(task.meta?.estimateMin ?? null);
  const [confirmEsc, setConfirmEsc] = useState(false);
  const snap0 = useRef(null);
  const snapNow = JSON.stringify({ text, date, time, priority, tags, note: note?.id || null, link, steps, recurrence, fromDone, remind, estimate });
  if (snap0.current === null) snap0.current = snapNow;
  const dirty = snapNow !== snap0.current || !!tagDraft.trim();
  const requestClose = () => { if (dirty && !saving) setConfirmEsc(true); else onClose(); };
`);

rep("      await todosAPI.update(task.id, { text: text.trim(), priority, tags: t && !tags.includes(t) ? [...tags, t] : tags, deadline, noteId: note?.id || null, meta: { link: link.trim() || null, subtasks: steps } });",
`      const ruleChanged = recurrence !== (task.recurrence || 'none');
      let scope = 'this';
      if (task.seriesId && !isNew && !ruleChanged) {
        scope = await askScope(task, 'edit');
        if (!scope) { setSaving(false); return; }
      }
      await todosAPI.update(task.id, {
        text: text.trim(), priority, tags: t && !tags.includes(t) ? [...tags, t] : tags, deadline, noteId: note?.id || null, scope,
        ...(ruleChanged ? { recurrence } : {}),
        meta: { link: link.trim() || null, subtasks: steps, remindMin: remind, estimateMin: estimate, repeatFromDone: fromDone && recurrence !== 'none' ? true : null },
      });`);

rep(`  const dueLabel =`, `  const skipThis = async () => {
    await todosAPI.delete(task.id, 'this');
    refresh();
    onChanged?.();
    onClose();
  };
  const duplicate = async () => {
    try {
      await todosAPI.create({
        text: text.trim() || task.text, priority, tags, noteId: note?.id || null,
        deadline: date ? new Date(\`\${date}T\${time || '09:00'}\`).toISOString() : null,
        meta: { link: link.trim() || null, subtasks: steps.map((x) => ({ ...x, done: false })), remindMin: remind, estimateMin: estimate },
      });
      refresh();
      onChanged?.();
      onClose();
    } catch (e) { setError(e.response?.data?.error || 'Could not duplicate this task.'); }
  };
  const repeatNote = (() => {
    if (recurrence === 'none' || !date) return '';
    const d = new Date(\`\${date}T00:00\`);
    return ({ daily: 'Every day', weekdays: 'Every weekday', weekly: \`Every week on \${d.toLocaleDateString(undefined, { weekday: 'long' })}\`, monthly: \`Every month on the \${ordinal(d.getDate())}\`, yearly: \`Every year on \${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}\` })[recurrence] || '';
  })();
  const source = task.meta?.source || null;
  const dueLabel =`);

// esc / close handling
rep("onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>", "onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (confirmEsc) setConfirmEsc(false); else requestClose(); } }}>");
rep("<button type=\"button\" className=\"s-capture-close\" aria-label=\"Close\" onClick={onClose}>", "<button type=\"button\" className=\"s-capture-close\" aria-label=\"Close\" onClick={requestClose}>");
rep("onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}", "onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}");

// repeat + remind sections after due
rep(`      <section className="s-sheet-sec" aria-label="Priority">`, `      {date && (
        <section className="s-sheet-sec" aria-label="Repeat">
          <span className="s-sheet-lab">Repeat</span>
          <div className="s-sheet-pills" role="radiogroup" aria-label="Repeat">
            {REPEATS.map(([k, name]) => <button key={k} type="button" role="radio" aria-checked={recurrence === k} className={recurrence === k ? 'on' : ''} onClick={() => setRecurrence(k)}>{name}</button>)}
          </div>
          {recurrence !== 'none' && (
            <>
              <p className="s-sheet-note"><Repeat size={13} /> {repeatNote}</p>
              <label className="s-sheet-check"><input type="checkbox" checked={fromDone} onChange={(e) => setFromDone(e.target.checked)} /> Repeat from the date I finish it</label>
              {task.seriesId && !isNew && <button type="button" className="s-sheet-skipone" onClick={skipThis}>Skip this one</button>}
              <p className="s-sheet-hint">Saving a change asks: just this one, this and following, or all in the series.</p>
            </>
          )}
        </section>
      )}

      <section className="s-sheet-sec" aria-label="Remind me">
        <span className="s-sheet-lab">Remind me</span>
        <div className="s-sheet-pills" role="radiogroup" aria-label="Remind me">
          {REMINDS.map(([m, name]) => <button key={m} type="button" role="radio" aria-checked={remind === m} className={remind === m ? 'on' : ''} onClick={() => setRemind(remind === m ? null : m)}>{name}</button>)}
          <button type="button" className={\`ghost\${remind === null ? ' on' : ''}\`} onClick={() => setRemind(null)}>No reminder</button>
        </div>
        <p className="s-sheet-hint">When it rings you can snooze it: 10 min, 1 hour, tonight or tomorrow morning.</p>
      </section>

      <section className="s-sheet-sec" aria-label="Priority">`);

// estimate after priority; source after steps
rep(`      <section className="s-sheet-sec" aria-label="Steps"><TaskSteps steps={steps} onChange={setSteps} /></section>`, `      <section className="s-sheet-sec" aria-label="Estimate">
        <span className="s-sheet-lab">Estimate</span>
        <div className="s-sheet-pills" role="radiogroup" aria-label="Estimate">
          {ESTIMATES.map(([m, name]) => <button key={m} type="button" role="radio" aria-checked={estimate === m} className={estimate === m ? 'on' : ''} onClick={() => setEstimate(estimate === m ? null : m)}>{name}</button>)}
          <input type="number" min="1" max="1440" aria-label="Estimate in minutes" className="s-sheet-time" style={{ width: 96 }} placeholder="minutes" value={estimate && !ESTIMATES.some(([m]) => m === estimate) ? estimate : ''} onChange={(e) => setEstimate(e.target.value ? Number(e.target.value) : null)} />
        </div>
      </section>

      <section className="s-sheet-sec" aria-label="Steps"><TaskSteps steps={steps} onChange={setSteps} /></section>

      {source && (
        <section className="s-sheet-sec" aria-label="Where it came from">
          <span className="s-sheet-lab">Where it came from</span>
          <div className="s-sheet-source">
            <blockquote>&ldquo;{source.quote}&rdquo;</blockquote>
            <div className="row">
              <span>{noteFull?.title || task.note?.title || 'Note'}{source.line ? \` \\u00b7 line \${source.line}\` : ''}</span>
              {(source.noteId || task.noteId) && <Link className="chip" to={\`/notes/\${source.noteId || task.noteId}\${source.line ? \`?line=\${source.line}\` : ''}\`} onClick={onClose}>Jump to the line</Link>}
            </div>
          </div>
        </section>
      )}`);

// footer: duplicate + esc confirm
rep(`      {error && <p className="s-sheet-error" role="alert">{error}</p>}`, `      {error && <p className="s-sheet-error" role="alert">{error}</p>}
      {confirmEsc && (
        <div className="s-sheet-confirm" role="alertdialog" aria-label="Unsaved changes">
          <b>You have unsaved changes.</b>
          <span className="grow" />
          <button type="button" autoFocus onClick={() => setConfirmEsc(false)}>Keep editing</button>
          <button type="button" className="warn" onClick={onClose}>Discard</button>
        </div>
      )}`);
rep(`        {!isNew && <button type="button" className="s-sheet-del" style={{ marginRight: 8 }} onClick={() => setShareOpen(true)}>Share</button>}`, `        {!isNew && <button type="button" className="s-sheet-del" style={{ marginRight: 8 }} onClick={duplicate}><Copy size={13} /> Duplicate</button>}
        {!isNew && <button type="button" className="s-sheet-del" style={{ marginRight: 8 }} onClick={() => setShareOpen(true)}>Share</button>}`);

// subtitle
rep(`      <label className="s-sr" htmlFor="s-sheet-title">Task</label>`, `      {recurrence !== 'none' && date && <p className="s-sheet-sub">Part of a repeating series</p>}
      <label className="s-sr" htmlFor="s-sheet-title">Task</label>`);

if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(f, s);
console.log('ok');
