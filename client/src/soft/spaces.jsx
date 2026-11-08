import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus, User, Users, Building2, X } from 'lucide-react';
import { workspacesAPI } from '../api';
import { getSpace, setSpace, SPACE_EVENT } from '../api/space';
import './spaces.css';

/** The person's spaces: Personal always, plus the teams and Office of every organization they belong to. */
export function useWorkspaces() {
  return useQuery({ queryKey: ['workspaces'], queryFn: () => workspacesAPI.list().then((r) => r.data), staleTime: 60000 });
}

/** The people in the space being worked in (empty in Personal): used to assign tasks and to name an assignee. */
export function useSpaceMembers() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  const org = (data?.orgs || []).find((o) => o.spaces.some((s) => s.id === current));
  const { data: m } = useQuery({ queryKey: ['org-members', org?.id], enabled: !!org, staleTime: 60000, queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  if (!org) return { people: [], me: data?.me?.id || null, canAssign: false };
  const people = (m?.members || []).filter((x) => x.status === 'active' && x.spaces.some((s) => s.id === current)).map((x) => ({ id: x.userId, name: x.name }));
  return { people, me: data?.me?.id || null, canAssign: people.length > 0 };
}

/** The name of the space being worked in, or null in Personal. */
export function useSpaceName() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  return (data?.orgs || []).flatMap((o) => o.spaces).find((s) => s.id === current)?.name || null;
}

/** The person's role in the space being worked in: 'lead', 'member', 'viewer', or null in Personal. */
export function useSpaceRole() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  return (data?.orgs || []).flatMap((o) => o.spaces).find((s) => s.id === current)?.role || null;
}

export function useCurrentSpace() {
  const [id, setId] = useState(getSpace);
  useEffect(() => {
    const on = () => setId(getSpace());
    window.addEventListener(SPACE_EVENT, on);
    return () => window.removeEventListener(SPACE_EVENT, on);
  }, []);
  return id;
}

export const iconOf = (kind) => (kind === 'office' ? Building2 : kind === 'team' ? Users : User);
export const toneOf = (kind) => (kind === 'office' ? 'peach' : kind === 'team' ? 'sky' : 'chip');

/** Switch space: forget what was loaded for the old one, then show the notes of the new one. */
export function useSwitchSpace() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback((id) => {
    if ((getSpace() || null) === (id || null)) return;
    setSpace(id);
    qc.resetQueries(); // forget what was loaded for the old space and load the new one
    // stay on the same page; an open note belongs to the old space, so go to the list
    if (/^\/notes\/./.test(pathname) || pathname === '/') navigate('/notes');
  }, [qc, navigate, pathname]);
}

