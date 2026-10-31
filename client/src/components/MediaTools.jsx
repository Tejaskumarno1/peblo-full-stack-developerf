import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, LayoutGrid, Rows3, Crop, Pencil, Trash2, RotateCw, FlipHorizontal, Check, Pause, Play, Mic, Upload, X } from 'lucide-react';

// Pictures, GIFs, video, voice notes and dictation for the note editor (mockups M1 A, M1 C, M2 a, C A, D A).

const tell = (state, message) => window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state, message } }));

// How a group of pictures is laid out is kept in the picture's address ("...#gl=grid&gc=3"), like its width, because Markdown has no other place for it.
export const groupOf = (url) => {
  const q = new URLSearchParams(String(url || '').split('#').slice(1).join('#'));
  return { gl: ['grid', 'row'].includes(q.get('gl')) ? q.get('gl') : 'stack', gc: Math.min(4, Math.max(2, Number(q.get('gc')) || 2)) };
};
export const withGroup = (url, gl, gc) => {
  const [base, ...h] = String(url || '').split('#');
  const q = new URLSearchParams(h.join('#'));
  q.delete('gl'); q.delete('gc');
  if (gl === 'grid' || gl === 'row') { q.set('gl', gl); if (gl === 'grid') q.set('gc', String(gc || 2)); }
  const s = q.toString();
  return s ? `${base}#${s}` : base;
};
const keepGroup = (oldUrl, newBase) => {
  const g = groupOf(oldUrl);
  return withGroup(newBase, g.gl, g.gc);
};

function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => { const f = [...inp.files]; inp.remove(); resolve(f); });
    inp.addEventListener('cancel', () => { inp.remove(); resolve([]); });
    inp.click();
  });
}

const isEmptyPara = (b) => b.type === 'paragraph' && !(Array.isArray(b.content) ? b.content.some((c) => c.type === 'link' || (c.text || '').trim()) : String(b.content || '').trim());
function place(editor, blocks, refId) {
  let ref;
  try { ref = (refId && editor.getBlock(refId)) || editor.getTextCursorPosition().block; } catch { ref = editor.document[editor.document.length - 1]; }
  const made = editor.insertBlocks(blocks, ref, 'after');
  if (isEmptyPara(ref)) editor.removeBlocks([ref]);
  return made;
}

// The pictures sitting next to each other around a picture (a group needs two or more).
export function groupAround(editor, id) {
  const walk = (list) => {
    const i = list.findIndex((b) => b.id === id);
    if (i >= 0) return list;
    for (const b of list) { const r = b.children?.length ? walk(b.children) : null; if (r) return r; }
    return null;
  };
  const sibs = walk(editor.document);
  if (!sibs) return [];
  let i = sibs.findIndex((b) => b.id === id);
  if (sibs[i].type !== 'image') return [];
  let a = i, z = i;
  while (a > 0 && sibs[a - 1].type === 'image') a -= 1;
  while (z < sibs.length - 1 && sibs[z + 1].type === 'image') z += 1;
  return sibs.slice(a, z + 1);
}

