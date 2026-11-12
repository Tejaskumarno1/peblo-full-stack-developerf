import { useState } from 'react';
import './skeleton.css';

/** Grey placeholder bars shown while something loads (mockups WsD03 and WsD05). Hidden from screen readers; the wrapper says "Loading". */
export const Bar = ({ w = '100%', h = 14, r = 8, style }) => <span className="s-sk" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;

/** The note body while the text is coming: real text when we already have it, grey bars when we do not. */
export function EditorSkeleton({ title }) {
  return (
    <div className="s-sk-editor" role="status" aria-label="Opening note" data-testid="note-skeleton">
      {title ? <h1 className="s-sk-title">{title}</h1> : <Bar w="46%" h={30} r={10} />}
      <div className="s-sk-chips"><Bar w={70} h={30} r={15} /><Bar w={90} h={30} r={15} /></div>
      <div className="s-sk-lines">
        <Bar w="34%" h={22} /><Bar w="92%" /><Bar w="88%" /><Bar w="95%" /><Bar w="60%" />
        <Bar w="42%" h={22} style={{ marginTop: 10 }} /><Bar w="90%" /><Bar w="74%" />
      </div>
    </div>
  );
}

export function RailSkeleton() {
  return (
    <div className="s-sk-rail" aria-hidden="true">
      <div className="s-sk-card" style={{ background: 'var(--s-lilac)', height: 92 }}><Bar w="46%" h={16} /><Bar w="100%" /><Bar w="70%" /></div>
      <div className="s-sk-card" style={{ background: 'var(--s-peach)', height: 70 }}><Bar w="40%" h={16} /><Bar w="80%" /></div>
      <div className="s-sk-card" style={{ background: 'var(--s-mint)', height: 70 }}><Bar w="44%" h={16} /><Bar w="60%" /></div>
    </div>
  );
}

/** The whole Notes screen while its code downloads (route fallback). */
export function NotesSkeleton() {
  return (
    <div className="s-sk-notes" role="status" aria-label="Loading notes" data-testid="notes-skeleton">
      <div className="s-sk-list">{[70, 82, 64, 76, 58, 72].map((w, i) => <div key={i} className="s-sk-row"><Bar w={`${w}%`} h={14} /><Bar w={`${w - 20}%`} h={11} /></div>)}</div>
      <EditorSkeleton />
      <RailSkeleton />
    </div>
  );
}

/** A picture line of a note, drawn as the picture itself (never as its Markdown) at the size the owner chose; a soft block holds its place until it loads. */
function PreviewPicture({ alt, url }) {
  const [state, setState] = useState('wait');
  const [src, ...h] = url.split('#');
  const q = new URLSearchParams(h.join('#'));
  const pw = Number(q.get('pw'));
  const w = Number.isFinite(pw) && pw >= 1 && pw <= 10000 ? pw : 0;
  const plain = /^(?:\/|https?:\/\/)/i.test(src) && !/^data:/i.test(src);
  if (!plain || state === 'bad') return <div className="pic bad"><span>{alt && alt !== 'image.png' ? alt : 'Picture'}</span></div>;
  return (
    <div className={`pic ${state}`} style={w ? { width: w, maxWidth: '100%' } : undefined}>
      <img src={src} alt="" decoding="async" onLoad={() => setState('ok')} onError={() => setState('bad')} />
    </div>
  );
}

/** Text of a note shown at once, before the editor has started: plain, safe, read only. The editor replaces it when ready. */
export function NotePreview({ markdown }) {
  const lines = String(markdown || '').slice(0, 6000).split('\n').slice(0, 80);
  return (
    <div className="s-sk-preview" aria-hidden="true" data-testid="note-preview">
      {lines.map((l, i) => {
        if (!l.trim()) return <div key={i} className="gap" />;
        const h = /^(#{1,3})\s+(.*)$/.exec(l);
        if (h) return <div key={i} className={`h h${h[1].length}`}>{h[2]}</div>;
        const li = /^\s*(?:[-*+]|\d+\.)\s+(?:\[( |x)\]\s+)?(.*)$/i.exec(l);
        if (li) return <div key={i} className="li"><span>{li[1] === undefined ? '•' : li[1].trim() ? '☑' : '☐'}</span>{li[2]}</div>;
        const im = /^!\[([^\]]*)\]\((\S+?)\)\s*$/.exec(l);
        if (im) return <PreviewPicture key={i} alt={im[1]} url={im[2]} />;
        return <div key={i}>{l.replace(/[*_`~]/g, '')}</div>;
      })}
    </div>
  );
}
