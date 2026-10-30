import { useEffect, useRef, useState } from 'react';
import { BookOpen, NotebookPen, Brain, Lightbulb, Microscope, Ruler, Code, Calculator, ChartColumn, Target, Star, Flame, Sprout, FlaskConical, CircleCheck, Calendar, Plus } from 'lucide-react';

/**
 * Icons for topics and notes. The saved value stays the emoji string it always was, so
 * existing data keeps working; the screen draws a line icon for each known one and
 * falls back to the raw text for anything else.
 */
const ICONS = {
  '📘': { Icon: BookOpen, name: 'Book' },
  '📝': { Icon: NotebookPen, name: 'Notebook' },
  '🧠': { Icon: Brain, name: 'Brain' },
  '💡': { Icon: Lightbulb, name: 'Idea' },
  '🔬': { Icon: Microscope, name: 'Microscope' },
  '📐': { Icon: Ruler, name: 'Ruler' },
  '💻': { Icon: Code, name: 'Code' },
  '🧮': { Icon: Calculator, name: 'Calculator' },
  '📊': { Icon: ChartColumn, name: 'Chart' },
  '🎯': { Icon: Target, name: 'Target' },
  '⭐': { Icon: Star, name: 'Star' },
  '🔥': { Icon: Flame, name: 'Flame' },
  '✅': { Icon: CircleCheck, name: 'Done' },
  '📅': { Icon: Calendar, name: 'Calendar' },
  '🌱': { Icon: Sprout, name: 'Sprout' },
  '🧪': { Icon: FlaskConical, name: 'Flask' },
};
const clean = (v) => String(v).replace(/️/g, '');

export const TOPIC_CHOICES = ['📘', '📝', '🧠', '💡', '🔬', '📐', '💻', '🧮', '📊', '🎯', '⭐', '🔥', '🌱', '🧪'];
export const NOTE_CHOICES = ['📘', '📝', '🧠', '💡', '🔬', '📐', '💻', '🧮', '📊', '🎯', '⭐', '🔥', '✅', '📅', '🌱', '🧪'];

export const iconName = (value) => ICONS[clean(value || '')]?.name || 'icon';

/** The icon for a stored value; unknown values are shown as the text they are. */
export function TopicIcon({ value, size = 14 }) {
  if (!value || typeof value !== 'string') return null;
  const hit = ICONS[clean(value)];
  if (hit) {
    const { Icon } = hit;
    return <Icon size={size} strokeWidth={2.2} aria-hidden="true" style={{ flex: 'none', verticalAlign: '-2px' }} />;
  }
  return <span aria-hidden="true">{value}</span>;
}

/** A button that opens a grid of icons. onChange gets the stored value, or null for "remove". */
export function IconPicker({ value, onChange, choices, subject = 'icon', disabled = false, triggerClassName = 'o-chip', popClassName = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const pick = (v) => { setOpen(false); onChange(v); };
  return (
    <span className="o-menu-wrap" ref={ref}>
      <button type="button" className={triggerClassName} aria-label={value ? `${subject}: ${iconName(value)}, change` : `Add ${subject}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {value ? <TopicIcon value={value} size={18} /> : <Plus size={16} aria-hidden="true" />}
      </button>
      {open && (
        <div className={`o-pop o-emojis ${popClassName}`.trim()} role="menu">
          {choices.map((c) => (
            <button key={c} type="button" role="menuitem" aria-label={`Use ${iconName(c)}`} aria-current={clean(value || '') === c ? 'true' : undefined} style={{ justifyContent: 'center' }} onClick={() => pick(c)}><TopicIcon value={c} size={18} /></button>
          ))}
          {value && <button type="button" role="menuitem" style={{ gridColumn: '1 / -1', fontSize: 13 }} onClick={() => pick(null)}>Remove</button>}
        </div>
      )}
    </span>
  );
}