const VIDEO_URL = /\.(mp4|webm|ogv|mov|m4v)(?:[?#]|$)/i;

/* ------------------------------------------------------------------ the bar on a group of pictures (M2 a) */
function GroupBar({ editor, rootRef, onCrop }) {
  const [st, setSt] = useState(null); // { id, group, rect }
  const [alt, setAlt] = useState(null);
  const compute = useCallback(() => {
    try {
      const b = editor.getTextCursorPosition().block;
      if (!b || b.type !== 'image') { setSt(null); return; }
      const group = groupAround(editor, b.id);
      if (group.length < 2) { setSt(null); return; }
      const el = rootRef.current?.querySelector(`.bn-block-outer[data-id="${group[0].id}"]`);
      const r = el?.getBoundingClientRect();
      if (!r) { setSt(null); return; }
      setSt({ id: b.id, group, rect: { top: r.top, left: r.left, width: r.width } });
    } catch { setSt(null); }
  }, [editor, rootRef]);
  useEffect(() => {
    const off1 = editor.onSelectionChange?.(compute);
    const off2 = editor.onChange?.(compute);
    const root = rootRef.current;
    window.addEventListener('resize', compute);
    root?.addEventListener('scroll', compute, true);
    window.addEventListener('scroll', compute, true);
    compute();
    return () => { off1?.(); off2?.(); window.removeEventListener('resize', compute); root?.removeEventListener('scroll', compute, true); window.removeEventListener('scroll', compute, true); };
  }, [editor, rootRef, compute]);
  if (!st) return null;
  const cur = groupOf(st.group[0].props.url);
  const layout = (gl, gc) => {
    for (const m of st.group) editor.updateBlock(m.id, { props: { url: withGroup(m.props.url, gl, gc), previewWidth: undefined } });
    setTimeout(compute, 60);
  };
  const top = Math.max(8, st.rect.top - 52);
  const left = Math.max(8, Math.min(st.rect.left + 12, window.innerWidth - 470));
  const me = st.group.find((m) => m.id === st.id);
  return createPortal(
    <div className="pb-gbar" style={{ top, left }} role="toolbar" aria-label="Pictures" data-testid="group-bar" onMouseDown={(e) => { if (!e.target.closest('input')) e.preventDefault(); }}>
      <button type="button" className={cur.gl === 'stack' ? 'on' : ''} data-testid="gb-stack" onClick={() => layout('stack')}><Layers size={15} />Stack</button>
      <button type="button" className={cur.gl === 'grid' ? 'on' : ''} data-testid="gb-grid" onClick={() => layout('grid', cur.gc)}><LayoutGrid size={15} />Grid</button>
      <button type="button" className={cur.gl === 'row' ? 'on' : ''} data-testid="gb-row" onClick={() => layout('row')}><Rows3 size={15} />Row</button>
      <span className="sep" />
      {[2, 3, 4].map((n) => <button key={n} type="button" className={cur.gl === 'grid' && cur.gc === n ? 'on' : ''} data-testid={`gb-col${n}`} aria-label={`${n} columns`} onClick={() => layout('grid', n)}>{n}</button>)}
      <span className="sep" />
      <button type="button" aria-label="Crop this picture" title="Crop this picture" data-testid="gb-crop" onClick={() => onCrop(st.id)}><Crop size={15} /></button>
      <button type="button" aria-label="Caption and alt text" title="Caption and alt text" data-testid="gb-alt" className={alt !== null ? 'on' : ''} onClick={() => setAlt(alt === null ? (me?.props.caption || '') : null)}><Pencil size={15} /></button>
      <button type="button" aria-label="Delete this picture" title="Delete this picture" data-testid="gb-del" onClick={() => { editor.removeBlocks([st.id]); setTimeout(compute, 60); }}><Trash2 size={15} /></button>
      {alt !== null && (
        <form className="pb-gbar-alt" onSubmit={(e) => { e.preventDefault(); editor.updateBlock(st.id, { props: { caption: alt } }); setAlt(null); }}>
          <input autoFocus value={alt} placeholder="Caption, also read aloud as alt text" aria-label="Caption" data-testid="gb-alt-input" onChange={(e) => setAlt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setAlt(null); }} />
          <button type="submit">Save</button>
        </form>
      )}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ caption and alt text for one picture (opened from the picture bar) */
function CaptionPop({ editor, rootRef, id, onClose }) {
  const block = (() => { try { return editor.getBlock(id); } catch { return null; } })();
  const [text, setText] = useState(block?.props?.caption || '');
  const [pos, setPos] = useState({ top: 80, left: 80 });
  useEffect(() => {
    const bar = document.querySelector('.bn-toolbar')?.getBoundingClientRect();
    const img = rootRef.current?.querySelector(`.bn-block-outer[data-id="${id}"] img`)?.getBoundingClientRect();
    const w = 360;
    if (bar) setPos({ top: Math.min(window.innerHeight - 64, bar.bottom + 6), left: Math.max(8, Math.min(bar.left, window.innerWidth - w - 8)) });
    else if (img) setPos({ top: Math.max(8, img.top + 8), left: Math.max(8, Math.min(img.left + 8, window.innerWidth - w - 8)) });
  }, [id, rootRef]);
  useEffect(() => { if (!block) onClose(); }, [block, onClose]);
  if (!block) return null;
  const save = () => { try { editor.updateBlock(id, { props: { caption: text.trim() } }); } catch { /* the picture is gone */ } onClose(); };
  return createPortal(
    <form className="pb-gbar-alt pb-capfix" style={{ top: pos.top, left: pos.left }} data-testid="pic-caption-form" onSubmit={(e) => { e.preventDefault(); save(); }} onMouseDown={(e) => { if (!e.target.closest('input')) e.preventDefault(); }}>
      <input autoFocus value={text} placeholder="Caption, also read aloud as alt text" aria-label="Caption and alt text" data-testid="pic-caption" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} />
      <button type="submit">Save</button>
    </form>,
    document.body,
  );
}

/* ------------------------------------------------------------------ inline crop (C A) */
const RATIOS = [['free', 'Free', 0], ['1', '1:1', 1], ['43', '4:3', 4 / 3], ['169', '16:9', 16 / 9]];
function CropOverlay({ editor, rootRef, id, uploadFile, onClose }) {
  const [work, setWork] = useState(null);
  const [box, setBox] = useState(null);
  const [ratio, setRatio] = useState(0);
  const [busy, setBusy] = useState(false);
  const base = useRef(null);
  const live = useRef(null);
  const origin = useRef(null);
  const drag = useRef(null);
  const blk = editor.getBlock(id);

  // the working copy of the picture (rotated and flipped as asked)
  useEffect(() => {
    const el = rootRef.current?.querySelector(`.bn-block-outer[data-id="${id}"] img.bn-visual-media`);
    const r = el?.getBoundingClientRect();
    origin.current = r ? { left: r.left, top: r.top, width: r.width } : { left: 80, top: 120, width: 600 };
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      setWork(c);
    };
    img.onerror = () => { tell('error', 'That picture could not be opened for cropping.'); onClose(); };
    img.src = blk?.props?.url ? String(blk.props.url).split('#')[0] : '';
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const maxH = Math.max(180, window.innerHeight - 190);
  const stage = work ? (() => {
    let w = Math.min(origin.current.width, 900);
    let h = w * work.height / work.width;
    if (h > maxH) { h = maxH; w = h * work.width / work.height; }
    return { w, h, left: Math.max(8, Math.min(origin.current.left, window.innerWidth - w - 8)), top: Math.max(64, Math.min(origin.current.top, window.innerHeight - h - 24)) };
  })() : null;

  useEffect(() => {
    if (!stage || box) return;
    let w = stage.w * 0.84; let h = stage.h * 0.84;
    if (ratio) { h = w / ratio; if (h > stage.h * 0.84) { h = stage.h * 0.84; w = h * ratio; } }
    setBox({ x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h });
  }, [stage, box, ratio]);

  // paint the dim picture and the bright crop window
  useEffect(() => {
    if (!work || !stage) return;
    const b = base.current; if (b) { b.width = Math.round(stage.w); b.height = Math.round(stage.h); b.getContext('2d').drawImage(work, 0, 0, b.width, b.height); }
  }, [work, stage?.w, stage?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!work || !stage || !box || !live.current) return;
    const s = work.width / stage.w;
    const c = live.current; c.width = Math.max(1, Math.round(box.w)); c.height = Math.max(1, Math.round(box.h));
    c.getContext('2d').drawImage(work, box.x * s, box.y * s, box.w * s, box.h * s, 0, 0, c.width, c.height);
  }, [work, stage, box]);

  const fit = (r) => {
    setRatio(r);
    if (!r || !stage) return;
    let w = stage.w * 0.84; let h = w / r;
    if (h > stage.h * 0.84) { h = stage.h * 0.84; w = h * r; }
    setBox({ x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h });
  };
  const turn = (kind) => {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    if (kind === 'rotate') { c.width = work.height; c.height = work.width; x.translate(c.width, 0); x.rotate(Math.PI / 2); } else { c.width = work.width; c.height = work.height; x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(work, 0, 0);
    setBox(null); setWork(c);
  };

  const startDrag = (mode) => (e) => {
    e.preventDefault(); e.stopPropagation();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, box: { ...box } };
    const move = (ev) => {
      const d = drag.current; if (!d) return;
      const dx = ev.clientX - d.sx; const dy = ev.clientY - d.sy; const o = d.box;
      if (mode === 'move') { setBox({ ...o, x: Math.min(stage.w - o.w, Math.max(0, o.x + dx)), y: Math.min(stage.h - o.h, Math.max(0, o.y + dy)) }); return; }
      const right = mode.includes('e'); const bottom = mode.includes('s');
      const ax = right ? o.x : o.x + o.w; const ay = bottom ? o.y : o.y + o.h;
      let px = Math.min(stage.w, Math.max(0, (right ? o.x + o.w : o.x) + dx));
      let py = Math.min(stage.h, Math.max(0, (bottom ? o.y + o.h : o.y) + dy));
      let w = Math.max(24, Math.abs(px - ax)); let h = Math.max(24, Math.abs(py - ay));
      if (ratio) {
        h = w / ratio;
        const roomW = right ? stage.w - ax : ax; const roomH = bottom ? stage.h - ay : ay;
        if (w > roomW) { w = roomW; h = w / ratio; }
        if (h > roomH) { h = roomH; w = h * ratio; }
      }
      setBox({ x: right ? ax : ax - w, y: bottom ? ay : ay - h, w, h });
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const done = async () => {
    if (!work || !box || busy) return;
    setBusy(true);
    try {
      const s = work.width / stage.w;
      const sw = Math.max(1, Math.round(box.w * s)); const sh = Math.max(1, Math.round(box.h * s));
      const out = document.createElement('canvas'); out.width = sw; out.height = sh;
      out.getContext('2d').drawImage(work, box.x * s, box.y * s, box.w * s, box.h * s, 0, 0, sw, sh);
      const blob = await new Promise((res) => out.toBlob(res, 'image/webp', 0.9));
      if (!blob) throw new Error('The cropped picture could not be saved.');
      const url = await uploadFile(new File([blob], 'cropped.webp', { type: blob.type }));
      const cur = editor.getBlock(id);
      editor.updateBlock(id, { props: { url: keepGroup(cur?.props?.url, url), name: '' } });
      onClose();
    } catch (e) { tell('error', e?.message || 'The picture could not be cropped.'); setBusy(false); }
  };
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } else if (e.key === 'Enter') { e.preventDefault(); done(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  if (!stage || !box) return null;
  const tbTop = stage.top - 56 >= 8 ? stage.top - 56 : stage.top + stage.h + 12;
  return createPortal(
    <div className="pb-crop-veil" data-testid="crop-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pb-crop-tb" role="toolbar" aria-label="Crop" style={{ top: tbTop, left: Math.max(8, Math.min(stage.left, window.innerWidth - 440)) }}>
        {RATIOS.map(([k, label, r]) => <button key={k} type="button" className={ratio === r ? 'on' : ''} data-testid={`crop-${k}`} onClick={() => fit(r)}>{k === 'free' && <Crop size={14} />}{label}</button>)}
        <button type="button" aria-label="Rotate" title="Rotate" data-testid="crop-rotate" onClick={() => turn('rotate')}><RotateCw size={15} /></button>
        <button type="button" aria-label="Flip" title="Flip" data-testid="crop-flip" onClick={() => turn('flip')}><FlipHorizontal size={15} /></button>
        <button type="button" className="done" data-testid="crop-done" disabled={busy} onClick={done}><Check size={15} />{busy ? 'Saving' : 'Done'}</button>
      </div>
      <div className="pb-crop-stage" style={{ left: stage.left, top: stage.top, width: stage.w, height: stage.h }}>
        <canvas ref={base} className="pb-crop-base" />
        <div className="pb-crop-box" data-testid="crop-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} onPointerDown={startDrag('move')}>
          <canvas ref={live} />
          <i className="g v1" /><i className="g v2" /><i className="g h1" /><i className="g h2" />
          {['nw', 'ne', 'sw', 'se'].map((h) => <b key={h} className={`h ${h}`} data-testid={`crop-h-${h}`} onPointerDown={startDrag(h)} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ dictation and voice notes (D A) */
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function caretSpot() {
  try {
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const r = sel.getRangeAt(0).cloneRange(); r.collapse(false);
      const b = r.getClientRects()[0] || r.getBoundingClientRect();
      if (b && (b.top || b.left)) return { top: b.bottom + 14, left: b.left };
    }
  } catch { /* none */ }
  return { top: window.innerHeight - 110, left: window.innerWidth / 2 - 140 };
}
const Wave = () => <span className="pb-wave" aria-hidden="true">{[8, 16, 22, 12, 20, 9, 15].map((h, i) => <i key={i} style={{ height: h, animationDelay: `${i * 0.11}s` }} />)}</span>;

function Dictation({ editor, onClose }) {
  const [state, setState] = useState('listening'); // listening | paused | error
  const [live, setLive] = useState('');
  const [msg, setMsg] = useState('');
  const [spot] = useState(caretSpot);
  const rec = useRef(null);
  const want = useRef(true);
  const add = useCallback((t) => {
    const text = String(t || '').trim();
    if (!text) return;
    try { editor.focus(); editor.insertInlineContent([{ type: 'text', text: `${text} `, styles: {} }]); } catch { /* no cursor */ }
  }, [editor]);
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setState('error'); setMsg('Voice typing needs Chrome or Edge. This window cannot listen.'); return undefined; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US';
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const res = ev.results[i];
        if (res.isFinal) add(res[0].transcript); else interim += res[0].transcript;
      }
      setLive(interim);
    };
    r.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      want.current = false; setState('error');
      setMsg(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'The microphone is blocked. Allow it for this site and try again.' : ev.error === 'network' ? 'Voice typing is not available in this window. Open Peblo in Chrome or Edge.' : `Voice typing stopped (${ev.error}).`);
    };
    r.onend = () => { if (want.current) { try { r.start(); } catch { /* already running */ } } };
    rec.current = r;
    try { r.start(); } catch { /* already running */ }
    return () => { want.current = false; try { r.abort(); } catch { /* gone */ } };
  }, [add]);
  const pause = () => {
    if (state === 'listening') { want.current = false; setState('paused'); setLive(''); try { rec.current?.stop(); } catch { /* x */ } }
    else if (state === 'paused') { want.current = true; setState('listening'); try { rec.current?.start(); } catch { /* x */ } }
  };
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div className={`pb-pill${state === 'error' ? ' err' : ''}`} role="status" aria-label={state === 'listening' ? 'Listening' : 'Voice typing'} data-testid="dictation" data-state={state} style={{ top: Math.min(spot.top, window.innerHeight - 70), left: Math.max(8, Math.min(spot.left, window.innerWidth - 330)) }}>
      {live && state === 'listening' && <span className="pb-live" data-testid="dictation-live">{live}</span>}
      <span className={`m${state === 'paused' ? ' off' : ''}`}><Mic size={17} /></span>
      {state === 'error' ? <b className="msg">{msg}</b> : (
        <>
          {state === 'listening' ? <Wave /> : null}
          <b>{state === 'listening' ? 'Listening' : 'Paused'}</b>
          <button type="button" className="x" aria-label={state === 'listening' ? 'Pause' : 'Resume'} data-testid="dictation-pause" onClick={pause}>{state === 'listening' ? <Pause size={14} /> : <Play size={14} />}</button>
        </>
      )}
      <button type="button" className="x" aria-label={state === 'error' ? 'Close' : 'Finish'} data-testid="dictation-done" onClick={onClose}>{state === 'error' ? <X size={14} /> : <Check size={14} />}</button>
    </div>,
    document.body,
  );
}

function Recorder({ onDone, onClose }) {
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  const [spot] = useState(caretSpot);
  const mr = useRef(null);
  const chunks = useRef([]);
  const keep = useRef(true);
  useEffect(() => {
    let stream; let timer; let dead = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        const r = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
        r.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data); };
        r.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (keep.current && chunks.current.length) onDone(new File(chunks.current, `voice-note-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`, { type: 'audio/webm' }));
          else onClose();
        };
        r.start(1000); mr.current = r;
        timer = setInterval(() => setSecs((n) => n + 1), 1000);
      } catch { setErr('The microphone is blocked or missing. Allow it for this site and try again.'); }
    })();
    return () => { dead = true; clearInterval(timer); keep.current = false; try { if (mr.current?.state !== 'inactive') mr.current?.stop(); } catch { /* x */ } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = (save) => { keep.current = save; if (mr.current && mr.current.state !== 'inactive') mr.current.stop(); else onClose(); };
  return createPortal(
    <div className={`pb-pill${err ? ' err' : ''}`} role="status" aria-label="Recording a voice note" data-testid="recorder" style={{ top: Math.min(spot.top, window.innerHeight - 70), left: Math.max(8, Math.min(spot.left, window.innerWidth - 330)) }}>
      <span className="m rec"><Mic size={17} /></span>
      {err ? <b className="msg">{err}</b> : (<><Wave /><b>Recording</b><span className="t">{fmt(secs)}</span><button type="button" className="x" aria-label="Cancel" data-testid="recorder-cancel" onClick={() => stop(false)}><X size={14} /></button></>)}
      <button type="button" className="x" aria-label={err ? 'Close' : 'Save voice note'} data-testid="recorder-done" onClick={() => (err ? onClose() : stop(true))}><Check size={14} /></button>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ upload or link (GIF, video) */
function LinkAsk({ kind, onFiles, onLink, onClose }) {
  const [url, setUrl] = useState('');
  const [spot] = useState(caretSpot);
  const isGif = kind === 'gif';
  return createPortal(
    <div className="pb-ask-media" role="dialog" aria-label={isGif ? 'Add a GIF' : 'Add a video'} data-testid="media-ask" style={{ top: Math.min(spot.top, window.innerHeight - 190), left: Math.max(8, Math.min(spot.left, window.innerWidth - 360)) }} onMouseDown={(e) => { if (!e.target.closest('input')) e.preventDefault(); }}>
      <div className="head"><b>{isGif ? 'Add a GIF' : 'Add a video'}</b><button type="button" aria-label="Close" onClick={onClose}><X size={14} /></button></div>
      <button type="button" className="up" data-testid="media-ask-upload" onClick={async () => { const f = await pickFiles(isGif ? 'image/gif' : 'video/*', true); if (f.length) onFiles(f); else onClose(); }}><Upload size={15} />{isGif ? 'Choose GIF files' : 'Upload video files'}</button>
      <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) onLink(url.trim()); }}>
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={isGif ? 'or paste a link to a GIF' : 'or paste a link to a video'} aria-label="Link" data-testid="media-ask-link" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} />
        <button type="submit" disabled={!url.trim()}>Add</button>
      </form>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ drop veil (M1 C) */
