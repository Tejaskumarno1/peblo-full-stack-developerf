import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Clock, Eye, Mail, Pencil, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { workspacesAPI } from '../api';
import { Backdrop } from './spaces';
import './spaces.css';

const TONES = ['peach', 'sky', 'butter'];
const when = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** An Office is an announcement feed: the publisher (a lead) writes, everyone reads, members can suggest (mockups B01 to B03). */
export default function OfficeFeed({ space }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['announcements', space.id], queryFn: () => workspacesAPI.announcements(space.id).then((r) => r.data) });
  const [editing, setEditing] = useState(null); // null | {} (new) | post
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const publisher = !!data?.publisher;
  const canSuggest = !!data?.canSuggest;
  const posts = (data?.posts || []).filter((p) => p.status === 'published');
  const suggestions = (data?.posts || []).filter((p) => p.status === 'suggested');
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements', space.id] });
  const run = async (fn) => { setErr(''); try { await fn(); refresh(); } catch (e) { setErr(e.response?.data?.error || 'That did not work. Nothing was changed.'); } };

  const openNew = () => { setTitle(''); setBody(''); setErr(''); setEditing({}); };
  const openEdit = (p) => { setTitle(p.title); setBody(p.body); setErr(''); setEditing(p); };
  const save = async (e) => {
    e.preventDefault();
    if (title.trim().length < 2 || busy) return;
    setBusy(true); setErr('');
    try {
      if (editing.id) await workspacesAPI.editAnnouncement(space.id, editing.id, { title, body });
      else await workspacesAPI.postAnnouncement(space.id, { title, body });
      setEditing(null); refresh();
    } catch (x) { setErr(x.response?.data?.error || 'Could not save. Try again.'); }
    setBusy(false);
  };

  return (
    <div className="soft-page s-office" data-testid="office-feed">
      <div className="s-office-card">
        <div className="s-office-head">
          <Link to="/notes" className="s-soft-btn" data-testid="office-back"><ArrowLeft size={14} /> Back to notes</Link>
          <h1>{space.name}</h1>
          <span className="s-chip-tag"><Building2 size={13} /> Announcements</span>
          <span className="grow" />
          {publisher && <button type="button" className="s-share-go" data-testid="office-write" onClick={openNew}><Pencil size={14} /> Write an announcement</button>}
          {!publisher && canSuggest && <button type="button" className="s-soft-btn" data-testid="office-suggest" onClick={openNew}><Mail size={14} /> Suggest a post</button>}
        </div>
        {!publisher && <div className="s-office-note"><Eye size={16} /> Read only for you. Suggestions go to the publisher for review.</div>}
        {err && <p className="s-space-err" role="alert">{err}</p>}
        {!isLoading && posts.length === 0 && (
          <div className="s-office-empty" data-testid="office-empty">
            <b>Nothing posted yet</b>
            <p>Announcements from the head of office appear here.</p>
            {publisher ? <button type="button" className="s-share-go" onClick={openNew}><Pencil size={14} /> Write the first announcement</button> : <small>Only the publisher can post. You can suggest one.</small>}
          </div>
        )}
        <div className="s-office-list">
          {posts.map((p, i) => (
            <article key={p.id} className={`s-post${p.retractedAt ? ' retracted' : ''}`} style={{ background: `var(--s-${TONES[i % 3]})` }} data-testid="office-post">
              <header><b>{p.title}</b>{p.retractedAt && <span className="s-chip-tag">Retracted</span>}<span className="s-chip-tag"><Clock size={12} /> Version {p.version}</span></header>
              <p>{p.body}</p>
              <footer><small>{p.authorName} - {when(p.createdAt)}</small><span className="grow" />
                {publisher && !p.retractedAt && <><button type="button" className="s-soft-btn" onClick={() => openEdit(p)}>Edit</button><button type="button" className="s-soft-btn" data-testid="office-retract" onClick={() => run(() => workspacesAPI.retractAnnouncement(space.id, p.id))}>Retract</button></>}
              </footer>
            </article>
          ))}
        </div>
        {publisher && suggestions.length > 0 && (
          <div className="s-office-list" data-testid="office-suggestions">
            <small className="s-set-sub">Suggested by members</small>
            {suggestions.map((p) => (
              <article key={p.id} className="s-post suggested">
                <header><b>{p.title}</b></header><p>{p.body}</p>
                <footer><small>{p.authorName}</small><span className="grow" />
                  <button type="button" className="s-share-go" onClick={() => run(() => workspacesAPI.approveAnnouncement(space.id, p.id))}>Publish</button>
                  <button type="button" className="s-soft-btn" onClick={() => run(() => workspacesAPI.declineAnnouncement(space.id, p.id))}>Decline</button>
                </footer>
              </article>
            ))}
          </div>
        )}
        {publisher && <div className="s-office-note"><Clock size={16} /> Edits keep every earlier version. Retracted posts stay visible as retracted.</div>}
      </div>
      {editing && (
        <Backdrop onClose={() => setEditing(null)} label="Announcement">
          <div className="s-share-head"><div><b>{editing.id ? 'Edit announcement' : publisher ? 'Write an announcement' : 'Suggest a post'}</b><small>{publisher ? 'Everyone in this office gets it' : 'The publisher reviews it before it appears'}</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={() => setEditing(null)}><X size={16} strokeWidth={2.4} /></button></div>
          <form onSubmit={save} className="s-space-form">
            <label>Title<input autoFocus aria-label="Title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} data-testid="office-title" /></label>
            <label>Message<textarea aria-label="Message" rows={5} value={body} maxLength={8000} onChange={(e) => setBody(e.target.value)} data-testid="office-body" /></label>
            {err && <p className="s-space-err" role="alert">{err}</p>}
            <div className="s-space-btns"><button type="submit" className="s-share-go" data-testid="office-save" disabled={busy || title.trim().length < 2}>{editing.id ? 'Save as a new version' : publisher ? 'Post' : 'Send suggestion'}</button><button type="button" className="s-space-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
          </form>
        </Backdrop>
      )}
    </div>
  );
}
