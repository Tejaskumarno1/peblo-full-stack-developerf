import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../api/client';
import './sharelist.css';

const PERMS = [['view', 'Can view'], ['tick', 'Can tick and comment'], ['add', 'Can add tasks (you approve)'], ['edit', 'Can edit']];
const ENDS = [['never', 'Never', null], ['7', 'In 7 days', 7], ['30', 'In 30 days', 30]];
const origin = () => window.location.origin;

/** Share a task list: what people with the link can do, when it ends, and a plain-text version for AI. */
export default function ShareList({ list, open, onClose }) {
  const [info, setInfo] = useState(null); // the share, or null when the list is not shared
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState([]);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState('');

  const load = async () => {
    try {
      const r = await api.get('/task-lists/shares');
      setInfo((r.data.shares || []).find((s) => s.list === list.name) || null);
    } catch { setMsg('Could not load the link.'); }
    setLoaded(true);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (info?.comments) api.get('/task-lists/comments', { params: { list: list.name } }).then((r) => setComments(r.data.comments || [])).catch(() => {}); }, [info?.comments, list.name]);

  const save = async (patch) => {
    setMsg('');
    try { const r = await api.post('/task-lists/share', { list: list.name, ...patch }); setInfo(r.data); } catch (e) { setMsg(e?.response?.data?.error || 'Could not save that.'); }
  };
  const stop = async () => {
    try { await api.delete('/task-lists/share', { params: { list: list.name } }); setInfo(null); setComments([]); } catch { setMsg('Could not stop sharing.'); }
  };
  const copy = async (what, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1600); } catch { setMsg('Could not copy. Select the text and copy it yourself.'); }
  };

  const url = info ? `${origin()}/s/list/${info.token}` : '';
  const prompt = info ? `Open this Peblo task list and work with it: ${url}.md\nIt holds the tasks, dates and steps of "${list.name}".${info.perm === 'add' || info.perm === 'edit' ? `\nYou may propose a task by sending JSON {"text": "..."} in a POST to ${origin()}/api/public/list/${info.token}/tasks. The owner approves it before it joins the list.` : '\nThe link is read only.'}\nAccess ends with the link.` : '';
  const endsKey = !info?.expiresAt ? 'never' : (Math.round((new Date(info.expiresAt) - Date.now()) / 86400000) > 14 ? '30' : '7');
  const guests = info?.guests || [];

  return (
    <div className="sl-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="sl-dlg" role="dialog" aria-label={`Share the list ${list.name}`}>
        <div className="sl-head">
          <div><h2>Share the list {list.name}</h2><small>{open} open task{open === 1 ? '' : 's'}</small></div>
          {info && <span className="sl-live">Link active</span>}
          <button type="button" className="sl-x" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>
        {!loaded && <p className="sl-note">Loading...</p>}
        {loaded && !info && (
          <>
            <p className="sl-note">Nobody can see this list yet. Turn the link on to share it. You choose what people with it may do.</p>
            <button type="button" className="sl-go" onClick={() => save({ perm: 'view' })}>Turn the link on</button>
          </>
        )}
        {info && (
          <>
            <div>
              <div className="sl-lab">What people with the link can do</div>
              <div className="sl-seg" role="radiogroup" aria-label="What people with the link can do">
                {PERMS.map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={info.perm === k} className={info.perm === k ? 'on' : ''} onClick={() => save({ perm: k })}>{n}</button>)}
              </div>
            </div>
            <div className="sl-row">
              <span className="sl-lab inline">Link ends</span>
              <div className="sl-seg" role="radiogroup" aria-label="Link ends">
                {ENDS.map(([k, n, d]) => <button key={k} type="button" role="radio" aria-checked={endsKey === k} className={endsKey === k ? 'on' : ''} onClick={() => save({ expiresInDays: d })}>{n}</button>)}
              </div>
              <span className="grow" />
              <label className="sl-chip"><input type="checkbox" checked={info.showProgress} onChange={(e) => save({ showProgress: e.target.checked })} /> Show progress bar on the public page</label>
            </div>
            <div className="sl-row"><input readOnly aria-label="List link" value={url} onFocus={(e) => e.target.select()} /><button type="button" className="sl-go" onClick={() => copy('link', url)}>{copied === 'link' ? 'Copied' : 'Copy'}</button></div>
            <div className="sl-ai">
              <div className="sl-lab">Share with AI</div>
              <div className="sl-row"><input readOnly aria-label="Text version link" value={`${url}.md`} onFocus={(e) => e.target.select()} /><button type="button" className="sl-g" onClick={() => copy('md', `${url}.md`)}>{copied === 'md' ? 'Copied' : 'Text'}</button></div>
              <div className="sl-row"><input readOnly aria-label="PDF version link" value={`${url}.pdf`} onFocus={(e) => e.target.select()} /><button type="button" className="sl-g" onClick={() => copy('pdf', `${url}.pdf`)}>{copied === 'pdf' ? 'Copied' : 'PDF'}</button></div>
              <label className="sl-chip"><input type="checkbox" checked={!!info.mcp} onChange={(e) => save({ mcp: e.target.checked })} /> Let AI agents connect to this list over MCP</label>
              {info.mcp && <div className="sl-row"><input readOnly aria-label="MCP address" value={`${origin()}/mcp/list/${info.token}`} onFocus={(e) => e.target.select()} /><button type="button" className="sl-g" onClick={() => copy('mcp', `${origin()}/mcp/list/${info.token}`)}>{copied === 'mcp' ? 'Copied' : 'MCP'}</button></div>}
              <button type="button" className="sl-go wide" onClick={() => copy('prompt', prompt)}>{copied === 'prompt' ? 'Copied' : 'Copy as AI prompt'}</button>
              <p className="sl-note">Agents see the tasks, dates and steps. Tasks an agent proposes go to your Approval inbox. Access ends with the link.</p>
            </div>
            <div className="sl-row between">
              <button type="button" className="sl-stop" onClick={stop}>Stop sharing</button>
              <span className="sl-guests" data-testid="list-guests">{guests.length === 0 ? 'No guests yet' : `Guests: ${guests.slice(0, 2).map((g) => `${g.name}${g.act ? ` (${g.act})` : ''}`).join(' · ')}${guests.length > 2 ? ` · ${guests.length - 2} more` : ''}`}</span>
            </div>
            {comments.length > 0 && (
              <div className="sl-comments" data-testid="list-comments">
                <div className="sl-lab">Comments</div>
                {comments.slice(0, 5).map((c, i) => <p key={i}><b>{c.author}</b> on {c.task}: {c.body}</p>)}
              </div>
            )}
          </>
        )}
        {msg && <p className="sl-msg" role="alert">{msg}</p>}
      </div>
    </div>
  );
}
