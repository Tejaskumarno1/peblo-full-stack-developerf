import { createContext, useContext, useState } from 'react';

/** Settings save as you go. This context lets any control report "saving…" / "saved" to the header. */
export const SaveCtx = createContext(() => Promise.resolve(true));
export const useSave = () => useContext(SaveCtx);

export function Card({ id, title, hint, tone, children, aside }) {
  return (
    <section className="s-set-card" id={id} style={tone ? { background: `var(--s-${tone})` } : undefined} aria-labelledby={id ? `${id}-h` : undefined}>
      {(title || aside) && (
        <header className="s-set-card-head">
          <div>
            {title && <h2 id={id ? `${id}-h` : undefined}>{title}</h2>}
            {hint && <p>{hint}</p>}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Row({ label, hint, htmlFor, children, stack }) {
  return (
    <div className={`s-set-row${stack ? ' stack' : ''}`}>
      <div className="s-set-row-text">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <small>{hint}</small>}
      </div>
      <div className="s-set-row-ctl">{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled} className={`s-switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Seg({ value, options, onChange, label, disabled }) {
  return (
    <div className="s-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled || o.disabled} title={o.title} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** A text field that saves when you leave it (or press Enter), and only if it changed. */
export function TextField({ id, value, onSave, placeholder, multiline, type = 'text', maxLength }) {
  const [draft, setDraft] = useState(value ?? '');
  const [seen, setSeen] = useState(value ?? '');
  if ((value ?? '') !== seen) { setSeen(value ?? ''); setDraft(value ?? ''); }
  const commit = () => { if (draft.trim() !== (value ?? '')) onSave(draft.trim()); };
  const common = { id, value: draft, placeholder, maxLength, onChange: (e) => setDraft(e.target.value), onBlur: commit, className: 's-set-input' };
  return multiline
    ? <textarea rows={3} {...common} />
    : <input type={type} {...common} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />;
}

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const go = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* the text is selectable as a fallback */ }
    setDone(true); setTimeout(() => setDone(false), 1600);
  };
  return <button type="button" className="s-outline s-set-btn" onClick={go}>{done ? 'Copied' : label}</button>;
}

/** Two-step button: first click asks, second click does it. No browser dialogs. */
export function Confirm({ label, ask, onYes, danger, busy }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className={`s-outline s-set-btn${danger ? ' danger' : ''}`} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="s-set-confirm" role="group" aria-label={ask}>
      <span>{ask}</span>
      <button type="button" className={`s-set-btn ${danger ? 'danger-fill' : 's-accent-btn'}`} disabled={busy} onClick={async () => { await onYes(); setOpen(false); }}>Yes</button>
      <button type="button" className="s-link-btn" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}
