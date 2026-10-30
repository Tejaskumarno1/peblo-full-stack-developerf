import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';

const IMG = /!\[([^\]]*)\]\(([^)\s]+)\)|<img[^>]*?src="([^"]+)"[^>]*>(?:\s*<figcaption>([^<]*)<\/figcaption>)?/g;

// Every picture across your notes in one grid. Click one to open the note it lives in.
export default function Gallery({ notes, onOpen, onClose }) {
  const [q, setQ] = useState('');
  const dlg = useRef(null);
  useEffect(() => { dlg.current?.focus(); }, []); // focus inside so Escape works
  const pics = useMemo(() => {
    const out = [];
    for (const n of notes) {
      if (n.isDeleted) continue;
      let m; IMG.lastIndex = 0;
      while ((m = IMG.exec(n.content || ''))) {
        const url = (m[2] || m[3] || '').split('#')[0];
        if (!/^(\/api\/media\/|https?:|data:image\/)/.test(url)) continue;
        out.push({ url, caption: (m[1] || m[4] || '').trim(), noteId: n.id, title: n.title || 'Untitled', at: n.updatedAt });
      }
    }
    return out.sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [notes]);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? pics.filter((p) => p.title.toLowerCase().includes(s) || p.caption.toLowerCase().includes(s)) : pics; }, [pics, q]);
  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-share s-gal" role="dialog" aria-modal="true" tabIndex={-1} ref={dlg} aria-label="Pictures in your notes">
        <div className="s-share-head">
          <div><b>Pictures</b><small>{pics.length} in your notes</small></div>
          <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>
        <label className="s-nsearch" style={{ margin: '4px 0 8px' }}><Search size={14} aria-hidden="true" /><input aria-label="Search pictures" placeholder="Search by note or caption" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {shown.length === 0 && <p className="s-share-msg">{pics.length ? 'No pictures match.' : 'No pictures yet. Drop an image into a note and it will show up here.'}</p>}
        <div className="s-gal-grid">
          {shown.map((p, i) => (
            <button key={p.url + i} type="button" className="s-gal-item" onClick={() => onOpen(p.noteId)} title={p.title}>
              <img src={p.url} alt={p.caption || p.title} loading="lazy" />
              <span>{p.caption || p.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
