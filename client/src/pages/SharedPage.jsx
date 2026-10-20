import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// The page a share link opens. No sign-in; read only.
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
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/public/${kind === 'task' || kind === 'todo' ? 'todo' : 'note'}/${encodeURIComponent(token)}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'This link is not shared any more.'); return j; })
      .then((j) => { if (live) setData(j); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [kind, token]);

  const body = useMemo(() => (data?.kind === 'note' ? toHtml(data.content) : data?.note ? toHtml(data.note.content) : ''), [data]);

  return (
    <div className="pb-shared">
      <style>{`
        .pb-shared{min-height:100vh;background:#fffdf8;color:#2a1f17;font-family:'Figtree',system-ui,sans-serif;padding:32px 20px 80px}
        .pb-shared main{max-width:760px;margin:0 auto}
        .pb-shared .brand{display:flex;align-items:center;gap:10px;font-weight:800;margin-bottom:28px}
        .pb-shared .brand i{width:26px;height:26px;border-radius:50%;background:#c8421d;display:inline-block}
        .pb-shared h1{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:clamp(28px,5vw,44px);line-height:1.1;margin:0 0 8px}
        .pb-shared .by{color:#6b5b4e;font-size:14px;margin:0 0 24px}
        .pb-shared .chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
        .pb-shared .chip{background:#f4ede2;border-radius:999px;padding:6px 14px;font-weight:700;font-size:13px}
        .pb-shared .chip.high{background:#ffd8c4}.pb-shared .chip.done{background:#cdebdc}
        .pb-shared .doc{font-size:17px;line-height:1.7;overflow-wrap:anywhere}
        .pb-shared .doc img,.pb-shared .doc video{max-width:100%;border-radius:16px}
        .pb-shared .doc table{border-collapse:collapse}.pb-shared .doc td,.pb-shared .doc th{border:1.5px solid #eadfce;padding:8px 12px}
        .pb-shared .doc pre{background:#f9f3e9;border-radius:14px;padding:14px;overflow:auto}
        .pb-shared .note-h{margin:36px 0 8px;font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b5b4e}
        .pb-shared .err{background:#f9f3e9;border-radius:20px;padding:24px;font-weight:600}
        .pb-shared footer{margin-top:48px;color:#6b5b4e;font-size:13px}
      `}</style>
      <main>
        <div className="brand"><i /> Peblo</div>
        {error && <p className="err" role="alert">{error}</p>}
        {!data && !error && <p>Loading…</p>}
        {data?.kind === 'note' && (
          <>
            <h1>{data.title || 'Untitled'}</h1>
            <p className="by">{data.author ? `Shared by ${data.author} · ` : ''}Updated {when(data.updatedAt)}</p>
            <div className="doc" dangerouslySetInnerHTML={{ __html: body }} />
          </>
        )}
        {data?.kind === 'todo' && (
          <>
            <h1>{data.text}</h1>
            <p className="by">{data.author ? `Shared by ${data.author}` : 'Shared task'}</p>
            <div className="chips">
              <span className={`chip${data.completed ? ' done' : ''}`}>{data.completed ? 'Done' : 'To do'}</span>
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
        <footer>Read only. Made with Peblo.</footer>
      </main>
    </div>
  );
}
