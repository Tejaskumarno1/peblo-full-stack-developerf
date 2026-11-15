import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './timegrid.css';

/**
 * TimeGrid: a week or day calendar with ALL 24 hours inside ONE internal scroll area.
 * The page never scrolls: the day header and the all-day row are pinned above the scroller, the hour labels sit
 * at the left, and a 24-hour overview rail on the right lets you drag the red window to move anywhere.
 * Shared by the Soft Studio and Orbit calendars (mockup: docs/mockups/Calendar.dc.html).
 *
 * days     Date[]                          one column per day
 * events   [{ id, day, start, end, title, meta, bg, fg, bar, done, props }]  start/end are decimal hours on `day` (0 to 24)
 * allDay   [{ id, day, title, bg, fg, bar, done, props }]
 * onToday  called by "Jump to now" when today is not among the days
 * onDayDrop(day, event)  optional: columns accept dropped drag items
 * headClass  extra class for each day header cell
 */
export const HOUR_PX = 80;
const GUTTER = 56;
const DAY_H = 24;

const pad = (n) => String(n).padStart(2, '0');
export const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const sameDate = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Place overlapping events side by side, one cluster of overlaps at a time. */
function lanesFor(list) {
  const items = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex((e) => e <= it.start + 1e-6);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.end;
      it.lane = lane;
    }
    for (const it of cluster) { it.lanes = laneEnds.length; out.push(it); }
    cluster = [];
  };
  for (const it of items) {
    const copy = { ...it };
    if (cluster.length && copy.start >= clusterEnd - 1e-6) flush();
    if (!cluster.length) clusterEnd = copy.end; else clusterEnd = Math.max(clusterEnd, copy.end);
    cluster.push(copy);
  }
  flush();
  return out;
}

