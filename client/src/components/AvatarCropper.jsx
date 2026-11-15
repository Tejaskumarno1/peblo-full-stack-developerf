import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/profiles.css'; // the dialog's styles ship with the dialog, so it is never drawn unstyled

const BOX = 300; // the crop square, in screen pixels (the stage is bigger; the ring marks the square)
const OUT = 512; // the saved picture is always square, OUT by OUT pixels
const MAX_ZOOM = 4;

/** Move, zoom, rotate and flip a picture inside a 1:1 square, then save it as a 512 by 512 WebP. */
export default function AvatarCropper({ file, onCancel, onSave }) {
  const [src, setSrc] = useState(file);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0);
  const [flip, setFlip] = useState(false);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);
  const stage = useRef(null);
  const picker = useRef(null);
  const dialog = useRef(null);

  useEffect(() => {
    setImg(null);
    const url = URL.createObjectURL(src);
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setErr('That picture could not be opened.');
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [src]);

  // Escape closes the dialog even when focus is still on the page behind it
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  useEffect(() => { dialog.current?.focus(); }, []);

  const rotated = turns % 2 !== 0;
  const iw = img ? (rotated ? img.naturalHeight : img.naturalWidth) : 1;
  const ih = img ? (rotated ? img.naturalWidth : img.naturalHeight) : 1;
  const s = Math.max(BOX / iw, BOX / ih) * zoom; // screen pixels per picture pixel; at zoom 1 the picture just covers the square

  const clamp = (o) => {
    const mx = Math.max(0, (iw * s - BOX) / 2), my = Math.max(0, (ih * s - BOX) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };
  useEffect(() => { setOff((o) => clamp(o)); /* keep the picture covering the square */ }, [zoom, turns, img]); // eslint-disable-line react-hooks/exhaustive-deps

  const setZ = (z) => setZoom(Math.max(1, Math.min(MAX_ZOOM, z)));
  // The wheel zooms. It needs a listener that may cancel the page scroll, which React's onWheel does not allow.
  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const onWheel = (e) => { e.preventDefault(); setZoom((z) => Math.max(1, Math.min(MAX_ZOOM, z - e.deltaY * 0.002))); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const down = (e) => { drag.current = { x: e.clientX, y: e.clientY, o: off }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (drag.current) setOff(clamp({ x: drag.current.o.x + e.clientX - drag.current.x, y: drag.current.o.y + e.clientY - drag.current.y })); };
  const up = () => { drag.current = null; };
  const nudge = (e) => {
    const step = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
    if (step) { e.preventDefault(); setOff((o) => clamp({ x: o.x + step[0], y: o.y + step[1] })); }
    else if (e.key === '+' || e.key === '=') setZ(zoom + 0.1);
    else if (e.key === '-') setZ(zoom - 0.1);
  };

  const reset = () => { setZoom(1); setTurns(0); setFlip(false); setOff({ x: 0, y: 0 }); setErr(''); };
  const choose = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr('Choose a picture file.'); return; }
    reset();
    setSrc(f);
  };

  const turn = `rotate(${(turns % 4) * 90}deg)`;
  const flipS = flip ? ' scaleX(-1)' : '';
  // The picture as drawn inside a box k times the crop square (k = 1 for the stage, less for the preview chips)
  const imgStyle = (k) => img && ({ width: img.naturalWidth * s * k, height: img.naturalHeight * s * k, transform: `translate(-50%, -50%) translate(${off.x * k}px, ${off.y * k}px) ${turn}${flipS}` });

  const save = async () => {
    if (!img || busy) return;
    setBusy(true); setErr('');
    try {
      const c = document.createElement('canvas');
      c.width = OUT; c.height = OUT;
      const g = c.getContext('2d');
      const k = OUT / BOX; // saved pixels per screen pixel
      g.translate(OUT / 2 + off.x * k, OUT / 2 + off.y * k);
      g.rotate((turns % 4) * Math.PI / 2);
      g.scale(flip ? -1 : 1, 1);
      const sw = img.naturalWidth * s * k, sh = img.naturalHeight * s * k;
      g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      let out = c.toDataURL('image/webp', 0.82);
      if (!out.startsWith('data:image/webp')) throw new Error('This browser cannot make WebP pictures.');
      for (let q = 0.7; out.length > 150000 && q > 0.2; q -= 0.1) out = c.toDataURL('image/webp', q);
      if (out.length > 190000) throw new Error('That picture is too detailed to save. Zoom in a little or choose another.');
      await onSave(out);
    } catch (e) { setErr(e.message || 'Could not save the picture.'); setBusy(false); }
  };

  const pct = ((zoom - 1) / (MAX_ZOOM - 1)) * 100;
  const chip = (cls, k) => <div className={`pb-crop-chip ${cls}`} aria-hidden="true">{img && <img src={img.src} alt="" draggable="false" style={imgStyle(k)} />}</div>;

  return createPortal(
    <div className="pb-crop-back" role="dialog" aria-modal="true" aria-label="Crop your picture">
      <div className="pb-crop" ref={dialog} tabIndex={-1}>
        <div className="pb-crop-head">
          <b>Crop your picture</b>
          <button type="button" aria-label="Close" onClick={onCancel}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="pb-crop-main">
          <div className="pb-crop-stage" ref={stage} tabIndex={0} role="application" aria-label="Picture. Drag to move it, use the arrow keys to nudge it, and the plus and minus keys to zoom."
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={nudge}>
            {img && <img src={img.src} alt="" draggable="false" style={imgStyle(1)} />}
            <div className="pb-crop-ring" />
            <div className="pb-crop-thirds"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            <div className="pb-crop-drag">Drag to move</div>
          </div>
          <div className="pb-crop-prev">
            <h3>Preview</h3>
            {chip('l', 112 / BOX)}
            {chip('m', 40 / BOX)}
            {chip('s', 28 / BOX)}
            <p>Square 1:1, saved at 512 by 512</p>
          </div>
        </div>
        <div className="pb-crop-tools">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b5d50" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4M8.5 11h5" /></svg>
          <input type="range" className="pb-crop-zoom" aria-label="Zoom" min="1" max={MAX_ZOOM} step="0.01" value={zoom} style={{ '--p': pct + '%' }} onChange={(e) => setZ(Number(e.target.value))} />
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6b5d50" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4M8.5 11h5M11 8.5v5" /></svg>
          <span className="sep" />
          <button type="button" className="ib" aria-label="Rotate left" onClick={() => setTurns((t) => t + 3)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4M4 9h5M5 13a8 8 0 108-8 8 8 0 00-6 3" /></svg></button>
          <button type="button" className="ib" aria-label="Flip" aria-pressed={flip} onClick={() => setFlip((f) => !f)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18M8 7L3 12l5 5zM16 7l5 5-5 5z" /></svg></button>
        </div>
        {err && <p className="pb-crop-err" role="alert">{err}</p>}
        <div className="pb-crop-foot">
          <input ref={picker} type="file" accept="image/*" hidden onChange={choose} />
          <button type="button" className="pb-crop-btn" onClick={() => picker.current?.click()}>Choose another</button>
          <button type="button" className="pb-crop-btn quiet" onClick={reset}>Reset</button>
          <span className="grow" />
          <button type="button" className="pb-crop-btn cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="pb-crop-btn main" disabled={!img || busy} onClick={save}>{busy ? 'Saving…' : 'Save picture'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