/** The space pill in the header (mockup A01/A03). Shown only to people who belong to an organization, so Personal-only people lose no room. */
export function SpacePill() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  const switchTo = useSwitchSpace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const orgs = data?.orgs || [];
  if (!orgs.length) return null;
  const spaces = orgs.flatMap((o) => o.spaces.map((s) => ({ ...s, org: o })));
  const here = spaces.find((s) => s.id === current);
  // a space that was closed or that the person left: fall back to Personal
  const kind = here ? here.kind : 'personal';
  const Icon = iconOf(kind);
  const teams = spaces.filter((s) => s.kind === 'team');
  const offices = spaces.filter((s) => s.kind === 'office');
  const row = (s) => {
    const R = iconOf(s.kind);
    return (
      <button key={s.id} type="button" role="menuitemradio" aria-checked={here?.id === s.id} className={`s-space-row${here?.id === s.id ? ' on' : ''}`} onClick={() => { setOpen(false); switchTo(s.id); }}>
        <i style={{ background: `var(--s-${toneOf(s.kind)})` }}><R size={16} /></i>
        <span><b>{s.name}</b><small>{s.kind === 'office' ? 'Announcements' : `${s.members} member${s.members === 1 ? '' : 's'}${s.role === 'viewer' ? ', viewer' : ''}`}</small></span>
        {here?.id === s.id && <Check size={15} />}
      </button>
    );
  };

  return (
    <div className="s-space" ref={ref}>
      <button type="button" className="s-space-pill" style={{ background: `var(--s-${toneOf(kind)})` }} aria-haspopup="menu" aria-expanded={open} data-testid="space-pill" onClick={() => setOpen((v) => !v)}>
        <Icon size={16} /><span>{here ? here.name : 'Personal'}</span><ChevronDown size={13} />
      </button>
      {open && (
        <div className="s-space-menu" role="menu" aria-label="Spaces" data-testid="space-menu">
          <button type="button" role="menuitemradio" aria-checked={!here} className={`s-space-row${!here ? ' on' : ''}`} onClick={() => { setOpen(false); switchTo(null); }}>
            <i style={{ background: 'var(--s-chip)' }}><User size={16} /></i><span><b>Personal</b><small>Only you</small></span>{!here && <Check size={15} />}
          </button>
          {teams.length > 0 && <div className="s-space-cap">Teams</div>}
          {teams.map(row)}
          {offices.length > 0 && <div className="s-space-cap">Office</div>}
          {offices.map(row)}
          <div className="s-space-sep" />
          <button type="button" className="s-space-row plain" onClick={() => { setOpen(false); setCreating(orgs.filter((o) => o.role === 'owner' || o.role === 'admin' || o.role === 'member')); }}><Plus size={15} /> Create a team</button>
        </div>
      )}
      {creating && <CreateTeamDialog orgs={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

export function Backdrop({ onClose, label, children }) {
  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-share" role="dialog" aria-label={label}>{children}</div>
    </div>
  );
}

export function CreateTeamDialog({ orgs, onClose }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const switchTo = useSwitchSpace();
  const [orgId, setOrgId] = useState(orgs[0]?.id);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2 || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await workspacesAPI.createSpace(orgId, { name: name.trim() });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      onClose();
      switchTo(r.data.id);
      navigate('/notes');
    } catch (x) { setErr(x.response?.data?.error || 'Could not create the team. Try again.'); setBusy(false); }
  };
  return (
    <Backdrop onClose={onClose} label="Create a team">
      <div className="s-share-head"><div><b>Create a team</b><small>A team starts empty and private</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <form onSubmit={go} className="s-space-form">
        <label>Name<input autoFocus aria-label="Team name" placeholder="Design review" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        {orgs.length > 1 && <label>Organization<select aria-label="Organization" value={orgId} onChange={(e) => setOrgId(e.target.value)}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
        <p className="s-share-msg">Nothing from Personal is added. Owners and admins are not members unless you add them. You lead the team.</p>
        {err && <p className="s-space-err" role="alert">{err}</p>}
        <div className="s-space-btns"><button type="submit" className="s-share-go" disabled={busy || name.trim().length < 2}>Create team</button><button type="button" className="s-space-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Backdrop>
  );
}

export function CreateOrgDialog({ onClose }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const switchTo = useSwitchSpace();
  const [name, setName] = useState('');
  const [start, setStart] = useState('team');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2 || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await workspacesAPI.createOrg({ name: name.trim(), start });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      onClose();
      switchTo(r.data.spaceId);
      navigate('/notes');
    } catch (x) { setErr(x.response?.data?.error || 'Could not set it up. Try again.'); setBusy(false); }
  };
  return (
    <Backdrop onClose={onClose} label="Set up your organization">
      <div className="s-share-head"><div><b>Set up your organization</b><small>Your Personal notes stay yours. This adds a place for shared work.</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <form onSubmit={go} className="s-space-form">
        <label>Organization name<input autoFocus aria-label="Organization name" placeholder="Studio Co" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <div className="s-space-cap" style={{ padding: 0 }}>Start with</div>
        <div className="s-space-start">
          <button type="button" className={start === 'team' ? 'on' : ''} style={{ background: 'var(--s-sky)' }} aria-pressed={start === 'team'} onClick={() => setStart('team')}><Users size={18} /><b>One team</b><small>For a group that works together</small></button>
          <button type="button" className={start === 'office' ? 'on' : ''} style={{ background: 'var(--s-peach)' }} aria-pressed={start === 'office'} onClick={() => setStart('office')}><Building2 size={18} /><b>An Office</b><small>For announcements from one publisher</small></button>
        </div>
        {err && <p className="s-space-err" role="alert">{err}</p>}
        <div className="s-space-btns"><button type="submit" className="s-share-go" disabled={busy || name.trim().length < 2}>Create organization</button><button type="button" className="s-space-ghost" onClick={onClose}>Later</button></div>
      </form>
    </Backdrop>
  );
}

/** Access changes (mockup C14): if the space being worked in is closed or the person was removed, drop back to Personal and say so. */
export function SpaceAccessGuard() {
  const { data } = useWorkspaces();
  const current = useCurrentSpace();
  const switchTo = useSwitchSpace();
  const names = useRef({});
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!data) return;
    const all = data.orgs.flatMap((o) => o.spaces);
    all.forEach((x) => { names.current[x.id] = x.name; });
    if (current && !all.some((x) => x.id === current)) {
      setNotice(`${names.current[current] || 'That space'} is no longer available to you. You are back in Personal.`);
      switchTo(null);
    }
  }, [data, current, switchTo]);
  if (!notice) return null;
  return (
    <div className="s-toast s-move-toast" role="status" data-testid="space-gone">
      <span>{notice}</span>
      <button type="button" onClick={() => setNotice('')}>Dismiss</button>
    </div>
  );
}
