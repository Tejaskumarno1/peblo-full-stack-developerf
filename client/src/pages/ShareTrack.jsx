import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/** S25: a thin track beside the page. Dots are the other people, the grey block is my own screen. */
export function ShareTrack({ articleRef, viewers, colorOf, name }) {
  const [tick, setTick] = useState(0);
  const [own, setOwn] = useState({ top: 0, h: 20 });
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return undefined;
    const upd = () => { const h = el.scrollHeight || 1; setOwn({ top: (el.scrollTop / h) * 100, h: Math.min(100, (el.clientHeight / h) * 100) }); setTick((t) => t + 1); };
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    return () => { el.removeEventListener('scroll', upd); window.removeEventListener('resize', upd); };
  }, [articleRef]);
  const el = articleRef.current;
  const blocks = el ? [...el.querySelectorAll('.bn-block-outer, .doc > *')] : [];
  const total = el?.scrollHeight || 1;
  const dots = viewers.filter((v) => !v.self && v.cursor != null && blocks[v.cursor]).map((v) => ({ id: v.id, name: v.name, y: (blocks[v.cursor].offsetTop / total) * 100 }));
  void tick; void name;
  if (!dots.length) return null;
  return (
    <div className="sh-track" data-testid="share-track" aria-hidden="true">
      <i className="sh-own" style={{ top: `${own.top}%`, height: `${own.h}%` }} />
      {dots.map((d) => <i key={d.id} className="sh-dot" title={d.name} style={{ top: `${Math.min(97, d.y)}%`, background: colorOf(d.id) }} />)}
    </div>
  );
}

/** S25: "Following <name>. Your page scrolls with them." */
export function FollowBanner({ who, color, onStop }) {
  if (!who) return null;
  return (
    <div className="follow-ban" data-testid="follow-ban" role="status">
      <span className="fb-av" style={{ background: color }}>{(who.name || 'G')[0].toUpperCase()}</span>
      <span>Following <b>{who.name}</b>. Your page scrolls with them.</span>
      <button type="button" data-testid="follow-stop" onClick={onStop}><X size={14} />Stop</button>
    </div>
  );
}
