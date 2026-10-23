import { useEffect, useRef, useState } from 'react';
import { SCOPE_EVENT } from '../utils/askScope';

/** "Which ones?" for a repeating task. Opened by askScope() from anywhere. */
export default function SeriesScopeDialog() {
  const [ask, setAsk] = useState(null);
  const first = useRef(null);

  useEffect(() => {
    const open = (e) => { e.detail.handled = true; e.preventDefault(); setAsk(e.detail); };
    window.addEventListener(SCOPE_EVENT, open);
    return () => window.removeEventListener(SCOPE_EVENT, open);
  }, []);
  useEffect(() => { if (ask) first.current?.focus(); }, [ask]);

  if (!ask) return null;
  const answer = (v) => { ask.resolve(v); setAsk(null); };
  const verb = ask.verb === 'edit' ? 'Edit' : 'Delete';
  return (
    <div className="settings-hub-overlay" style={{ zIndex: 10000 }} onClick={() => answer(null)} onKeyDown={(e) => { if (e.key === 'Escape') answer(null); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="series-scope-title" onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--pb-surface, #fff)', color: 'var(--pb-fg, #111)', border: '1px solid var(--pb-line, #ddd)', borderRadius: 14, padding: 20, width: 'min(420px, 92vw)', margin: 'auto', display: 'grid', gap: 10 }}>
        <h2 id="series-scope-title" style={{ margin: 0, fontSize: 16 }}>{verb} a repeating task</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--pb-fg-2, #555)' }}>&ldquo;{ask.text}&rdquo; repeats. Which tasks should this apply to?</p>
        <button ref={first} type="button" className="pb-btn" onClick={() => answer('this')}>Just this one</button>
        <button type="button" className="pb-btn" onClick={() => answer('following')}>This and following</button>
        <button type="button" className="pb-btn" onClick={() => answer('all')}>All in the series</button>
        <button type="button" className="pb-btn sm" onClick={() => answer(null)}>Cancel</button>
      </div>
    </div>
  );
}
