import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useDialogFocus } from './a11y';
import './confirmDialog.css';

function Confirm({ title, body, confirmLabel, cancelLabel, danger, onDone }) {
  const ref = useRef(null);
  useDialogFocus(ref, true);
  return (
    <div className="cd-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(false); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onDone(false); } }}>
      <div className="cd-box" role="alertdialog" aria-modal="true" aria-labelledby="cd-title" aria-describedby={body ? 'cd-body' : undefined} ref={ref} tabIndex={-1} data-testid="confirm-dialog">
        <b id="cd-title" className="cd-title">{title}</b>
        {body && <p id="cd-body" className="cd-body">{body}</p>}
        <div className="cd-btns">
          <button type="button" className="cd-ghost" data-testid="confirm-cancel" onClick={() => onDone(false)}>{cancelLabel || 'Cancel'}</button>
          <button type="button" className={`cd-go${danger ? ' danger' : ''}`} data-testid="confirm-ok" autoFocus onClick={() => onDone(true)}>{confirmLabel || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * An in-app replacement for window.confirm. `await confirmDialog({ title, body, confirmLabel, danger })` is true when the person
 * confirms and false on Cancel, Escape or a click outside. Works from anywhere (it mounts its own small tree inside the
 * Soft / River / Orbit root so it takes that look's colours) and focus goes back to where it was.
 */
export function confirmDialog({ title, body = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    (document.querySelector('.soft, .river, .orbit') || document.body).appendChild(host);
    const root = createRoot(host);
    const done = (v) => { root.unmount(); host.remove(); resolve(v); };
    root.render(<Confirm title={title} body={body} confirmLabel={confirmLabel} cancelLabel={cancelLabel} danger={danger} onDone={done} />);
  });
}
