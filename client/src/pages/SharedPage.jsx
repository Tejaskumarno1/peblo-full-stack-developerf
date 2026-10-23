import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const BlockEditor = lazy(() => import('../components/BlockEditor'));

// The page a share link opens. No sign-in. "Can view" links are read only; "can edit" links open the editor.
const toHtml = (md) => {
  let html = marked.parse(md || '');
  // media saved inside a note are written as <img src="data:video/..."> so they can survive Markdown: show them properly
  html = html.replace(/<figure>\s*<img src="(data:(video|audio)\/[^"]+)">\s*(?:<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>/g, (_m, src, kind, cap) => `<figure><${kind} controls src="${src}"></${kind}>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`);
  html = html.replace(/<figure>\s*<img src="(data:(?!image\/)[^"]+)">\s*(?:<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>/g, (_m, src, cap) => `<p><a href="${src}" download="${(cap || 'file').replace(/"/g, '')}">${cap || 'Download file'}</a></p>`);
  return DOMPurify.sanitize(html, { ADD_TAGS: ['video', 'audio'], ADD_ATTR: ['controls', 'download'] });
};
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function SharedPage() {
  const { kind, token } = useParams();
  useEffect(() => {
    document.documentElement.classList.add('pb-public-share');
    return () => document.documentElement.classList.remove('pb-public-share');
  }, []);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('saved'); // saved | saving | conflict | error
  const [conflict, setConflict] = useState(null);
  const [rev, setRev] = useState(0); // bumps to remount the editor with a fresh copy
  const draft = useRef({ title: '', content: '', base: null });
  const timer = useRef(null);
  const kindPath = kind === 'task' || kind === 'todo' ? 'todo' : 'note';
  const url = `/api/public/${kindPath}/${encodeURIComponent(token)}`;

  useEffect(() => {
    let live = true;
    fetch(url)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'This link is not shared any more.'); return j; })
      .then((j) => {
        if (!live) return;
        draft.current = { title: j.title || '', content: j.content || '', base: j.updatedAt };
        setConflict(null); setStatus('saved'); setData(j);
      })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [url, rev]);

  const put = useCallback(async (payload) => {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, [url]);

  const saveNote = useCallback(async (force = false) => {
    setStatus('saving');
    try {
      const r = await put({ title: draft.current.title, content: draft.current.content, baseUpdatedAt: draft.current.base, force });
      if (r.status === 409) { setConflict(r.body.latest); setStatus('conflict'); return; }
      if (r.status !== 200) throw new Error(r.body.error || 'Could not save.');
      draft.current.base = r.body.updatedAt; setConflict(null); setStatus('saved');
    } catch { setStatus('error'); }
  }, [put]);
  const queueSave = () => { setStatus('saving'); clearTimeout(timer.current); timer.current = setTimeout(() => saveNote(false), 1200); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const patchTask = async (patch) => {
    const r = await put(patch);
    if (r.status === 200) setData((d) => ({ ...d, ...patch }));
    else setStatus('error');
  };

  const body = useMemo(() => (data?.kind === 'note' ? toHtml(data.content) : data?.note ? toHtml(data.note.content) : ''), [data]);
  const stText = status === 'saving' ? 'Saving…' : status === 'conflict' ? 'Not saved: someone else changed it' : status === 'error' ? 'Could not save' : 'Saved';

  return (
    <div className="pb-shared">
      <style>{`
        .pb-shared{--s-bg:#FBF6EE;--s-surface:#fff;--s-line:#EADFD0;--s-fg:#241F1A;--s-fg2:#564D43;--s-fg3:#6E6559;--s-peach:#FFD9C4;--s-mint:#CDEBD9;--s-butter:#FFE9A6;--s-accent:#C4441C;min-height:100vh;box-sizing:border-box;background:var(--s-bg);color:var(--s-fg);font-family:'Figtree',system-ui,sans-serif;padding:0}
        .theme-dark .pb-shared{--s-bg:#120F17;--s-surface:#1F1A27;--s-line:#2F2839;--s-fg:#F5F0F7;--s-fg2:#CFC6D8;--s-fg3:#A59BB0;--s-peach:#3A261E;--s-mint:#18302A;--s-butter:#332B13;--s-accent:#FF8F6B}
        .theme-midnight .pb-shared{--s-bg:#07050A;--s-surface:#141019;--s-line:#231C2B}
        .pb-shared main{width:100%;min-height:100vh;box-sizing:border-box;margin:0;padding:12px 40px 36px 300px;background:transparent}
        .pb-shared main > :not(.brand){width:100%;max-width:1040px}
        .pb-shared .brand{display:flex;align-items:center;gap:10px;font-family:'Bricolage Grotesque',system-ui,sans-serif;font-weight:800;font-size:24px;letter-spacing:-.03em;margin:0 0 34px;color:var(--s-fg)}
        .pb-shared .brand i{width:34px;height:30px;border-radius:52% 48% 46% 54% / 60% 58% 42% 40%;background:var(--s-accent);display:inline-grid;place-items:center}
        .pb-shared .brand i:after{content:'';width:10px;height:10px;border:2px solid #fff;border-radius:50%}
        .pb-shared h1{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:54px;letter-spacing:-.035em;line-height:1.08;margin:0 0 12px;color:var(--s-fg);overflow-wrap:anywhere}
        .pb-shared .title-in{width:100%;box-sizing:border-box;border:none;background:transparent;font:800 54px/1.08 'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-.035em;color:var(--s-fg);padding:0;margin:0 0 12px;outline:none;overflow-wrap:anywhere}
        .pb-shared .title-in:focus{box-shadow:0 2px var(--s-accent)}
        .pb-shared .by{color:var(--s-fg3);font-size:13px;line-height:1.6;margin:0 0 28px}
        .pb-shared .st{font-weight:700;color:#1e7a46}.pb-shared .st.conflict,.pb-shared .st.error{color:#b3261e}
        .pb-shared .chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
        .pb-shared .chip{background:var(--s-chip-solid,#F4EEE5);border:0;border-radius:999px;padding:7px 13px;font-weight:700;font-size:13px;color:var(--s-fg)}
        .pb-shared button.chip{font-family:inherit;cursor:pointer;color:inherit;transition:filter .15s}.pb-shared button.chip:hover{filter:brightness(.96)}
        .pb-shared .chip.high{background:var(--s-peach)}.pb-shared .chip.done{background:var(--s-mint)}
        .pb-shared .doc{font-size:19px;line-height:1.75;overflow-wrap:anywhere;color:var(--s-fg2)}
        .pb-shared .doc > :first-child{margin-top:0}.pb-shared .doc > :last-child{margin-bottom:0}
        .pb-shared .doc h1,.pb-shared .doc h2,.pb-shared .doc h3{margin:1.5em 0 .55em;font-family:'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-.02em;color:var(--s-fg)}
        .pb-shared .doc h1{font-size:1.55em}.pb-shared .doc h2{font-size:1.3em}.pb-shared .doc h3{font-size:1.12em}
        .pb-shared .doc a{color:var(--s-accent);text-underline-offset:3px}.pb-shared .doc blockquote{margin:1.2em 0;padding:2px 0 2px 18px;border-left:3px solid var(--s-peach);color:var(--s-fg3)}
        .pb-shared .doc li{padding-left:4px}.pb-shared .doc img,.pb-shared .doc video{display:block;max-width:100%;height:auto;margin:20px auto;border-radius:20px}
        .pb-shared .doc figure{margin:22px 0}.pb-shared .doc figcaption{font-size:13px;color:var(--s-fg3);text-align:center;margin-top:8px}
        .pb-shared .doc table{display:block;max-width:100%;overflow-x:auto;border-collapse:separate;border-spacing:0;border-radius:20px;background:var(--s-bg)}.pb-shared .doc td,.pb-shared .doc th{border:0;border-top:1px solid var(--s-line);padding:12px 18px;text-align:left}.pb-shared .doc tr:first-child td,.pb-shared .doc tr:first-child th{border-top:0}
        .pb-shared .doc pre{max-width:100%;box-sizing:border-box;background:var(--s-bg);border-radius:20px;padding:16px;overflow:auto}
        .pb-shared .doc code{font-size:.9em;background:var(--s-bg);border-radius:8px;padding:2px 6px;color:var(--s-fg)}.pb-shared .doc pre code{background:transparent;padding:0}
        .pb-shared .note-h{margin:32px 0 12px;font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--s-fg2)}
        .pb-shared .err{background:var(--s-butter);border:0;border-radius:20px;padding:16px 18px;font-weight:600;line-height:1.55;margin-bottom:20px;color:var(--s-fg)}
        .pb-shared .row{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}
        .pb-shared .row button{border:0;border-radius:999px;padding:9px 15px;font:700 13px 'Figtree',system-ui,sans-serif;background:var(--s-fg);color:var(--s-bg);cursor:pointer}
        .pb-shared .row button:hover{filter:brightness(1.18)}
        .pb-shared footer{border-top:1px solid var(--s-line);margin-top:36px;padding-top:14px;color:var(--s-fg3);font-size:12px}
        .pb-shared .bn-editor{max-width:100%;overflow-wrap:anywhere}
        @media(max-width:1000px){.pb-shared main{padding-left:40px}}
        @media(max-width:600px){.pb-shared main{padding:18px 20px 32px}.pb-shared .brand{margin-bottom:28px}.pb-shared h1,.pb-shared .title-in{font-size:38px}.pb-shared .by{margin-bottom:24px}.pb-shared .doc{font-size:17px}.pb-shared footer{margin-top:30px}}
      `}</style>
      <main>
        <div className="brand"><i /> Peblo</div>
        {error && <p className="err" role="alert">{error}</p>}
        {!data && !error && <p>Loading…</p>}

        {data?.kind === 'note' && data.canEdit && (
          <>
            <input className="title-in" aria-label="Title" key={`t${rev}`} defaultValue={data.title} onChange={(e) => { draft.current.title = e.target.value; queueSave(); }} />
            <p className="by">{data.author ? `Shared by ${data.author} · ` : ''}You can edit this note. <span role="status" className={`st ${status}`}>{stText}</span></p>
            {conflict && (
              <div className="err" role="alert">Someone else changed this note while you were editing.
                <div className="row"><button type="button" onClick={() => setRev((n) => n + 1)}>Load their version</button><button type="button" onClick={() => saveNote(true)}>Keep mine</button></div>
              </div>
            )}
            <Suspense fallback={<p>Loading editor…</p>}>
              <BlockEditor key={`e${rev}`} guest initialContent={data.content} onChange={(md) => { draft.current.content = md; queueSave(); }} />
            </Suspense>
          </>
        )}

        {data?.kind === 'note' && !data.canEdit && (
          <>
            <h1>{data.title || 'Untitled'}</h1>
            <p className="by">{data.author ? `Shared by ${data.author} · ` : ''}Updated {when(data.updatedAt)}</p>
            <div className="doc" dangerouslySetInnerHTML={{ __html: body }} />
          </>
        )}

        {data?.kind === 'todo' && (
          <>
            {data.canEdit
              ? <input className="title-in" aria-label="Task" defaultValue={data.text} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== data.text) patchTask({ text: v }); }} />
              : <h1>{data.text}</h1>}
            <p className="by">{data.author ? `Shared by ${data.author}` : 'Shared task'}{data.canEdit ? ' · You can edit this task.' : ''}</p>
            <div className="chips">
              {data.canEdit
                ? <button type="button" className={`chip${data.completed ? ' done' : ''}`} aria-pressed={data.completed} onClick={() => patchTask({ completed: !data.completed })}>{data.completed ? 'Done (tap to undo)' : 'Mark as done'}</button>
                : <span className={`chip${data.completed ? ' done' : ''}`}>{data.completed ? 'Done' : 'To do'}</span>}
              {data.deadline && <span className="chip">Due {when(data.deadline)}</span>}
              <span className={`chip${data.priority === 'high' ? ' high' : ''}`}>{data.priority} priority</span>
              {data.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
            </div>
            {data.note && (
              <>
                <div className="note-h">Note: {data.note.title || 'Untitled'}</div>
                <div className="doc" dangerouslySetInnerHTML={{ __html: body }} />
              </>
            )}
          </>
        )}
        <footer>{data?.canEdit ? 'Anyone with this link can edit. Made with Peblo.' : 'Read only. Made with Peblo.'}</footer>
      </main>
    </div>
  );
}
