import { useState } from 'react';
import { Check, ExternalLink, Sparkles, Video, X } from 'lucide-react';
import { agendaDays, freeSlots, yearHeat, heatLevel } from './calUtils';
import { tagsOf, timeOf, weekdayLong } from './softUtils';
import './calextras.css';

const fmtDay = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const clock = (h) => { const m = Math.round(h * 60); const hh = Math.floor(m / 60) % 24; return `${hh % 12 === 0 ? 12 : hh % 12}:${String(m % 60).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

/** Agenda: the next 14 days as a plain list (mockup: Calendar views). */
export function AgendaView({ todos, from, toneFor, onPick }) {
  const groups = agendaDays(todos, from, 14);
  if (!groups.length) return <p className="s-empty">Nothing in the next two weeks. Drag across the week view to add something.</p>;
  return (
    <div className="s-agenda" role="list" aria-label="Agenda, next 14 days">
      {groups.map(({ day, items }) => (
        <section key={day.toISOString()} className="s-agenda-day" role="listitem">
          <h3>{new Date().toDateString() === day.toDateString() ? 'Today' : fmtDay(day)}</h3>
          {items.map((t) => {
            const c = toneFor(t);
            return (
              <button key={t.id} type="button" className={`s-agenda-row${t.completed ? ' done' : ''}`} style={{ background: c.bg, color: c.fg }} onClick={() => onPick(t)}>
                <span className="time">{timeOf(t) || 'All day'}</span>
                <span className="what"><b>{t.text}</b><small>{[t.endTime && `until ${t.endTime}`, tagsOf(t)[0] && `#${tagsOf(t)[0]}`].filter(Boolean).join(' · ')}</small></span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Find a free slot: pick a length, see the best times this week, pick one to create it there. */
export function FindSlot({ todos, from, onPick }) {
  const [mins, setMins] = useState(60);
  const slots = freeSlots(todos, from, mins / 60, { count: 2 });
  return (
    <section className="s-slot" aria-label="Find a free slot">
      <div className="s-slot-head"><Sparkles size={15} /><b>Find a free slot</b></div>
      <div className="s-slot-len" role="group" aria-label="Length">
        {[30, 60, 90, 120].map((m) => <button key={m} type="button" aria-pressed={mins === m} className={mins === m ? 'on' : ''} onClick={() => setMins(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}
      </div>
      {slots.length === 0 && <p className="s-slot-none">No free time of that length this week.</p>}
      {slots.map((s) => (
        <button key={`${s.day.toISOString()}-${s.start}`} type="button" className="s-slot-row" onClick={() => onPick(s)}>
          <span><b>{fmtDay(s.day)}</b><small>{clock(s.start)} - {clock(s.end)}</small></span>
          <em>Pick</em>
        </button>
      ))}
    </section>
  );
}

/** Peek panel: what it is, when, the link, and the three things you do next. */
export function PeekPanel({ t, onClose, onOpen, onDone }) {
  const link = t.meta?.link;
  const when = [weekdayLong(t.deadline), timeOf(t) && `${timeOf(t)}${t.endTime ? ` - ${t.endTime}` : ''}`].filter(Boolean).join(' · ');
  return (
    <aside className="s-peek" role="dialog" aria-label={`Details: ${t.text}`}>
      <div className="s-peek-head"><b>{t.text}</b><button type="button" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      <p className="s-peek-when">{when}</p>
      {link && <a className="s-peek-link" href={link} target="_blank" rel="noreferrer"><Video size={15} /> Join<ExternalLink size={13} /></a>}
      {tagsOf(t).length > 0 && <div className="s-peek-tags">{tagsOf(t).map((g) => <span key={g}>#{g}</span>)}</div>}
      <div className="s-peek-actions">
        <button type="button" className="go" onClick={() => onOpen(t)}>Open</button>
        <button type="button" onClick={() => onDone(t)}><Check size={15} /> {t.completed ? 'Reopen' : 'Done'}</button>
      </div>
    </aside>
  );
}

/** Year view: every day of the year as a small square, darker when busier. Click a day to open it (mockup: Calendar views, heat map). */
export function YearView({ todos, year, mondayFirst = true, onPick }) {
  const months = yearHeat(todos, year, mondayFirst);
  const today = new Date();
  const dows = mondayFirst ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return (
    <div className="s-year" role="grid" aria-label={`${year} at a glance`}>
      {months.map((m) => (
        <section key={m.month} className="s-year-m" aria-label={new Date(year, m.month, 1).toLocaleDateString('en-GB', { month: 'long' })}>
          <h3>{new Date(year, m.month, 1).toLocaleDateString('en-GB', { month: 'short' })}</h3>
          <div className="s-year-dow" aria-hidden="true">{dows.map((d, i) => <i key={i}>{d}</i>)}</div>
          <div className="s-year-days">
            {Array.from({ length: m.lead }, (_, i) => <i key={`b${i}`} className="blank" aria-hidden="true" />)}
            {m.days.map(({ date, n }) => (
              <button key={date.getDate()} type="button" className={`lv${heatLevel(n)}${date.toDateString() === today.toDateString() ? ' today' : ''}`} aria-label={`${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${n === 0 ? 'nothing planned' : `${n} item${n === 1 ? '' : 's'}`}`} onClick={() => onPick(date)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
