import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCw } from 'lucide-react';

const ASPECTS = [
  { id: '1', label: 'Square', r: 1 },
  { id: '4:5', label: 'Portrait 4:5', r: 4 / 5 },
  { id: '3:2', label: 'Wide 3:2', r: 3 / 2 },
];
const BOX = 300; // size of the crop window's long side, in screen pixels
const OUT = 384; // long side of the saved picture, in pixels

/** Move, zoom, rotate and pick a shape for a profile picture, then save it as a small WebP. */
export default function AvatarCropper({ file, onCancel, onSave }) {
  const [img, setImg] = useState(null);
  const [aspect, setAspect] = useState(ASPECTS[0]);
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setErr('That picture could not be opened.');
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Escape closes the dialog even when focus is still on the page behind it
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const W = aspect.r >= 1 ? BOX : Math.round(BOX * aspect.r);
  const H = aspect.r >= 1 ? Math.round(BOX / aspect.r) : BOX;
  const rotated = turns % 2 === 1;
  const iw = img ? (rotated ? img.naturalHeight : img.naturalWidth) : 1;
  const ih = img ? (rotated ? img.naturalWidth : img.naturalHeight) : 1;
  const base = Math.max(W / iw, H / ih);
  const s = base * zoom;

  const clamp = (o) => {
    const mx = Math.max(0, (iw * s - W) / 2), my = Math.max(0, (ih * s - H) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };
  useEffect(() => { setOff((o) => clamp(o)); /* keep the picture covering the window */ }, [zoom, aspect, turns, img]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e) => { drag.current = { x: e.clientX, y: e.clientY, o: off }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (drag.current) setOff(clamp({ x: drag.current.o.x + e.clientX - drag.current.x, y: drag.current.o.y + e.clientY - drag.current.y })); };
  const up = () => { drag.current = null; };

  const draw = useMemo(() => (cw, ch) => {
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const k = cw / W; // saved pixels per screen pixel
    g.translate(cw / 2 + off.x * k, ch / 2 + off.y * k);
    g.rotate((turns % 4) * Math.PI / 2);
    const sw = img.naturalWidth * s * k, sh = img.naturalHeight * s * k;
    g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    return c;
  }, [img, off, turns, s, W]);

  const save = async () => {
    if (!img) return;
    setBusy(true); setErr('');
    try {
      const cw = aspect.r >= 1 ? OUT : Math.round(OUT * aspect.r);
      const ch = aspect.r >= 1 ? Math.round(OUT / aspect.r) : OUT;
      const c = draw(cw, ch);
      let out = c.toDataURL('image/webp', 0.82);
      if (!out.startsWith('data:image/webp')) throw new Error('This browser cannot make WebP pictures.');
      for (let q = 0.7; out.length > 150000 && q > 0.3; q -= 0.15) out = c.toDataURL('image/webp', q);
      await onSave(out);
    } catch (e) { setErr(e.message || 'Could not save the picture.'); setBusy(false); }
  };

  return createPortal(
    <div className="pb-crop-back" role="dialog" aria-modal="true" aria-label="Crop your picture">
      <div className="pb-crop">
        <div className="pb-crop-head"><b>Crop your picture</b><button type="button" aria-label="Close" onClick={onCancel}><X size={18} /></button></div>
        <div className="pb-crop-stage">
          <div className={`pb-crop-win${aspect.r === 1 ? ' round' : ''}`} style={{ width: W, height: H }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onWheel={(e) => setZoom((z) => Math.max(1, Math.min(4, z - e.deltaY * 0.002)))}>
            {img && <img src={img.src} alt="" draggable="false" style={{ width: img.naturalWidth * s, height: img.naturalHeight * s, transform: `translate(-50%, -50%) translate(${off.x}px, ${off.y}px) rotate(${(turns % 4) * 90}deg)` }} />}
          </div>
        </div>
        <div className="pb-crop-tools">
          <div className="pb-crop-aspects" role="radiogroup" aria-label="Shape">
            {ASPECTS.map((a) => <button key={a.id} type="button" role="radio" aria-checked={aspect.id === a.id} className={aspect.id === a.id ? 'on' : ''} onClick={() => setAspect(a)}>{a.label}</button>)}
          </div>
          <label className="pb-crop-zoom">Zoom
            <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <button type="button" className="pb-crop-rot" onClick={() => setTurns((t) => t + 1)}><RotateCw size={15} /> Rotate</button>
        </div>
        <p className="pb-crop-hint">Drag the picture to move it. It is saved as a small WebP.</p>
        {err && <p className="pb-crop-err" role="alert">{err}</p>}
        <div className="pb-crop-foot">
          <button type="button" className="pb-crop-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="pb-crop-btn main" disabled={!img || busy} onClick={save}>{busy ? 'Saving…' : 'Save picture'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
