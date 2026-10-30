import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload, FolderOpen, X, Check, RotateCw, Download, FileWarning, Lock } from 'lucide-react';
import { KINDS, MAX_FILE, acceptOf, bytesOf, canShow, checkFile, describe, extOf, kindOf, recentFiles, rememberFile, sizeText, uploadDoc, FileProblem } from '../utils/docFiles';
import { TypeIcon } from './DocFile';

// Adding files to a note: the Add a file dialog, drag and drop with a drop overlay, and the upload card (mockups F1 b, F1 c, F5 b).

const isEmptyPara = (b) => b.type === 'paragraph' && !(Array.isArray(b.content) ? b.content.some((c) => c.type === 'link' || (c.text || '').trim()) : String(b.content || '').trim());

function place(editor, blocks, refId, before) {
  let ref;
  try { ref = (refId && editor.getBlock(refId)) || editor.getTextCursorPosition().block; } catch { ref = editor.document[editor.document.length - 1]; }
  const made = editor.insertBlocks(blocks, ref, before ? 'before' : 'after');
  if (isEmptyPara(ref)) editor.removeBlocks([ref]);
  return made;
}

const isMedia = (f) => /^(image|video|audio)\//.test(f.type);

function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple; inp.style.display = 'none';
    inp.setAttribute('data-testid', 'df-file-input');
    document.body.appendChild(inp);
    inp.addEventListener('change', () => { const f = [...inp.files]; inp.remove(); resolve(f); });
    inp.addEventListener('cancel', () => { inp.remove(); resolve([]); });
    inp.click();
  });
}

