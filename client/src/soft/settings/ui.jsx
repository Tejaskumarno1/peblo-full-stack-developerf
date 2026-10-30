import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** Settings save as you go. This context lets any control report "saving…" / "saved" to the header. */
export const SaveCtx = createContext(() => Promise.resolve(true));
export const useSave = () => useContext(SaveCtx);

/** True in the Windows / Mac / Linux app (the preload script adds window.pebloDesktop); false on the web. */
export const isDesktopApp = () => typeof window !== 'undefined' && !!window.pebloDesktop;

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

/** Left/Right (and Up/Down) move between the choices, like any radio group; Tab enters on the chosen one. */
export function Seg({ value, options, onChange, label, disabled }) {
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const btns = Array.from(e.currentTarget.querySelectorAll('button:not(:disabled)'));
    const at = btns.indexOf(document.activeElement);
    if (at < 0 || !btns.length) return;
    e.preventDefault();
    const next = btns[(at + step + btns.length) % btns.length];
    next.focus();
    next.click();
  };
  const firstEnabled = options.find((o) => !(disabled || o.disabled))?.id;
  const stop = options.some((o) => o.id === value) ? value : firstEnabled;
  return (
    <div className="s-sg" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} tabIndex={stop === o.id ? 0 : -1} disabled={disabled || o.disabled} title={o.title} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * A text field that saves when you leave it (or press Enter), and only if it changed. It says right under itself what
 * happened. onSave may return false (could not save) or a string (the reason it was refused); anything else means saved.
 */
export function TextField({ id, value, onSave, placeholder, multiline, type = 'text', maxLength, counter }) {
  const [draft, setDraft] = useState(value ?? '');
  const [seen, setSeen] = useState(value ?? '');
  const [state, setState] = useState({ s: 'idle', msg: '' });
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if ((value ?? '') !== seen) { setSeen(value ?? ''); setDraft(value ?? ''); }
  const commit = async () => {
    if (draft.trim() === (value ?? '')) return;
    setState({ s: 'saving', msg: '' });
    let res = true;
    try { res = await onSave(draft.trim()); } catch { res = false; }
    clearTimeout(timer.current);
    if (typeof res === 'string') setState({ s: 'bad', msg: res });
    else if (res === false) setState({ s: 'bad', msg: 'Could not save that. Try again.' });
    else { setState({ s: 'ok', msg: 'Saved' }); timer.current = setTimeout(() => setState({ s: 'idle', msg: '' }), 1800); }
  };
  const common = { id, value: draft, placeholder, maxLength, onChange: (e) => { setDraft(e.target.value); if (state.s === 'bad') setState({ s: 'idle', msg: '' }); }, onBlur: commit, className: 's-set-input', 'aria-invalid': state.s === 'bad' || undefined };
  return (
    <span className="s-set-field">
      {multiline
        ? <textarea rows={3} {...common} />
        : <input type={type} {...common} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
      <small className={`s-set-fieldst ${state.s}`} role={state.s === 'bad' ? 'alert' : 'status'}>
        {state.s === 'saving' ? 'Saving…' : state.msg}
        {counter && maxLength ? <span className="count">{draft.length}/{maxLength}</span> : null}
      </small>
    </span>
  );
}

/** A password box with a show/hide eye. */
export function PasswordInput({ id, value, onChange, autoComplete, required, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <span className="s-set-pw">
      <input id={id} className="s-set-input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} required={required} placeholder={placeholder} />
      <button type="button" className="s-link-btn eye" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((v) => !v)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </span>
  );
}

/** Weak / fair / strong from length and variety. Only a hint: the server's rule (8+ characters) is what is enforced. */
export function passwordStrength(pw) {
  if (!pw) return { level: 0, label: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++; // a long phrase is the strongest thing a person can do
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) return { level: 1, label: 'Too short' };
  return score >= 4 ? { level: 3, label: 'Strong' } : score >= 2 ? { level: 2, label: 'Fair' } : { level: 1, label: 'Weak: try a longer phrase' };
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
  const [working, setWorking] = useState(false);
  if (!open) return <button type="button" className={`s-outline s-set-btn${danger ? ' danger' : ''}`} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="s-set-confirm" role="group" aria-label={ask}>
      <span>{ask}</span>
      <button type="button" className={`s-set-btn ${danger ? 'danger-fill' : 's-accent-btn'}`} disabled={busy || working} onClick={async () => { if (working) return; setWorking(true); try { await onYes(); setOpen(false); } finally { setWorking(false); } }}>Yes</button>
      <button type="button" className="s-link-btn" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}