const SNAP = 0.25; // 15 minutes
const snap = (h) => Math.round(h / SNAP) * SNAP;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clock12 = (h) => {
  const m = Math.round(h * 60);
  const hh = Math.floor(m / 60) % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${pad(m % 60)} ${hh < 12 ? 'AM' : 'PM'}`;
};

export default function TimeGrid({ days, events, allDay = [], hourPx = HOUR_PX, onToday, onDayDrop, onMove, onCreate, headClass = '', label = 'Schedule' }) {
  const scroller = useRef(null);
  const canvas = useRef(null);
  const [drag, setDrag] = useState(null); // { mode: 'move' | 'resize' | 'create', id, day, start, end }
  const dragRef = useRef(null);
  const swallow = useRef(false);
  const track = useRef(null);
  const [pos, setPos] = useState({ top: 0, h: 0 });
  const [now, setNow] = useState(() => new Date());
  const [over, setOver] = useState(null);
  const pendingNow = useRef(false);
  const total = DAY_H * hourPx;
  const cols = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`;

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);

  const today = days.find((d) => sameDate(d, now));
  const nowH = now.getHours() + now.getMinutes() / 60;
  const nowPx = nowH * hourPx;

  const sync = useCallback(() => {
    const el = scroller.current;
    if (el) setPos((p) => (p.top === el.scrollTop && p.h === el.clientHeight ? p : { top: el.scrollTop, h: el.clientHeight }));
  }, []);
  const jump = useCallback((top, smooth = true) => {
    const el = scroller.current;
    if (!el) return;
    const t = Math.max(0, Math.min(total - el.clientHeight, top));
    el.scrollTo({ top: t, behavior: smooth && !reduced() ? 'smooth' : 'instant' });
  }, [total]);

  // Open near the current time (when today is on screen) or at 7 AM, again whenever the days change
  const rangeKey = days.map(dayKey).join(',');
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const n = new Date();
    const hasToday = days.some((d) => sameDate(d, n));
    const target = hasToday ? (n.getHours() + n.getMinutes() / 60 - 1.5) * hourPx : (7 - 0.25) * hourPx;
    jump(target, false);
    sync();
    if (pendingNow.current) pendingNow.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    sync();
    return () => ro?.disconnect();
  }, [sync]);

  const jumpNow = () => {
    if (today) jump(nowPx - pos.h / 2);
    else { pendingNow.current = true; onToday?.(); }
  };
  useEffect(() => {
    if (pendingNow.current && today) { pendingNow.current = false; jump(nowPx - (scroller.current?.clientHeight || 0) / 2, false); }
  }, [today, nowPx, jump]);

  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const el = scroller.current;
    let by = null; let to = null;
    if (e.key === 'ArrowDown') by = hourPx / 2;
    else if (e.key === 'ArrowUp') by = -hourPx / 2;
    else if (e.key === 'PageDown') by = el.clientHeight * 0.9;
    else if (e.key === 'PageUp') by = -el.clientHeight * 0.9;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = total;
    else return;
    e.preventDefault();
    jump(to !== null ? to : el.scrollTop + by);
  };

  // Rail: drag the red window, or click the track to centre it there
  const railDrag = useRef(null);
  const railDown = (e) => {
    const box = track.current.getBoundingClientRect();
    const winTop = (pos.top / total) * box.height;
    const winH = Math.max(12, (pos.h / total) * box.height);
    const y = e.clientY - box.top;
    const grab = y >= winTop && y <= winTop + winH ? y - winTop : winH / 2;
    railDrag.current = { grab, box };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    jump(((y - grab) / box.height) * total, false);
    e.preventDefault();
  };
  const railMove = (e) => {
    const d = railDrag.current;
    if (!d) return;
    jump(((e.clientY - d.box.top - d.grab) / d.box.height) * total, false);
  };
  const railUp = (e) => { railDrag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };

  const byDay = useMemo(() => days.map((d) => lanesFor(events.filter((ev) => sameDate(ev.day, d)))), [days, events]);

  // Drag to move, drag the bottom edge to resize, drag empty space to create. Snaps to 15 minutes.
  const hourAt = (y) => (y - canvas.current.getBoundingClientRect().top) / hourPx;
  const dayAt = (x) => {
    const cols = canvas.current?.querySelectorAll('.tg-col') || [];
    for (let i = 0; i < cols.length; i += 1) {
      const r = cols[i].getBoundingClientRect();
      if (x >= r.left && x < r.right) return days[i];
    }
    return null;
  };
  const startDrag = (e, mode, ev, day) => {
    if (e.button !== 0 || (mode !== 'create' && !onMove) || (mode === 'create' && !onCreate)) return;
    const h0 = hourAt(e.clientY);
    const st = { mode, ev, day, x0: e.clientX, y0: e.clientY, h0, active: false, last: null };
    dragRef.current = st;
    const move = (m) => {
      const s = dragRef.current;
      if (!s) return;
      if (!s.active && Math.hypot(m.clientX - s.x0, m.clientY - s.y0) < 5) return;
      s.active = true;
      const box = scroller.current.getBoundingClientRect();
      if (m.clientY < box.top + 36) scroller.current.scrollTop -= 14;
      else if (m.clientY > box.bottom - 36) scroller.current.scrollTop += 14;
      const h = hourAt(m.clientY);
      let next;
      if (s.mode === 'move') {
        const dur = s.ev.end - s.ev.start;
        const start = clamp(snap(s.ev.start + (h - s.h0)), 0, DAY_H - dur);
        next = { mode: 'move', id: s.ev.id, day: dayAt(m.clientX) || s.day, start, end: start + dur };
      } else if (s.mode === 'resize') {
        next = { mode: 'resize', id: s.ev.id, day: s.day, start: s.ev.start, end: clamp(snap(h), s.ev.start + SNAP, DAY_H) };
      } else {
        const a = snap(Math.min(s.h0, h)); const b = snap(Math.max(s.h0, h));
        next = { mode: 'create', day: s.day, start: clamp(a, 0, DAY_H - 0.5), end: clamp(Math.max(b, a + 0.5), 0.5, DAY_H) };
      }
      s.last = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const s = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!s) return;
      if (s.active && s.last) {
        swallow.current = true;
        setTimeout(() => { swallow.current = false; }, 0);
        if (s.mode === 'create') onCreate?.(s.last.day, s.last.start, s.last.end);
        else if (s.last.start !== s.ev.start || s.last.end !== s.ev.end || !sameDate(s.last.day, s.ev.day)) onMove?.(s.ev, s.last.day, s.last.start, s.last.end);
      } else if (s.mode === 'create') {
        const start = clamp(Math.floor(s.h0 * 2) / 2, 0, DAY_H - 1);
        onCreate?.(s.day, start, start + 1);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  // Keyboard: Alt + arrows moves by 15 minutes, Alt + Shift + arrows changes the length
  const evKey = (e, ev) => {
    if (!onMove || ev.cont || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const d = e.key === 'ArrowUp' ? -SNAP : SNAP;
    if (e.shiftKey) onMove(ev, ev.day, ev.start, clamp(ev.end + d, ev.start + SNAP, DAY_H));
    else if (ev.start + d >= 0 && ev.end + d <= DAY_H) onMove(ev, ev.day, ev.start + d, ev.end + d);
  };

  // Events out of view (above or below the visible hours)
  const topH = pos.top / hourPx;
  const botH = (pos.top + pos.h) / hourPx;
  const above = pos.h ? events.filter((e) => e.end <= Math.ceil(topH - 0.01) + 1e-6) : [];
  const below = pos.h ? events.filter((e) => e.start >= Math.floor(botH + 0.01) - 1e-6) : [];
  const aboveLbl = hourLabel(Math.min(23, Math.max(0, Math.ceil(topH - 0.01))));
  const belowLbl = hourLabel(Math.min(23, Math.max(0, Math.floor(botH + 0.01))));
  const nowVisible = today && pos.h && nowPx > pos.top + 24 && nowPx < pos.top + pos.h - 24;
  const showJump = !nowVisible;
  const firstOf = (list, pick) => list.reduce((a, b) => (pick(b) < pick(a) ? b : a), list[0]);

  return (
    <div className="tg">
      <div className="tg-card">
        <div className="tg-head" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((d) => (
            <div
              key={dayKey(d)}
              className={`tg-day ${headClass}${sameDate(d, now) ? ' today' : ''}${over === dayKey(d) ? ' over' : ''}`}
              data-day={dayKey(d)}
              onDragOver={onDayDrop ? (e) => { e.preventDefault(); setOver(dayKey(d)); } : undefined}
              onDragLeave={onDayDrop ? () => setOver(null) : undefined}
              onDrop={onDayDrop ? (e) => { e.preventDefault(); setOver(null); onDayDrop(d, e); } : undefined}
            >
              <span className="n">{d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</span>
              <span className="d">{d.getDate()}</span>
            </div>
          ))}
        </div>
        <div className="tg-allday" style={{ gridTemplateColumns: cols }}>
          <div className="lbl">ALL DAY</div>
          {days.map((d) => (
            <div key={dayKey(d)} className="cell">
              {allDay.filter((a) => sameDate(a.day, d)).map((a) => (
                <button key={a.id} type="button" className={`tg-chip${a.done ? ' done' : ''}`} style={{ background: a.bg, color: a.fg, borderLeftColor: a.bar }} {...(a.props || {})}>{a.title}</button>
              ))}
            </div>
          ))}
        </div>

        <div className="tg-body">
          <div
            ref={scroller}
            className="tg-scroll"
            tabIndex={0}
            role="region"
            aria-label={`${label}, 24 hours`}
            onScroll={sync}
            onKeyDown={onKey}
          >
            <div ref={canvas} className={`tg-canvas${drag ? ' dragging' : ''}`} style={{ height: total, gridTemplateColumns: cols }}>
              <div className="tg-hours" aria-hidden="false">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className={`tg-lbl${h === 0 ? ' first' : ''}`} style={{ top: h * hourPx }}>{hourLabel(h)}</span>
                ))}
              </div>
              {days.map((d, i) => {
                const isToday = sameDate(d, now);
                return (
                  <div
                    key={dayKey(d)}
                    className={`tg-col${isToday ? ' today' : ''}${over === dayKey(d) ? ' over' : ''}`}
                    data-day={dayKey(d)}
                    onPointerDown={onCreate ? (e) => { if (e.target === e.currentTarget || e.target.classList.contains('tg-hr')) startDrag(e, 'create', null, d); } : undefined}
                    onDragOver={onDayDrop ? (e) => { e.preventDefault(); setOver(dayKey(d)); } : undefined}
                    onDragLeave={onDayDrop ? () => setOver(null) : undefined}
                    onDrop={onDayDrop ? (e) => { e.preventDefault(); setOver(null); onDayDrop(d, e); } : undefined}
                  >
                    {Array.from({ length: 24 }, (_, h) => <i key={h} className="tg-hr" style={{ top: h * hourPx }} />)}
                    {drag && sameDate(drag.day, d) && (
                      <div className={`tg-ghost ${drag.mode}`} style={{ top: drag.start * hourPx, height: Math.max(12, (drag.end - drag.start) * hourPx - 3) }} aria-hidden="true">
                        <span className="tip">{clock12(drag.start)} - {clock12(drag.end)} · {Math.round((drag.end - drag.start) * 60)} min</span>
                      </div>
                    )}
                    {byDay[i].map((ev) => {
                      const top = ev.start * hourPx;
                      const height = Math.max(22, (Math.min(DAY_H, ev.end) - ev.start) * hourPx - 3);
                      return (
                        <button
                          key={`${ev.id}-${ev.cont ? 'c' : 'a'}`}
                          type="button"
                          className={`tg-ev${ev.done ? ' done' : ''}${height < 44 ? ' short' : ''}${ev.cont ? ' cont' : ''}${onMove && !ev.cont && !ev.fixed ? ' movable' : ''}${drag && drag.id === ev.id && drag.mode !== 'create' ? ' lifted' : ''}${ev.lanes > 1 ? ' clash' : ''}`}
                          style={{
                            top,
                            height,
                            left: `calc(${(ev.lane / ev.lanes) * 100}% + 4px)`,
                            width: `calc(${100 / ev.lanes}% - 8px)`,
                            background: ev.bg,
                            color: ev.fg,
                            borderLeftColor: ev.bar,
                          }}
                          title={ev.title}
                          data-start={ev.start}
                          data-end={ev.end}
                          {...(ev.props || {})}
                          onClickCapture={(e) => { if (swallow.current) { e.stopPropagation(); e.preventDefault(); } }}
                          onPointerDown={onMove && !ev.cont && !ev.fixed ? (e) => startDrag(e, 'move', ev, d) : undefined}
                          onKeyDown={(e) => evKey(e, ev)}
                        >
                          <span className="t">{ev.title}</span>
                          {ev.meta && <small>{ev.meta}</small>}
                          {ev.lanes > 1 && height >= 44 && <em className="tg-clash" title="Overlaps another event">Clash</em>}
                          {onMove && !ev.cont && !ev.fixed && <i className="tg-grip" aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, 'resize', ev, d); }} />}
                        </button>
                      );
                    })}
                    {isToday && (
                      <>
                        <span className="tg-now" style={{ top: nowPx }} />
                        <span className="tg-now-dot" style={{ top: nowPx }} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="tg-fade top" aria-hidden="true" />
          <div className="tg-fade bottom" aria-hidden="true" />
          {above.length > 0 && (
            <button type="button" className="tg-hint top" onClick={() => jump((firstOf(above, (e) => e.start).start - 0.5) * hourPx)}>
              {above.length} {above.length === 1 ? 'event' : 'events'} before {aboveLbl}
            </button>
          )}
          {below.length > 0 && (
            <button type="button" className="tg-hint bottom" onClick={() => jump((firstOf(below, (e) => e.start).start - 0.5) * hourPx)}>
              {below.length} {below.length === 1 ? 'event' : 'events'} after {belowLbl}
            </button>
          )}
          {showJump && <button type="button" className="tg-jump" onClick={jumpNow}>Jump to now</button>}
        </div>
      </div>

      <div className="tg-rail" aria-hidden="true">
        <span>12A</span>
        <div ref={track} className="track" onPointerDown={railDown} onPointerMove={railMove} onPointerUp={railUp} onPointerCancel={railUp}>
          <i className="win" style={{ top: `${(pos.top / total) * 100}%`, height: `${Math.max(2, (pos.h / total) * 100)}%` }} />
          {events.map((e, i) => <i key={`${e.id}-${i}`} className="tick" style={{ top: `${(e.start / DAY_H) * 100}%` }} />)}
          {today && <i className="tick now" style={{ top: `${(nowH / DAY_H) * 100}%` }} />}
        </div>
        <span>11P</span>
      </div>
    </div>
  );
}
