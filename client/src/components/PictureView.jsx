import { useEffect, useState } from 'react';
import { Copy, Check, Download, X } from 'lucide-react';
import { copyImage } from '../utils/copyImage';
import './pictureView.css';

/** A picture shown full size on a page that cannot be edited: copy it, save it, or close it. */
export default function PictureView({ src, name, onClose }) {
  const [done, setDone] = useState('');
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const copy = (e) => { e.stopPropagation(); copyImage(src).then((r) => { setDone(r); setTimeout(() => setDone(''), 1800); }); };
  const save = (e) => {
    e.stopPropagation();
    const a = document.createElement('a'); a.href = String(src).split('#')[0]; a.download = (name || 'picture').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'picture';
    document.body.appendChild(a); a.click(); a.remove();
  };
  const label = done === 'link' ? 'Link copied' : done === 'failed' ? 'Could not copy' : done ? 'Copied' : 'Copy picture';
  return (
    <div className="pv-back" role="dialog" aria-modal="true" aria-label="Picture" data-testid="picture-view" onClick={onClose}>
      <img src={src} alt={name || ''} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="pv-x" aria-label="Close picture" onClick={onClose}><X size={18} /></button>
      <div className="pv-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" data-testid="picture-copy" aria-label="Copy picture" onClick={copy}>{done && done !== 'failed' ? <Check size={16} /> : <Copy size={16} />}<span>{label}</span></button>
        <button type="button" data-testid="picture-save" aria-label="Save picture" onClick={save}><Download size={16} /><span>Save</span></button>
      </div>
    </div>
  );
}