function DropVeil({ rootRef }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let depth = 0;
    const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const count = (e) => {
      const it = [...(e.dataTransfer?.items || [])].filter((x) => x.kind === 'file');
      const n = { pics: 0, gifs: 0, vids: 0, other: 0 };
      for (const x of it) { if (x.type === 'image/gif') n.gifs += 1; else if (/^image\//.test(x.type)) n.pics += 1; else if (/^video\//.test(x.type)) n.vids += 1; else n.other += 1; }
      return { total: it.length || 1, ...n };
    };
    const show = (e) => { const r = root.getBoundingClientRect(); setInfo({ ...count(e), top: Math.max(0, r.top), left: r.left, width: r.width, height: Math.min(r.height, window.innerHeight - Math.max(0, r.top)) }); };
    const enter = (e) => { if (!has(e)) return; depth += 1; show(e); };
    const over = (e) => { if (has(e)) e.preventDefault?.(); };
    const leave = (e) => { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) setInfo(null); };
    const end = () => { depth = 0; setInfo(null); };
    root.addEventListener('dragenter', enter); root.addEventListener('dragleave', leave); root.addEventListener('dragover', over);
    window.addEventListener('drop', end, true); window.addEventListener('dragend', end, true);
    return () => { root.removeEventListener('dragenter', enter); root.removeEventListener('dragleave', leave); root.removeEventListener('dragover', over); window.removeEventListener('drop', end, true); window.removeEventListener('dragend', end, true); };
  }, [rootRef]);
  if (!info) return null;
  const chips = [[info.pics, 'picture'], [info.gifs, 'GIF'], [info.vids, 'video'], [info.other, 'file']].filter(([n]) => n > 0);
  return createPortal(
    <div className="pb-dropveil" data-testid="drop-veil" style={{ top: info.top, left: info.left, width: info.width, height: info.height }}>
      <div className="card">
        <span className="ic"><Upload size={26} /></span>
        <h3>Drop to add {info.total} file{info.total === 1 ? '' : 's'}</h3>
        <div className="chips">{chips.map(([n, w]) => <span key={w} className="chip">{n} {w}{n === 1 ? '' : 's'}</span>)}</div>
        <small>Lands where the line shows. Paste works too.</small>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ everything together */
export default function MediaTools({ editor, rootRef, uploadFile, editable }) {
  const [ask, setAsk] = useState(null); // { kind, refId }
  const [mode, setMode] = useState(null); // { kind: 'dictate' | 'record', refId }
  const [cropId, setCropId] = useState(null);
  const [capId, setCapId] = useState(null);

  const addFiles = useCallback(async (files, refId) => {
    const list = [...files];
    if (!list.length) return;
    const blocks = [];
    let failed = 0;
    for (let i = 0; i < list.length; i += 1) {
      const f = list[i];
      if (list.length > 1) tell('working', `Adding ${i + 1} of ${list.length}…`);
      try {
        const url = await uploadFile(f);
        if (/^image\//.test(f.type)) blocks.push({ type: 'image', props: { url, name: f.name, showPreview: true } });
        else if (/^video\//.test(f.type)) blocks.push({ type: 'video', props: { url, name: f.name, showPreview: true } });
        else if (/^audio\//.test(f.type)) blocks.push({ type: 'audio', props: { url, name: f.name, showPreview: true } });
        else blocks.push({ type: 'file', props: { url, name: f.name } });
      } catch { failed += 1; }
    }
    if (blocks.length) {
      const made = place(editor, blocks, refId);
      try { if (made?.length) editor.setTextCursorPosition(made[made.length - 1], 'end'); } catch { /* x */ }
      if (list.length > 1) tell(failed ? 'error' : 'done', failed ? `${blocks.length} added, ${failed} could not be added` : `${blocks.length} files added`);
    }
  }, [editor, uploadFile]);

  const addLink = useCallback((kind, raw, refId) => {
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (kind === 'gif' || /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url)) place(editor, [{ type: 'image', props: { url, showPreview: true } }], refId);
    else if (VIDEO_URL.test(url)) place(editor, [{ type: 'video', props: { url, name: url.split('/').pop().split(/[?#]/)[0] || 'video', showPreview: true } }], refId);
    else place(editor, [{ type: 'paragraph', content: [{ type: 'link', href: url, content: url }] }], refId);
    setAsk(null);
  }, [editor]);

  useEffect(() => {
    if (!editable) return undefined;
    const on = (e) => {
      const { act, refId } = e.detail || {};
      if (act === 'pictures') pickFiles('image/*', true).then((f) => addFiles(f, refId));
      else if (act === 'gif' || act === 'video') setAsk({ kind: act, refId });
      else if (act === 'voice') setMode({ kind: 'record', refId });
      else if (act === 'dictate') setMode({ kind: 'dictate', refId });
      else if (act === 'crop') setCropId(e.detail.id);
      else if (act === 'caption') setCapId(e.detail.id);
    };
    window.addEventListener('pb-media', on);
    return () => window.removeEventListener('pb-media', on);
  }, [editable, addFiles]);

  if (!editable) return null;
  return (
    <>
      <GroupBar editor={editor} rootRef={rootRef} onCrop={setCropId} />
      <DropVeil rootRef={rootRef} />
      {capId && <CaptionPop editor={editor} rootRef={rootRef} id={capId} onClose={() => setCapId(null)} />}
      {cropId && <CropOverlay editor={editor} rootRef={rootRef} id={cropId} uploadFile={uploadFile} onClose={() => setCropId(null)} />}
      {ask && <LinkAsk kind={ask.kind} onClose={() => setAsk(null)} onFiles={(f) => { const r = ask.refId; setAsk(null); addFiles(f, r); }} onLink={(u) => addLink(ask.kind, u, ask.refId)} />}
      {mode?.kind === 'dictate' && <Dictation editor={editor} onClose={() => setMode(null)} />}
      {mode?.kind === 'record' && <Recorder onClose={() => setMode(null)} onDone={(file) => { const r = mode.refId; setMode(null); addFiles([file], r); }} />}
    </>
  );
}
