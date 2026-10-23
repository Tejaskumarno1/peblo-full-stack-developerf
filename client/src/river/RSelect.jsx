import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import './river.css';

/**
 * River's own dropdown: the same pill and menu look as the rest of the river, instead of the browser's grey list.
 * options: [[value, label], ...]
 */
export default function RSelect({ label, value, options, onChange, up = false, block = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const cur = options.find((o) => String(o[0]) === String(value));
  return (
    <div className={`r-sel${block ? ' block' : ''}`} ref={ref}>
      <button type="button" className="r-sel-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <small>{label}</small>
        <b>{cur ? cur[1] : ''}</b>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={`r-sel-pop${up ? ' up' : ''}`} role="listbox" aria-label={label}>
          {options.map(([v, n]) => {
            const on = String(v) === String(value);
            return (
              <button key={String(v)} type="button" role="option" aria-selected={on} className={on ? 'on' : ''} onClick={() => { onChange(v); setOpen(false); }}>
                <span>{n}</span>{on && <Check size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