export default function FileTools({ editor, rootRef, editable }) {
  const [dlg, setDlg] = useState(null); // { kind, replace }
  const [jobs, setJobs] = useState([]); // uploads in flight or just finished
  const [over, setOver] = useState(null); // files being dragged over the note
  const ctl = useRef(new Map());
  const jobId = useRef(0);

  useEffect(() => { const m = ctl.current; return () => { m.forEach((a) => a.abort()); }; }, []); // leaving the note stops uploads still in flight

  const patch = (id, p) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const drop = (id) => setJobs((j) => j.filter((x) => x.id !== id));

  /** Upload one file, then put it in the note (or swap it into an existing block). */
  const add = useCallback(async (file, opt = {}) => {
    const id = ++jobId.current;
    const bad = checkFile(file);
    const job = { id, name: file.name, size: file.size, kind: kindOf(file.name), step: bad ? 'error' : 'up', pct: 0, error: bad, file, opt };
    setJobs((j) => [...j, job]);
    if (bad) return null;
    const ac = new AbortController(); ctl.current.set(id, ac);
    try {
      const done = await uploadDoc(file, { onProgress: (pct) => patch(id, { pct }), signal: ac.signal });
      patch(id, { step: 'prev', pct: 1 });
      let meta = '';
      try { const buf = await file.arrayBuffer(); meta = await describe(buf, file.name); } catch { /* the frame will say what is wrong */ }
      const props = { url: done.url, name: done.name || file.name, size: done.size, meta, frame: 'medium', download: true, pages: 'all', caption: '' };
      if (opt.replace) {
        const b = editor.getBlock(opt.replace);
        if (b) editor.updateBlock(b, { props: { url: props.url, name: props.name, size: props.size, meta, pages: 'all' } });
      } else {
        place(editor, [{ type: 'docfile', props }], opt.refId, opt.before);
      }
      rememberFile({ url: done.url, name: props.name, size: props.size, meta, at: Date.now(), note: document.title.replace(/\s*[-|·].*$/, '') });
      patch(id, { step: 'ready' });
      setTimeout(() => drop(id), 2600);
      return props;
    } catch (e) {
      if (e?.code === 'cancel') drop(id); else patch(id, { step: 'error', error: e instanceof FileProblem ? e : new FileProblem('net', 'The file could not be added.') });
      return null;
    } finally { ctl.current.delete(id); }
  }, [editor]);

  const addMany = useCallback(async (files, opt) => {
    let ref = opt?.refId; let before = opt?.before;
    for (const f of files) {
      const r = await add(f, { ...opt, refId: ref, before });
      if (r) { ref = undefined; before = false; try { ref = editor.getTextCursorPosition().block.id; } catch { /* end */ } }
    }
  }, [add, editor]);

  // the slash menu and the block menu ask for the dialog / the picker
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (!editable) return;
      if (d.act === 'add') setDlg({ kind: d.kind || '' });
      if (d.act === 'replace') pickFiles('', false).then((f) => { if (f[0]) add(f[0], { replace: d.id }); });
    };
    window.addEventListener('pb-docfile', on);
    return () => window.removeEventListener('pb-docfile', on);
  }, [add, editable]);

  // drag and drop of files that are not pictures or video (those are the picture tools' own)
  useEffect(() => {
    const root = rootRef?.current; if (!root || !editable) return undefined;
    let depth = 0;
    const carries = (e) => [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file') && ![...(e.dataTransfer?.items || [])].every((i) => i.kind === 'file' && /^(image|video|audio)\//.test(i.type));
    const enter = (e) => { if (!carries(e)) return; depth += 1; setOver({ n: e.dataTransfer.items.length }); };
    const overE = (e) => { if (carries(e)) e.preventDefault(); };
    const leave = (e) => { if (!carries(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(null); };
    const dropE = (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      depth = 0; setOver(null);
      const docs = files.filter((f) => !isMedia(f));
      if (!docs.length) return;
      e.preventDefault(); e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-id]');
      const r = el?.getBoundingClientRect?.();
      addMany(docs, { refId: el?.getAttribute('data-id') || undefined, before: !!(r && e.clientY < r.top + r.height / 2) });
    };
    root.addEventListener('dragenter', enter, true); root.addEventListener('dragover', overE, true); root.addEventListener('dragleave', leave, true); root.addEventListener('drop', dropE, true);
    return () => { root.removeEventListener('dragenter', enter, true); root.removeEventListener('dragover', overE, true); root.removeEventListener('dragleave', leave, true); root.removeEventListener('drop', dropE, true); };
  }, [rootRef, editable, addMany]);

  const choose = async (kind) => { const f = await pickFiles(acceptOf(kind)); if (f.length) { setDlg(null); addMany(f); } };

  return (
    <>
      {dlg && <AddDialog kind={dlg.kind} onClose={() => setDlg(null)} onChoose={() => choose(dlg.kind)} onFiles={(f) => { setDlg(null); addMany(f); }} onAgain={(r) => { setDlg(null); window.dispatchEvent(new CustomEvent('pb-docfile', { detail: { act: 'use', file: r } })); useAgain(editor, r); }} />}
      {over && createPortal(<div className="df-drop" data-testid="df-drop"><div><span className="df-ty ppt big"><Upload size={26} /></span><h3>Drop to add to the note</h3><span>{over.n === 1 ? 'The file' : `${over.n} files`} will land where you drop {over.n === 1 ? 'it' : 'them'}</span></div></div>, document.body)}
      {jobs.length > 0 && createPortal(
        <div className="df-jobs" data-testid="df-jobs">
          {jobs.map((j) => <JobCard key={j.id} j={j} onCancel={() => { ctl.current.get(j.id)?.abort(); drop(j.id); }} onRetry={() => { drop(j.id); add(j.file, j.opt); }} onClose={() => drop(j.id)} onCard={() => { drop(j.id); keepAsCard(editor, j); }} />)}
        </div>, document.body)}
    </>
  );
}

function useAgain(editor, r) {
  place(editor, [{ type: 'docfile', props: { url: r.url, name: r.name, size: r.size, meta: r.meta || '', frame: 'medium', download: true, pages: 'all', caption: '' } }]);
}
async function keepAsCard(editor, j) {
  if (!j.file || j.error?.code === 'big') return;
  const done = await uploadDoc(j.file).catch(() => null);
  if (done) place(editor, [{ type: 'docfile', props: { url: done.url, name: done.name, size: done.size, meta: '', frame: 'medium', download: true, pages: 'all', caption: '' } }]);
}

function JobCard({ j, onCancel, onRetry, onClose, onCard }) {
  const err = j.step === 'error';
  const step = (k, label) => {
    const order = ['up', 'prev', 'ready']; const at = order.indexOf(j.step); const me = order.indexOf(k);
    const done = !err && at > me || (j.step === 'ready');
    return <span className={done ? 'ok' : at === me ? 'now' : ''}>{done && <Check size={12} />}{label}</span>;
  };
  if (err) {
    const big = j.error?.code === 'big';
    return (
      <div className="df-job err" data-testid="df-job" role="alert">
        <div className="df-job-h"><TypeIcon kind={j.kind} /><span><b>{j.name}</b><small>{sizeText(j.size)}</small></span><button type="button" aria-label="Dismiss" onClick={onClose}><X size={14} /></button></div>
        <div className={`df-job-msg ${big ? 'peach' : 'red'}`}><FileWarning size={16} />{j.error?.message || 'The file could not be added.'}</div>
        <div className="df-job-act">
          {big ? <button type="button" className="df-btn ac sm" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('pb-docfile', { detail: { act: 'add', kind: '' } })); }}><Upload size={13} />Choose a smaller file</button>
            : <button type="button" className="df-btn ac sm" data-testid="df-job-retry" onClick={onRetry}><RotateCw size={13} />Try again</button>}
          <button type="button" className="df-btn sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="df-job" data-testid="df-job">
      <div className="df-job-h"><TypeIcon kind={j.kind} /><span><b>{j.name}</b><small>{j.step === 'ready' ? 'Added to the note' : 'Adding to the note'}</small></span>{j.step !== 'ready' && <button type="button" aria-label="Cancel" data-testid="df-job-cancel" onClick={onCancel}><X size={14} /></button>}</div>
      <div className="df-bar" role="progressbar" aria-valuenow={Math.round(j.pct * 100)}><i style={{ width: `${Math.round(j.pct * 100)}%` }} /></div>
      <div className="df-steps">{step('up', 'Uploaded')}{step('prev', 'Making preview')}{step('ready', 'Ready')}</div>
      <small className="df-job-n">You can keep typing. The frame fills in by itself.</small>
    </div>
  );
}

