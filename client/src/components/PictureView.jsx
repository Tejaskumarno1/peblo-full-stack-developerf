import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Copy, Check, Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import { copyImage } from '../utils/copyImage';
import './pictureView.css';

/** A picture shown full size on a page that cannot be edited: step through the pictures, zoom, copy, save, close. */
export default function PictureView({ src, name, list, index = 0, onClose }) {
  const items = list && list.length ? list : [{ src, name }];
  const [ix, setIx] = useState(Math.min(index, items.length - 1));
  const [zoom, setZoom] = useState(1);
  const [done, setDone] = useState('');
  const cur = items[ix] || { src, name };
  const go = (d) => { setIx((i) => (i + d + items.length) % items.length); setZoom(1); };
  const zoomBy = (d) => setZoom((z) => Math.min(4, Math.max(0.5, +(z + d).toFixed(2))));
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && items.length > 1) go(1);
      else if (e.key === 'ArrowLeft' && items.length > 1) go(-1);
      else if (e.key === '+' || e.key === '=') zoomBy(0.25);
      else if (e.key === '-') zoomBy(-0.25);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = (e) => { e.stopPropagation(); copyImage(cur.src).then((r) => { setDone(r); setTimeout(() => setDone(''), 1800); }); };
  const save = (e) => {
    e.stopPropagation();
    const a = document.createElement('a'); a.href = String(cur.src).split('#')[0]; a.download = (cur.name || 'picture').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'picture';
    document.body.appendChild(a); a.click(); a.remove();
  };
  const label = done === 'link' ? 'Link copied' : done === 'failed' ? 'Could not copy' : done ? 'Copied' : 'Copy picture';
  return createPortal(
    <div className="pv-back" role="dialog" aria-modal="true" aria-label="Picture" data-testid="picture-view" onClick={onClose} onWheel={(e) => zoomBy(e.deltaY < 0 ? 0.15 : -0.15)}>
      <div className="pv-top" onClick={(e) => e.stopPropagation()}>
        <span className="pv-name"><b>{cur.name || 'Picture'}</b>{items.length > 1 && <em data-testid="picture-count"> {ix + 1} of {items.length}</em>}</span>
        <button type="button" aria-label="Zoom out" data-testid="picture-zoom-out" onClick={() => zoomBy(-0.25)}><ZoomOut size={17} /></button>
        <span className="pv-pct" data-testid="picture-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" data-testid="picture-zoom-in" onClick={() => zoomBy(0.25)}><ZoomIn size={17} /></button>
        <button type="button" aria-label="Save picture" data-testid="picture-save" onClick={save}><Download size={17} /></button>
        <button type="button" className="pv-xx" aria-label="Close picture" onClick={onClose}><X size={18} /></button>
      </div>
      {items.length > 1 && <button type="button" className="pv-nav l" aria-label="Previous picture" data-testid="picture-prev" onClick={(e) => { e.stopPropagation(); go(-1); }}><ChevronLeft size={22} /></button>}
      <img src={cur.src} alt={cur.name || ''} style={{ transform: `scale(${zoom})` }} onClick={(e) => e.stopPropagation()} />
      {items.length > 1 && <button type="button" className="pv-nav r" aria-label="Next picture" data-testid="picture-next" onClick={(e) => { e.stopPropagation(); go(1); }}><ChevronRight size={22} /></button>}
      <div className="pv-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" data-testid="picture-copy" aria-label="Copy picture" onClick={copy}>{done && done !== 'failed' ? <Check size={16} /> : <Copy size={16} />}<span>{label}</span></button>
        <span className="pv-hint">Arrow keys move <kbd>Esc</kbd> closes. Scroll to zoom.</span>
      </div>
    </div>,
    document.body,
  );
}
