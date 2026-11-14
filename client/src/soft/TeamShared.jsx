import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, FolderOpen, ListChecks, Search, Share2, X } from 'lucide-react';
import api from '../api/client';
import { workspacesAPI } from '../api';
import { useCurrentSpace, useSwitchSpace, useWorkspaces, Backdrop } from './spaces';
import ShareToTeam, { useShareTargets } from './ShareToTeam';
import './teamshare.css';

const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const TONES = ['sky', 'mint', 'peach', 'lilac', 'butter'];
const toneFor = (id) => TONES[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
const ago = (d) => { const s = (Date.now() - new Date(d).getTime()) / 1000; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function Avatar({ id, name, src, size = 40 }) {
  if (src) return <i className="ts-av" style={{ width: size, height: size, overflow: "hidden", background: "transparent" }}><img src={src} alt="" draggable="false" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", display: "block" }} /></i>;
  return <i className="ts-av" style={{ width: size, height: size, fontSize: size * 0.38, background: `var(--s-${toneFor(id)})` }} aria-hidden="true">{initials(name)}</i>;
}

/** Pick one of your Personal notes to share (used from the empty state and the folder header). */
function PickNote({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const { data = [] } = useQuery({ queryKey: ['shared-pick'], queryFn: () => api.get('/notes', { params: { limit: 100 }, headers: { 'x-peblo-space': 'personal' } }).then((r) => r.data.notes || []) });
  const shown = data.filter((n) => (n.title || 'Untitled').toLowerCase().includes(q.toLowerCase()) && !n.meta?.teamShare);
  return (
    <Backdrop onClose={onClose} label="Choose a note to share">
      <div className="s-share-head"><div><b>Choose a note to share</b><small>From your Personal notes</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <label className="ts-search"><Search size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a note" aria-label="Find a note" /></label>
      <div className="s-move-list ts-pick" data-testid="ts-pick">
        {shown.length === 0 && <p className="s-share-msg">No notes found.</p>}
        {shown.slice(0, 40).map((n) => <button key={n.id} type="button" className="s-space-row" onClick={() => onPick(n)}><span><b>{n.title || 'Untitled'}</b><small>{ago(n.updatedAt)}</small></span></button>)}
      </div>
    </Backdrop>
  );
}

function useTeamHere() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  const teams = (data?.orgs || []).flatMap((o) => o.spaces.filter((s) => s.kind !== 'office').map((s) => ({ ...s, org: o.name })));
  return { team: teams.find((s) => s.id === current) || null, teams, loaded: !!data };
}

/** "Shared by members" (mockups T03, T04, T07): one folder per teammate who shared a note, with a profile card and the progress of their to-do lists. */
export default function TeamShared() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const who = sp.get('m');
  const { team, teams, loaded } = useTeamHere();
  const switchTo = useSwitchSpace();
  const targets = useShareTargets();
  const [filter, setFilter] = useState('all');
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState(null);
  const [toast, setToast] = useState('');

  const folders = useQuery({ queryKey: ['shared-folders', team?.id], enabled: !!team && !who, queryFn: () => workspacesAPI.sharedFolders(team.id).then((r) => r.data) });
  const folder = useQuery({ queryKey: ['shared-folders', team?.id, who], enabled: !!team && !!who, queryFn: () => workspacesAPI.sharedFolder(team.id, who).then((r) => r.data) });

  const flash = (t) => { setToast(t); setTimeout(() => setToast(''), 4000); };
  const shareBtn = targets.length > 0 && <button type="button" className="ts-primary" data-testid="ts-share-open" onClick={() => setPicking(true)}><Share2 size={14} /> Share a note</button>;
  const dialogs = (
    <>
      {picking && <PickNote onClose={() => setPicking(false)} onPick={(n) => { setPicking(false); setSharing(n); }} />}
      {sharing && <ShareToTeam noteId={sharing.id} title={sharing.title} onClose={() => setSharing(null)} onDone={({ team: t, tasks }) => { flash(`Shared with ${t.name}${tasks ? ` with ${plural(tasks, 'task')}` : ''}`); if (t.id !== team?.id) switchTo(t.id); }} />}
      {toast && <div className="s-toast ts-toast" role="status"><Check size={14} /> {toast}</div>}
    </>
  );

  if (loaded && !team) {
    return (
      <div className="ts-page"><div className="ts-empty" data-testid="ts-no-team">
        <FolderOpen size={30} /><h2>Pick a team first</h2><p>Shared notes live inside a team. Choose one to see what its members shared.</p>
        <div className="ts-teams">{teams.map((t) => <button key={t.id} type="button" className="s-space-row" onClick={() => switchTo(t.id)}><span><b>{t.name}</b><small>{plural(t.members, 'member')}</small></span></button>)}</div>
        {teams.length === 0 && <p className="s-share-msg">You are not in a team yet.</p>}
      </div></div>
    );
  }
  if (!team) return <div className="ts-page" />;

  // ---- one member's folder (T04)
  if (who) {
    const d = folder.data;
    const rows = (d?.notes || []).filter((n) => filter === 'all' || (filter === 'open' && n.todoTotal > 0 && !n.done) || (filter === 'done' && n.done) || (filter === 'none' && n.todoTotal === 0));
    const counts = { all: d?.notes.length || 0, open: (d?.notes || []).filter((n) => n.todoTotal > 0 && !n.done).length, done: (d?.notes || []).filter((n) => n.done).length, none: (d?.notes || []).filter((n) => n.todoTotal === 0).length };
    return (
      <div className="ts-page" data-testid="ts-member">
        <button type="button" className="ts-back" onClick={() => setSp({})}><ArrowLeft size={14} /> Shared by members</button>
        <header className="ts-profile">
          <Avatar id={who} name={d?.person?.name} src={d?.person?.avatar} size={56} />
          <div><h1>{d?.person?.name || '...'}</h1><p>{d?.person?.role === 'lead' ? 'Team lead' : 'Member'} of {team.name}. Shared {plural(counts.all, 'note')}, {plural(counts.done, 'finished to-do list')}.</p></div>
        </header>
        <div className="ts-chips" role="tablist">
          {[['all', 'All'], ['open', 'Open'], ['done', 'Done'], ['none', 'Without a to-do list']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l} <small>{counts[k]}</small></button>)}
        </div>
        <ul className="ts-rows">
          {rows.length === 0 && <li className="ts-none">Nothing here.</li>}
          {rows.map((n) => (
            <li key={n.id}><button type="button" className="ts-row" data-testid="ts-note" onClick={() => navigate(`/notes/${n.id}`)}>
              <span className="ts-row-main"><b>{n.title || 'Untitled'}</b><small>{n.preview || 'No text yet'}</small></span>
              <span className="ts-row-meta">
                {n.done ? <em className="ts-tag done"><Check size={11} /> Done</em> : n.todoTotal > 0 ? <em className="ts-tag todo"><ListChecks size={11} /> To-do {n.todoDone} of {n.todoTotal}</em> : null}
                {n.todoTotal > 0 && <span className="ts-bar"><i style={{ width: `${(n.todoDone / n.todoTotal) * 100}%` }} /></span>}
                <small>{n.level === 'view' ? 'Can view' : 'Can edit'} · {ago(n.createdAt)}</small>
              </span>
            </button></li>
          ))}
        </ul>
        {dialogs}
      </div>
    );
  }

  // ---- all folders (T03) or the empty state (T07)
  const d = folders.data;
  const members = (d?.members || []).filter((m) => filter === 'all' || (filter === 'todo' && m.withTodos > 0) || (filter === 'done' && m.done > 0));
  if (d && d.total === 0) {
    return (
      <div className="ts-page"><div className="ts-empty" data-testid="ts-empty">
        <FolderOpen size={32} /><h2>Nobody has shared a note yet</h2>
        <p>Notes your teammates share with {team.name} gather here, in a folder for each person.</p>
        <ol className="ts-steps"><li>Open one of your notes</li><li>Choose <b>Share with team</b> from its menu</li><li>Add a to-do list if you want help finishing it</li></ol>
        {shareBtn}
        {dialogs}
      </div></div>
    );
  }
  return (
    <div className="ts-page" data-testid="ts-folders">
      <div className="ts-top"><div><h1>Shared by members</h1><p>{team.name}{d ? `. ${plural(d.total, 'note')} from ${plural(d.members.length, 'person')}.` : ''}</p></div>{shareBtn}</div>
      <div className="ts-chips" role="tablist">
        {[['all', 'Everyone'], ['todo', 'With a to-do list'], ['done', 'Done']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <div className="ts-grid">
        {members.map((m) => (
          <button key={m.userId} type="button" className="ts-card" data-testid="ts-folder" onClick={() => setSp({ m: m.userId })}>
            <Avatar id={m.userId} name={m.name} src={m.avatar} />
            <b>{m.name}{m.userId === d.me ? ' (you)' : ''}</b>
            <span className="ts-card-chips"><em>{plural(m.notes, 'note')}</em>{m.withTodos > 0 && <em>{plural(m.withTodos, 'to-do list')}</em>}{m.done > 0 && <em className="done">{m.done} Done</em>}</span>
            <small>{(m.titles || []).join(' · ')}</small>
          </button>
        ))}
        {d && members.length === 0 && <p className="ts-none">No one matches that filter.</p>}
      </div>
      {dialogs}
    </div>
  );
}