/* the "Add a file to this note" window (mockup F1 b) */
function AddDialog({ kind, onClose, onChoose, onFiles, onAgain }) {
  const [hot, setHot] = useState(false);
  const recent = recentFiles();
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div className="df-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="df-modal" role="dialog" aria-modal="true" aria-label="Add a file to this note" data-testid="df-add">
        <div className="df-modal-h"><h3>Add a file to this note</h3><button type="button" className="df-btn ic ghost" aria-label="Close" data-testid="df-add-close" onClick={onClose}><X size={16} /></button></div>
        <div className={`df-dz${hot ? ' hot' : ''}`} data-testid="df-dropzone"
          onDragOver={(e) => { e.preventDefault(); setHot(true); }} onDragLeave={() => setHot(false)}
          onDrop={(e) => { e.preventDefault(); setHot(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); }}>
          <span className="df-ty ppt big"><Upload size={24} /></span>
          <b>Drop a file here</b><span className="or">or</span>
          <button type="button" className="df-btn ac" data-testid="df-choose" onClick={onChoose}><FolderOpen size={15} />Choose from this computer</button>
          <span className="df-types">{['PowerPoint', 'Word', 'Excel', 'PDF', 'Any file'].map((w) => <span key={w} className={`df-tag ${w === (KINDS[kind]?.word) ? 'on' : ''}`}>{w}</span>)}</span>
          <small>Up to 25 MB per file. Several at once is fine.</small>
        </div>
        {recent.length > 0 && (
          <div>
            <div className="df-lbl">Recently used in your notes</div>
            <div className="df-recent">
              {recent.slice(0, 3).map((r) => (
                <div className="df-rec" key={r.url} data-testid="df-recent">
                  <TypeIcon kind={kindOf(r.name)} />
                  <span><b>{r.name}</b><small>{r.note ? `Used in ${r.note} · ` : ''}{sizeText(r.size)}</small></span>
                  <button type="button" className="df-btn sm" onClick={() => onAgain(r)}>Use again</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>, document.body);
}
