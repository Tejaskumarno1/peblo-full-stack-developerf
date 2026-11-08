import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Building2, Users, User, UserPlus, MoreHorizontal, Shield, KeyRound, AlignLeft, Download, Mail, LogOut, X, Lock, Info, Plus, TriangleAlert } from 'lucide-react';
import { workspacesAPI } from '../../api';
import { useWorkspaces, useCurrentSpace, CreateOrgDialog } from '../spaces';
import { Card } from './ui';
import '../orgpages.css';

const TONES = ['peach', 'sky', 'mint', 'butter', 'lilac'];
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const days = (d) => Math.round((new Date(d).getTime() - Date.now()) / 86400000);
const when = (d) => {
  const t = new Date(d);
  const sameDay = t.toDateString() === new Date().toDateString();
  const y = new Date(Date.now() - 86400000).toDateString() === t.toDateString();
  const hm = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: false });
  return sameDay ? `Today ${hm}` : y ? `Yesterday ${hm}` : `${t.toLocaleDateString(undefined, { weekday: 'short' })} ${hm}`;
};

/** The organization these pages are about: the one that owns the space in use, else the first one. */
export function useActiveOrg() {
  const { data, isLoading } = useWorkspaces();
  const current = useCurrentSpace();
  const orgs = data?.orgs || [];
  const org = orgs.find((o) => o.spaces.some((s) => s.id === current)) || orgs[0] || null;
  return { org, orgs, isLoading, me: data?.me?.id, admin: !!org && (org.role === 'owner' || org.role === 'admin'), owner: org?.role === 'owner' };
}

function Dialog({ icon: Icon, tone = 'mint', title, onClose, children, narrow }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`og-dlg${narrow ? ' narrow' : ''}`} role="dialog" aria-label={title}>
        <div className="og-dh"><span className="og-ico lg" style={{ background: `var(--s-${tone})` }}><Icon size={20} /></span><h2>{title}</h2></div>
        {children}
      </div>
    </div>
  );
}
export { Dialog as OrgDialog };

function useRun() {
  const [msg, setMsg] = useState('');
  const qc = useQueryClient();
  const run = async (fn) => {
    setMsg('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['org-members'] });
      qc.invalidateQueries({ queryKey: ['org-audit'] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      return true;
    } catch (e) { setMsg(e.response?.data?.error || 'That did not work. Try again.'); return false; }
  };
  return { msg, run, setMsg };
}

function NoOrg({ title }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Card title={title} hint="You are not in an organization yet. Set one up to share notes and tasks with a team.">
        <button type="button" className="og-btn pri" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)} data-testid="org-create">Set up an organization</button>
      </Card>
      {creating && <CreateOrgDialog onClose={() => setCreating(false)} />}
    </>
  );
}

const Msg = ({ msg }) => (msg ? <p className="og-note" role="alert" style={{ color: '#A3201A', gridColumn: '1 / -1' }}>{msg}</p> : null);
const Loading = ({ title }) => <Card title={title}><p className="og-note">Loading...</p></Card>;

/* ---------- Members (C01, C02, C03) ---------- */
function InviteDialog({ org, onClose }) {
  const qc = useQueryClient();
  const [emails, setEmails] = useState([]);
  const [draft, setDraft] = useState('');
  const [spaceIds, setSpaceIds] = useState(org.spaces[0] ? [org.spaces[0].id] : []);
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(null);
  const parse = (t) => t.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const addDraft = () => {
    const parts = parse(draft);
    if (!parts.length) return true;
    const bad = parts.find((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (bad) { setErr(`${bad} is not a valid email address.`); return false; }
    setErr(''); setEmails((cur) => [...new Set([...cur, ...parts])]); setDraft(''); return true;
  };
  const send = async () => {
    if (!addDraft()) return;
    const list = [...new Set([...emails, ...parse(draft)])];
    if (!list.length) { setErr('Add at least one email address.'); return; }
    setBusy(true); setErr('');
    const out = [];
    for (const email of list) {
      try { const r = await workspacesAPI.invite(org.id, { email, orgRole: 'member', spaceIds, spaceRole: role }); out.push({ email, link: r.data.link }); }
      catch (e) { out.push({ email, error: e.response?.data?.error || 'Could not invite.' }); }
    }
    setBusy(false); setSent(out);
    qc.invalidateQueries({ queryKey: ['org-members', org.id] });
    qc.invalidateQueries({ queryKey: ['org-audit', org.id] });
  };
  const copy = (t) => { try { navigator.clipboard.writeText(t); } catch { /* shown for copying by hand */ } };
  if (sent) {
    return (
      <Dialog icon={UserPlus} title="Invites sent" onClose={onClose}>
        <p className="og-note">Each person gets an email. If it does not arrive, send them their own link below. A link works once, only for that email address.</p>
        <div className="og-rows">
          {sent.map((s) => (
            <div key={s.email} className="og-row"><div className="txt"><b>{s.email}</b>{s.error ? <small style={{ color: '#A3201A' }}>{s.error}</small> : <small>{s.link}</small>}</div>
              {s.link && <button type="button" className="og-btn white" onClick={() => copy(s.link)}>Copy link</button>}</div>
          ))}
        </div>
        <div className="og-btns"><button type="button" className="og-btn pri" onClick={onClose}>Done</button></div>
      </Dialog>
    );
  }
  const n = emails.length + parse(draft).length;
  return (
    <Dialog icon={UserPlus} title="Invite people" onClose={onClose}>
      <div className="og-cap">Email addresses</div>
      <div className="og-emails">
        {emails.map((e) => <span key={e} className="e">{e}<button type="button" aria-label={`Remove ${e}`} onClick={() => setEmails((c) => c.filter((x) => x !== e))}><X size={13} /></button></span>)}
        <input autoFocus type="text" inputMode="email" aria-label="Email address to invite" data-testid="invite-email" placeholder={emails.length ? 'add another' : 'name@company.com'} value={draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={addDraft}
          onKeyDown={(e) => { if (['Enter', ',', ' '].includes(e.key) && draft.trim()) { e.preventDefault(); addDraft(); } if (e.key === 'Backspace' && !draft) setEmails((c) => c.slice(0, -1)); }} />
      </div>
      {org.spaces.length > 0 && (
        <>
          <div className="og-cap">Add to</div>
          <div className="og-chips">
            {org.spaces.map((s) => { const on = spaceIds.includes(s.id); return <button key={s.id} type="button" className={`og-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setSpaceIds((c) => (on ? c.filter((x) => x !== s.id) : [...c, s.id]))}>{s.kind === 'office' ? <Building2 size={14} /> : <Users size={14} />}{s.name}</button>; })}
          </div>
          <div className="og-cap">Role</div>
          <div className="og-seg" role="radiogroup" aria-label="Role">{['member', 'viewer', 'lead'].map((r) => <button key={r} type="button" role="radio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{cap(r)}</button>)}</div>
        </>
      )}
      <div className="og-banner butter"><b><Mail size={16} /> The invite works once and expires in 7 days</b><span>The person must sign in with the same, verified email to accept.</span></div>
      {err && <p className="og-err" role="alert">{err}</p>}
      <div className="og-btns"><button type="button" className="og-btn pri" disabled={busy || n === 0} onClick={send} data-testid="invite-send">{busy ? 'Sending...' : n > 1 ? `Send ${n} invites` : 'Send invite'}</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
    </Dialog>
  );
}

function RemoveDialog({ org, m, me, onClose, run }) {
  const [tasks, setTasks] = useState('unassign');
  const first = m.name.split(' ')[0];
  const go = async () => { if (await run(() => workspacesAPI.removeMember(org.id, m.userId, tasks === 'me' ? me : undefined))) onClose(); };
  const n = m.openTasks || 0;
  return (
    <Dialog icon={LogOut} tone="peach" title={`Remove ${m.name}?`} onClose={onClose} narrow>
      <div className="og-banner butter"><b>Access ends at once</b><span>Their sign-in to this organization, access tokens, open editing sessions and share links stop immediately.</span></div>
      <div className="og-banner mint"><b>{first}'s Personal notes are untouched</b><span>Notes written in team spaces stay with the team and show their name.</span></div>
      {n > 0 && (
        <>
          <div className="og-cap">{first}'s open tasks ({n})</div>
          <div className="og-chips">
            <button type="button" className={`og-chip${tasks === 'me' ? ' on' : ''}`} aria-pressed={tasks === 'me'} onClick={() => setTasks('me')}>Reassign to me</button>
            <button type="button" className={`og-chip${tasks === 'unassign' ? ' on' : ''}`} aria-pressed={tasks === 'unassign'} onClick={() => setTasks('unassign')}>Leave unassigned</button>
          </div>
        </>
      )}
      <div className="og-btns"><button type="button" className="og-btn rose" onClick={go} data-testid="remove-confirm">Remove {first}</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
    </Dialog>
  );
}


const EXPIRY = [[1, '1 day'], [7, '7 days'], [30, '30 days']];
const USES = [[0, 'Unlimited'], [10, '10 people'], [25, '25 people']];
const untilText = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** A shareable team link that expires (mockup E03). Admins create, copy and revoke; a joiner becomes a member of the Office. */
function JoinLinkDialog({ org, onClose }) {
  const office = org.spaces.find((s) => s.kind === 'office') || org.spaces[0];
  const qc = useQueryClient();
  const [days, setDays] = useState(7);
  const [uses, setUses] = useState(0);
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const { data } = useQuery({ queryKey: ['join-links', org.id], queryFn: () => workspacesAPI.joinLinks(org.id).then((r) => r.data) });
  const links = data?.links || [];
  const make = async () => {
    setBusy(true); setErr('');
    try {
      const body = { expiresInDays: days, spaceRole: role, spaceId: office?.id };
      if (uses) body.maxUses = uses;
      await workspacesAPI.createJoinLink(org.id, body);
      qc.invalidateQueries({ queryKey: ['join-links', org.id] });
    } catch (e) { setErr(e.response?.data?.error || 'Could not make the link. Nothing was changed.'); }
    setBusy(false);
  };
  const copy = async (l) => { try { await navigator.clipboard.writeText(l.link); setCopied(l.id); window.setTimeout(() => setCopied(''), 1800); } catch { /* blocked */ } };
  const revoke = async (l) => { try { await workspacesAPI.revokeJoinLink(org.id, l.id); qc.invalidateQueries({ queryKey: ['join-links', org.id] }); } catch (e) { setErr(e.response?.data?.error || 'Could not revoke it.'); } };
  return (
    <Dialog icon={Link2} tone="sky" title="Invite with a link" onClose={onClose}>
      <p className="og-sub">Anyone with a signed-in, verified account can join {office?.name || org.name} through this link until it expires.</p>
      <div className="og-field"><label>Join as</label>
        <div className="og-seg" role="radiogroup" aria-label="Join as">
          {[['member', 'Member'], ['viewer', 'Viewer']].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={role === v} className={role === v ? 'on' : ''} onClick={() => setRole(v)}>{l}</button>)}
        </div>
      </div>
      <div className="og-field"><label>Expires after</label>
        <div className="og-seg" role="radiogroup" aria-label="Expires after">
          {EXPIRY.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={days === v} className={days === v ? 'on' : ''} onClick={() => setDays(v)}>{l}</button>)}
        </div>
      </div>
      <div className="og-field"><label>Limit</label>
        <div className="og-seg" role="radiogroup" aria-label="Limit">
          {USES.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={uses === v} className={uses === v ? 'on' : ''} onClick={() => setUses(v)}>{l}</button>)}
        </div>
      </div>
      {err && <p className="og-err" role="alert">{err}</p>}
      <button type="button" className="og-btn pri" data-testid="joinlink-create" disabled={busy} onClick={make}>{busy ? 'Making...' : 'Make a link'}</button>
      {links.length > 0 && <div className="og-links" data-testid="joinlink-list">
        <small className="og-sub">Links you made</small>
        {links.map((l) => (
          <div key={l.id} className={`og-link ${l.state}`} data-testid="joinlink-row">
            <span className="og-lk-t"><b>{l.spaceName}</b><small>{l.state === 'active' ? `Expires ${untilText(l.expiresAt)}` : l.state === 'expired' ? 'Expired' : 'Full'} - {l.uses}{l.maxUses ? ` of ${l.maxUses}` : ''} joined - as {l.spaceRole}</small></span>
            {l.state === 'active' && <button type="button" className="og-btn" data-testid="joinlink-copy" onClick={() => copy(l)}>{copied === l.id ? 'Copied' : 'Copy link'}</button>}
            <button type="button" className="og-btn" data-testid="joinlink-revoke" onClick={() => revoke(l)}>Revoke</button>
          </div>
        ))}
      </div>}
      <div className="og-actions"><button type="button" className="og-btn" onClick={onClose}>Done</button></div>
    </Dialog>
  );
}

export function MembersPage() {
  const { org, admin, me, isLoading } = useActiveOrg();
  const { msg, run } = useRun();
  const [inviting, setInviting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [menu, setMenu] = useState(null);
  const [removing, setRemoving] = useState(null);
  const { data } = useQuery({ queryKey: ['org-members', org?.id], enabled: !!org, queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  useEffect(() => {
    if (!menu) return undefined;
    const off = () => setMenu(null);
    window.addEventListener('click', off);
    return () => window.removeEventListener('click', off);
  }, [menu]);
  if (isLoading) return <Loading title="Members" />;
  if (!org) return <NoOrg title="Members" />;
  const ROLES = ['owner', 'admin', 'member', 'guest'].filter((r) => r !== 'owner' || org.role === 'owner');
  return (
    <div className="og-cols" data-testid="org-members">
      <Msg msg={msg} />
      <section className="og-card" aria-label="People in the organization">
        <div className="og-head"><h2>People in the organization</h2>{admin && org?.spaces.some((x) => x.kind === 'office') && <button type="button" className="og-btn" onClick={() => setLinking(true)} data-testid="joinlink-open"><Link2 size={15} /> Invite with a link</button>}{admin && <button type="button" className="og-btn pri" onClick={() => setInviting(true)} data-testid="invite-open"><UserPlus size={15} /> Invite people</button>}</div>
        <div className="og-rows" data-testid="member-list">
          {(data?.members || []).map((m, i) => {
            const self = m.userId === me;
            return (
              <div key={m.userId} className="og-row" data-testid="member-row">
                <span className="og-av" style={{ background: `var(--s-${TONES[i % TONES.length]})` }}>{(m.name || '?')[0].toUpperCase()}</span>
                <div className="txt"><b>{m.name}{self ? ' (you)' : ''}</b><small>{m.email}</small></div>
                <span className={`og-tag ${m.status === 'paused' ? 'sand' : 'mint'}`}>{m.status === 'paused' ? 'Paused' : 'Active'}</span>
                {admin && !self ? (
                  <select className="og-rolesel" aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => run(() => workspacesAPI.setMember(org.id, m.userId, { role: e.target.value }))}>
                    {ROLES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}
                  </select>
                ) : <span className="og-tag" style={{ padding: '0 14px', height: 34 }}>{cap(m.role)}</span>}
                {admin && !self ? <button type="button" className="og-menu-btn" aria-label={`More for ${m.name}`} aria-haspopup="menu" aria-expanded={menu === m.userId} onClick={(e) => { e.stopPropagation(); setMenu(menu === m.userId ? null : m.userId); }}><MoreHorizontal size={18} /></button> : <span style={{ width: 32 }} />}
                {menu === m.userId && <div className="og-menu" role="menu"><button type="button" role="menuitem" className="bad" onClick={() => { setMenu(null); setRemoving(m); }}>Remove from organization</button></div>}
              </div>
            );
          })}
          {(data?.invites || []).map((i) => (
            <div key={i.id} className="og-row" data-testid="invite-row">
              <span className="og-av" style={{ background: 'var(--s-lilac)' }}>{i.email[0]}</span>
              <div className="txt"><b>{i.email}</b><small>{i.createdAt ? (days(i.createdAt) >= 0 ? 'Invited today, ' : `Invited ${-days(i.createdAt)} day${days(i.createdAt) === -1 ? '' : 's'} ago, `) : ''}expires in {Math.max(0, days(i.expiresAt))} days</small></div>
              <span className="og-tag butter">Invited</span>
              <span className="og-tag" style={{ padding: '0 14px', height: 34 }}>{cap(i.orgRole)}</span>
              {admin ? <button type="button" className="og-menu-btn" aria-label={`More for ${i.email}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); setMenu(menu === i.id ? null : i.id); }}><MoreHorizontal size={18} /></button> : <span style={{ width: 32 }} />}
              {menu === i.id && <div className="og-menu" role="menu"><button type="button" role="menuitem" className="bad" onClick={() => { setMenu(null); run(() => workspacesAPI.revokeInvite(org.id, i.id)); }}>Withdraw invite</button></div>}
            </div>
          ))}
        </div>
        <p className="og-note">Owners and admins manage people. Admins cannot read team notes unless they are members of that team.</p>
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="og-card tone" style={{ background: 'var(--s-lilac)' }} aria-label="Roles">
          <h2>Roles</h2>
          {[['Owner', 'peach', 'Everything. At least two.'], ['Admin', '', 'People, policy, keys, audit.'], ['Member', 'sky', 'Spaces they are added to.'], ['Guest', 'butter', 'Only what is shared, with an end date.']].map(([r, t, d]) => (
            <div key={r} className="og-role"><span className={`og-tag ${t}`} style={t ? undefined : { background: 'transparent' }}>{r}</span><span>{d}</span></div>
          ))}
        </section>
        <section className="og-card" aria-label="Joining"><h2>Joining</h2><p>People accept with the email address that was invited, and it must be verified.</p></section>
      </div>
      {inviting && <InviteDialog org={org} onClose={() => setInviting(false)} />}
      {linking && <JoinLinkDialog org={org} onClose={() => setLinking(false)} />}
      {removing && <RemoveDialog org={org} m={removing} me={me} run={run} onClose={() => setRemoving(null)} />}
    </div>
  );
}

/* ---------- Teams (C09, C11) ---------- */
export function CreateTeamPanel({ org, people, onClose, onMade }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e) => {
    e?.preventDefault?.();
    if (name.trim().length < 2 || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await workspacesAPI.createSpace(org.id, { name: name.trim() });
      for (const uid of picked) await workspacesAPI.setSpaceRole(r.data.id, uid, 'member');
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['org-members', org.id] });
      onMade?.(r.data); onClose();
    } catch (x) { setErr(x.response?.data?.error || 'Could not create the team. Try again.'); setBusy(false); }
  };
  const rest = people.filter((p) => !picked.includes(p.userId));
  return (
    <Dialog icon={Users} tone="sky" title="Create a team" onClose={onClose} narrow>
      <form onSubmit={go} style={{ display: 'contents' }}>
        <div className="og-cap">Name</div>
        <input className="og-field" autoFocus aria-label="Team name" placeholder="Design review" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <div className="og-cap">Starting members</div>
        <div className="og-chips">
          <span className="og-chip white" style={{ cursor: 'default' }}>You, lead</span>
          {people.filter((p) => picked.includes(p.userId)).map((p) => <button key={p.userId} type="button" className="og-chip" onClick={() => setPicked((c) => c.filter((x) => x !== p.userId))} aria-label={`Remove ${p.name}`}>{p.name.split(' ')[0]} <X size={12} /></button>)}
          <button type="button" className="og-chip" aria-expanded={adding} onClick={() => setAdding((v) => !v)}><Plus size={14} /> Add people</button>
        </div>
        {adding && <div className="og-chips">{rest.map((p) => <button key={p.userId} type="button" className="og-chip white" onClick={() => setPicked((c) => [...c, p.userId])}>{p.name}</button>)}{rest.length === 0 && <span className="og-note">Everyone is already added.</span>}</div>}
        <div className="og-banner mint"><b><Lock size={15} /> A team starts empty and private</b><span>Nothing from Personal is added. Owners and admins are not members unless you add them.</span></div>
        {err && <p className="og-err" role="alert">{err}</p>}
        <div className="og-btns"><button type="submit" className="og-btn pri" disabled={busy || name.trim().length < 2}>Create team</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

function TeamPair({ s, admin, policy, run }) {
  const canManage = admin || s.role === 'lead';
  const [name, setName] = useState(s.name);
  const [closing, setClosing] = useState(false);
  useEffect(() => setName(s.name), [s.name]);
  const dirty = name.trim() !== s.name && name.trim().length >= 2;
  const orgAllows = policy ? policy.publicShares !== false : true;
  const links = orgAllows && s.publicLinks !== false;
  return (
    <div className="og-cols pair" data-testid="team-row">
      <section className="og-card" aria-label={s.name}>
        <h2>{s.name}</h2>
        {canManage ? (
          <>
            <div className="og-cap">Name</div>
            <input className="og-field" aria-label={`Name of ${s.name}`} value={name} maxLength={80} data-testid="team-name" onChange={(e) => setName(e.target.value)}
              onBlur={() => dirty && run(() => workspacesAPI.updateSpace(s.id, { name: name.trim() }))} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            <div className="og-cap">New members join as</div>
            <div className="og-seg" role="radiogroup" aria-label={`New people join ${s.name} as`}>
              {['member', 'viewer'].map((r) => <button key={r} type="button" role="radio" aria-checked={(s.defaultRole || 'member') === r} className={(s.defaultRole || 'member') === r ? 'on' : ''} onClick={() => run(() => workspacesAPI.updateSpace(s.id, { defaultRole: r }))}>{cap(r)}</button>)}
            </div>
            <div className="og-cap">Sharing</div>
            <div className="og-head" style={{ flexWrap: 'nowrap' }}><b style={{ fontSize: 14.5 }}>Allow public links for this team</b>
              <button type="button" role="switch" aria-checked={links} aria-label="Allow public links for this team" disabled={!orgAllows} className={`og-sw${links ? ' on' : ''}`} onClick={() => run(() => workspacesAPI.updateSpace(s.id, { publicLinks: !links }))}><span /></button></div>
            <p>Needs the organization setting to be on.</p>
          </>
        ) : <p>{s.kind === 'office' ? 'The Office. Only publishers post announcements.' : 'Each team has its own notes, tasks and members.'}</p>}
      </section>
      <section className="og-card sand" aria-label="Leave or close">
        <h2>Leave or close</h2>
        {s.role && <button type="button" className="og-btn plain" style={{ alignSelf: 'flex-start' }} onClick={() => run(() => workspacesAPI.leaveSpace(s.id))} data-testid="team-leave"><LogOut size={15} /> Leave {s.kind === 'office' ? 'Office' : 'team'}</button>}
        <p>Leaving keeps your Personal notes. Notes you wrote here stay with the team.</p>
        {canManage && <hr style={{ border: 0, borderTop: '1.5px solid var(--s-line)', width: '100%' }} />}
        {canManage && !closing && <button type="button" className="og-btn rose" style={{ alignSelf: 'flex-start' }} onClick={() => setClosing(true)} data-testid="team-close">Close {s.kind === 'office' ? 'Office' : 'team'}</button>}
        {canManage && closing && <div className="og-chips"><button type="button" className="og-btn rose" onClick={() => run(() => workspacesAPI.closeSpace(s.id))} data-testid="team-close-confirm">Close {s.name}</button><button type="button" className="og-btn ghost" onClick={() => setClosing(false)}>Keep it</button></div>}
        {canManage && <p>{closing ? `Close ${s.name}? It leaves everyone's switcher. Nothing is deleted and it stays in the organization export.` : 'Closing hides it for everyone. Nothing is deleted and it stays in the organization export.'}</p>}
      </section>
    </div>
  );
}

export function TeamsPage() {
  const { org, admin, isLoading } = useActiveOrg();
  const { msg, run } = useRun();
  const [creating, setCreating] = useState(false);
  const policy = useQuery({ queryKey: ['org-policy', org?.id], enabled: !!org && admin, queryFn: () => workspacesAPI.policy(org.id).then((r) => r.data.policy) });
  const members = useQuery({ queryKey: ['org-members', org?.id], enabled: !!org && creating, queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  if (isLoading) return <Loading title="Teams" />;
  if (!org) return <NoOrg title="Teams" />;
  return (
    <>
      <div className="og-cols" style={{ gridTemplateColumns: '1fr' }}>
        <Msg msg={msg} />
        <div className="og-head">{org.spaces.length === 0 ? <p className="og-note">No teams yet.</p> : <span />}<button type="button" className="og-btn pri" onClick={() => setCreating(true)} data-testid="team-create"><Plus size={15} /> Create a team</button></div>
      </div>
      <div data-testid="team-settings" style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {org.spaces.map((s) => <TeamPair key={s.id} s={s} admin={admin} policy={policy.data} run={run} />)}
      </div>
      {creating && <CreateTeamPanel org={org} people={(members.data?.members || []).filter((m) => m.status === 'active' && m.role !== 'guest')} onClose={() => setCreating(false)} />}
    </>
  );
}

/* ---------- Policy (C04) ---------- */
function PublishersDialog({ org, office, onClose, run }) {
  const { data } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const people = (data?.members || []).filter((m) => m.status === 'active' && m.spaces.some((s) => s.id === office.id));
  return (
    <Dialog icon={Building2} tone="peach" title="Who can publish" onClose={onClose} narrow>
      <p className="og-note">Publishers post announcements to everyone in {office.name}. Everyone else can suggest one.</p>
      <div className="og-rows">
        {people.map((m) => {
          const lead = m.spaces.find((s) => s.id === office.id)?.role === 'lead';
          return (
            <div key={m.userId} className="og-row"><div className="txt"><b>{m.name}</b><small>{m.email}</small></div>
              <button type="button" role="switch" aria-checked={lead} aria-label={`${m.name} can publish`} className={`og-sw${lead ? ' on' : ''}`} onClick={() => run(() => workspacesAPI.setSpaceRole(office.id, m.userId, lead ? 'member' : 'lead'))}><span /></button></div>
          );
        })}
      </div>
      <div className="og-btns"><button type="button" className="og-btn pri" onClick={onClose}>Done</button></div>
    </Dialog>
  );
}

const POLICY_ROWS = [
  ['publicShares', 'Public share links', 'Anyone with a link can read a note. Off keeps every note inside the organization.', true],
  ['guests', 'Guests', 'Allow time-limited access for outside people, such as an auditor.', false],
  ['aiFeatures', 'AI features', 'Let members use AI on organization notes.', true],
  ['requireOrgKey', 'Require the organization AI key', 'Members cannot use a personal key on organization notes.', false],
  ['membersCreateTeams', 'Members can create teams', 'Off means only owners and admins can.', true],
];

export function PolicyPage() {
  const { org, admin, isLoading } = useActiveOrg();
  const { msg, run } = useRun();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pub, setPub] = useState(false);
  const { data } = useQuery({ queryKey: ['org-policy', org?.id], enabled: !!org && admin, queryFn: () => workspacesAPI.policy(org.id).then((r) => r.data.policy) });
  const { data: mem } = useQuery({ queryKey: ['org-members', org?.id], enabled: !!org, queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  if (isLoading) return <Loading title="Policy" />;
  if (!org) return <NoOrg title="Policy" />;
  if (!admin) return <Card title="Organization policy" hint="Only owners and admins can see and change the policy." />;
  const office = org.spaces.find((s) => s.kind === 'office');
  const leads = (mem?.members || []).filter((m) => m.spaces.some((s) => s.id === office?.id && s.role === 'lead'));
  const set = (k, v) => run(async () => { await workspacesAPI.setPolicy(org.id, { [k]: v }); qc.invalidateQueries({ queryKey: ['org-policy', org.id] }); });
  return (
    <div className="og-cols" data-testid="org-policy">
      <Msg msg={msg} />
      <section className="og-card" aria-label="Organization policy">
        <h2>Organization policy</h2>
        <div className="og-rows">
          {data ? POLICY_ROWS.map(([k, t, d, def]) => {
            const on = data[k] ?? def;
            return (
              <div key={k} className="og-row" style={{ padding: '14px 18px' }}>
                <div className="txt"><b>{t}</b><small style={{ whiteSpace: 'normal' }}>{d}</small></div>
                <button type="button" role="switch" aria-checked={on} aria-label={t} className={`og-sw${on ? ' on' : ''}`} onClick={() => set(k, !on)} data-testid={`policy-${k}`}><span /></button>
              </div>
            );
          }) : <p className="og-note">Loading...</p>}
        </div>
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="og-card tone" style={{ background: 'var(--s-sky)' }}>
          <h2>Who can change this</h2><p>Owners and admins. Every change is written to the audit log with who and when.</p>
          <button type="button" className="og-btn white" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/settings/org-audit')}><AlignLeft size={15} /> See changes</button>
        </section>
        {office && (
          <section className="og-card"><h2>Office space</h2><p>Who can publish announcements</p>
            <div className="og-chips"><span className="og-av-stack">{leads.map((m, i) => <span key={m.userId} className="og-av" style={{ background: `var(--s-${TONES[i % TONES.length]})` }}>{m.name[0]}</span>)}</span>
              <button type="button" className="og-btn" onClick={() => setPub(true)} data-testid="publishers-open">Change publishers</button></div>
          </section>
        )}
      </div>
      {pub && office && <PublishersDialog org={org} office={office} run={run} onClose={() => setPub(false)} />}
    </div>
  );
}

/* ---------- AI keys (C05) ---------- */
const PROVIDERS = [['openai', 'OpenAI', 'mint'], ['gemini', 'Gemini', 'butter']];
function KeyDialog({ provider, label, replacing, onClose, save }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); if (!key.trim()) return; setBusy(true); const ok = await save(provider, key.trim()); setBusy(false); if (ok) onClose(); };
  return (
    <Dialog icon={KeyRound} tone="sky" title={`${replacing ? 'Replace' : 'Add'} the ${label} key`} onClose={onClose} narrow>
      <form onSubmit={go} style={{ display: 'contents' }}>
        <p className="og-note">The key is stored encrypted and never shown again. Members use it without seeing it.</p>
        <input className="og-field" type="password" autoComplete="off" autoFocus aria-label={`${label} key`} placeholder="Paste the key" value={key} onChange={(e) => setKey(e.target.value)} data-testid="ai-key-input" />
        <div className="og-btns"><button type="submit" className="og-btn pri" disabled={busy || !key.trim()} data-testid="ai-key-save">Save key</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}
export function AiKeysPage() {
  const { org, admin, isLoading } = useActiveOrg();
  const { msg, run } = useRun();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState(null);
  const { data } = useQuery({ queryKey: ['org-ai-keys', org?.id], enabled: !!org && admin, queryFn: () => workspacesAPI.aiKeys(org.id).then((r) => r.data.keys || r.data) });
  if (isLoading) return <Loading title="AI keys" />;
  if (!org) return <NoOrg title="AI keys" />;
  if (!admin) return <Card title="AI keys" hint="Only owners and admins manage the organization's AI keys." />;
  const st = (p) => (Array.isArray(data) ? data : []).find((k) => k.provider === p) || {};
  const after = async (fn) => { const ok = await run(fn); qc.invalidateQueries({ queryKey: ['org-ai-keys', org.id] }); return ok; };
  return (
    <div className="og-cols even" data-testid="org-ai-keys">
      <Msg msg={msg} />
      {PROVIDERS.map(([p, label, tone]) => {
        const k = st(p);
        return (
          <section key={p} className="og-card tone" style={{ background: `var(--s-${tone})` }} aria-label={label}>
            <div className="og-head" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 12 }}><span className="og-ico lg" style={{ background: 'var(--s-surface)' }}><KeyRound size={18} /></span>
                <div><h2>{label}</h2><p>{k.set ? `Added by ${k.addedByName || 'an admin'}${k.addedAt ? ` on ${new Date(k.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}. Members never see the key.` : `Add a key to let members use ${label} on organization notes.`}</p></div></div>
              <span className="og-tag">{k.set ? 'Set' : 'Not set'}</span>
            </div>
            {k.set ? (
              <div className="og-chips"><button type="button" className="og-btn" onClick={() => setDlg({ p, label, replacing: true })}>Replace key</button><button type="button" className="og-btn rose" onClick={() => after(() => workspacesAPI.removeAiKey(org.id, p))} data-testid={`ai-key-remove-${p}`}>Remove</button></div>
            ) : <button type="button" className="og-btn pri" style={{ justifyContent: 'center' }} onClick={() => setDlg({ p, label })} data-testid={`ai-key-add-${p}`}><Plus size={15} /> Add a key</button>}
          </section>
        );
      })}
      <section className="og-card tone" style={{ background: 'var(--s-lilac)' }} aria-label="Order of use">
        <div style={{ display: 'flex', gap: 12 }}><span className="og-ico lg" style={{ background: 'var(--s-surface)' }}><Info size={18} /></span><div><h2>Order of use</h2><p>1 Personal key, if policy allows. 2 Organization key. No server default.</p></div></div>
        <span className="og-tag" style={{ alignSelf: 'flex-start' }}>Per call: who asked, which key, tokens</span>
      </section>
      {dlg && <KeyDialog provider={dlg.p} label={dlg.label} replacing={dlg.replacing} save={(p, key) => after(() => workspacesAPI.setAiKey(org.id, p, key))} onClose={() => setDlg(null)} />}
    </div>
  );
}

/* ---------- Audit log (C06) ---------- */
const who = (e) => e.actorName || 'Someone';
const AUDIT = {
  'invite.sent': ['People', UserPlus, 'mint', (e) => `${who(e)} invited ${e.target || ''}`, () => 'Invitation sent'],
  'invite.revoked': ['People', X, 'peach', (e) => `${who(e)} withdrew an invite`, () => ''],
  'member.joined': ['People', UserPlus, 'mint', (e, n) => `${n(e.target)} joined`, () => ''],
  'member.updated': ['People', User, 'sky', (e, n) => `${who(e)} changed ${n(e.target)}`, (e) => (e.detail?.role ? `Now ${e.detail.role}` : e.detail?.status || '')],
  'member.removed': ['People', LogOut, 'peach', (e, n) => `${n(e.target)} was removed`, (e) => `By ${who(e)}`],
  'member.left': ['People', LogOut, 'peach', (e, n) => `${n(e.target)} left the organization`, () => ''],
  'space.member_set': ['People', Users, 'sky', (e, n) => `${who(e)} set ${n(e.target)} as ${e.detail?.role || 'member'} of a team`, () => ''],
  'space.created': ['People', Users, 'mint', (e) => `${who(e)} created a team`, () => ''],
  'space.updated': ['People', Users, 'sky', (e) => (e.detail?.name ? `${who(e)} renamed a team to ${e.detail.name}` : `${who(e)} changed a team's settings`), (e) => [e.detail?.defaultRole && `New members join as ${e.detail.defaultRole}`, typeof e.detail?.publicLinks === 'boolean' && `Public links ${e.detail.publicLinks ? 'on' : 'off'}`].filter(Boolean).join(', ')],
  'space.left': ['People', LogOut, 'peach', (e) => `${who(e)} left a team`, () => ''],
  'space.closed': ['People', Users, 'peach', (e) => `${who(e)} closed a team`, () => 'Nothing was deleted'],
  'policy.changed': ['Sharing', Shield, 'lilac', (e) => `${who(e)} changed the organization policy`, (e) => Object.entries(e.detail || {}).map(([k, v]) => `${k}: ${v}`).join(', ')],
  'org.exported': ['Sharing', Download, 'butter', () => 'Organization export requested', () => 'Owners were notified'],
  'key.added': ['Keys', KeyRound, 'sky', (e) => `${who(e)} added the ${e.detail?.provider || ''} key`, () => 'Value never shown'],
  'key.replaced': ['Keys', KeyRound, 'sky', (e) => `${who(e)} replaced the ${e.detail?.provider || ''} key`, () => 'Value never shown'],
  'key.removed': ['Keys', KeyRound, 'peach', (e) => `${who(e)} removed the ${e.detail?.provider || ''} key`, () => ''],
};
export function AuditPage() {
  const { org, admin, isLoading } = useActiveOrg();
  const [f, setF] = useState('All');
  const q = useQuery({ queryKey: ['org-audit', org?.id], enabled: !!org && admin, queryFn: () => workspacesAPI.audit(org.id).then((r) => r.data.events) });
  const mem = useQuery({ queryKey: ['org-members', org?.id], enabled: !!org && admin, queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const nameOf = useMemo(() => { const m = new Map((mem.data?.members || []).map((x) => [x.userId, x.name])); return (id) => m.get(id) || 'Someone'; }, [mem.data]);
  if (isLoading) return <Loading title="Audit log" />;
  if (!org) return <NoOrg title="Audit log" />;
  if (!admin) return <Card title="Audit log" hint="Only owners and admins can read the audit log." />;
  const events = (q.data || []).map((e) => ({ e, k: AUDIT[e.action] || ['People', AlignLeft, 'sky', (x) => x.action.replace(/[._]/g, ' '), () => ''] }));
  const shown = events.filter((x) => f === 'All' || x.k[0] === f);
  const exportLog = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(q.data || [], null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${org.name.replace(/[^\w-]+/g, '-')}-audit-log.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <section className="og-card" style={{ gridColumn: '1 / -1' }} aria-label="Audit log" data-testid="audit-list">
      <div className="og-head"><h2>Audit log</h2>
        <div className="og-chips">{['All', 'People', 'Sharing', 'Keys'].map((t) => <button key={t} type="button" className={`og-chip${f === t ? ' on' : ''}`} aria-pressed={f === t} onClick={() => setF(t)}>{t}</button>)}
          <button type="button" className="og-btn" onClick={exportLog}><Download size={15} /> Export log</button></div></div>
      <div className="og-rows" style={{ gap: 0 }}>
        {shown.length === 0 && <p className="og-note">{q.isLoading ? 'Loading...' : 'Nothing here yet.'}</p>}
        {shown.slice(0, 60).map(({ e, k }) => {
          const Ico = k[1];
          return (
            <div key={e.id} className="og-audit-row"><span className="og-ico" style={{ background: `var(--s-${k[2]})` }}><Ico size={16} /></span>
              <div className="og-row plain" style={{ flex: 1, padding: 0 }}><div className="txt"><b>{k[3](e, nameOf)}</b>{k[4](e) ? <small>{k[4](e)}</small> : null}</div></div>
              <span className="when">{when(e.at)}</span></div>
          );
        })}
      </div>
      <p className="og-note">Who did what and when, never note text. Kept for about a year. Nobody can edit or delete entries.</p>
    </section>
  );
}

/* ---------- Export and seats (C07) ---------- */
export function ExportPage() {
  const { org, admin, isLoading } = useActiveOrg();
  const { msg, run } = useRun();
  const qc = useQueryClient();
  const seats = useQuery({ queryKey: ['org-seats', org?.id], enabled: !!org && admin, queryFn: () => workspacesAPI.seats(org.id).then((r) => r.data) });
  const last = useQuery({ queryKey: ['org-exports', org?.id], enabled: !!org && admin, queryFn: () => workspacesAPI.exports(org.id).then((r) => r.data.exports || r.data) });
  if (isLoading) return <Loading title="Export and seats" />;
  if (!org) return <NoOrg title="Export and seats" />;
  if (!admin) return <Card title="Export and seats" hint="Only owners and admins can export the organization." />;
  const exportAll = () => run(async () => {
    const r = await workspacesAPI.exportOrg(org.id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${org.name.replace(/[^\w-]+/g, '-')}-export.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    qc.invalidateQueries({ queryKey: ['org-exports', org.id] });
  });
  const used = seats.data?.used ?? 0;
  const limit = seats.data?.limit ?? 10;
  const list = Array.isArray(last.data) ? last.data : [];
  return (
    <div className="og-cols even" data-testid="org-export-page">
      <Msg msg={msg} />
      <section className="og-card" aria-label="Organization export">
        <h2>Organization export</h2><p>One file with all team and Office content, members and settings. Owners are told when anyone exports.</p>
        <button type="button" className="og-btn pri" style={{ alignSelf: 'flex-start' }} onClick={exportAll} data-testid="org-export"><Download size={15} /> Request export</button>
        <div className="og-sub">Last exports</div>
        {list.slice(0, 3).map((x) => <div key={x.id} className="og-head" style={{ flexWrap: 'nowrap' }}><b style={{ fontSize: 14 }}>{when(x.at)} by {x.byName || 'an admin'}</b><span className="og-tag mint">Ready</span></div>)}
        {list.length === 0 && <p>No exports yet.</p>}
      </section>
      <section className="og-card tone" style={{ background: 'var(--s-butter)' }} aria-label="Seats">
        <h2>Seats</h2><div className="og-big">{used} of {limit}</div>
        <p>A seat is an active member. People inactive for 28 days are not counted. Guests are free.</p>
        <div className="og-bar" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}><i style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} /></div>
      </section>
      <section className="og-card tone" style={{ background: 'var(--s-lilac)' }} aria-label="Plan">
        <h2>Plan</h2><b style={{ fontSize: 14.5 }}>Free during early access</b>
        <p>There is no billing yet. When there is, nothing is ever deleted for non-payment: the organization becomes read only, then export only.</p>
      </section>
    </div>
  );
}

/* ---------- Organizations (C16, C12) ---------- */
function LeaveDialog({ org, me, onClose, run }) {
  const { data } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const owners = (data?.members || []).filter((m) => m.role === 'owner' && m.status === 'active');
  const others = (data?.members || []).filter((m) => m.userId !== me && m.status === 'active' && m.role !== 'guest');
  const last = org.role === 'owner' && owners.length <= 1;
  const [pick, setPick] = useState('');
  const go = async () => { if (await run(() => workspacesAPI.leave(org.id))) onClose(); };
  const makeOwner = () => run(() => workspacesAPI.setMember(org.id, pick, { role: 'owner' }));
  if (last) {
    return (
      <Dialog icon={TriangleAlert} tone="butter" title="You are the last owner" onClose={onClose} narrow>
        <p className="og-note">An organization needs at least two owners. Make someone else an owner before you leave.</p>
        <div className="og-chips">{others.map((m) => <button key={m.userId} type="button" className={`og-chip${pick === m.userId ? ' on' : ''}`} aria-pressed={pick === m.userId} onClick={() => setPick(m.userId)}>{m.name}</button>)}{others.length === 0 && <span className="og-note">Invite someone first.</span>}</div>
        <div className="og-btns"><button type="button" className="og-btn pri" disabled={!pick} onClick={makeOwner} data-testid="make-owner">Make an owner</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
      </Dialog>
    );
  }
  return (
    <Dialog icon={LogOut} tone="peach" title={`Leave ${org.name}?`} onClose={onClose} narrow>
      <p className="og-note">You lose access to the team notes and tasks. Your Personal notes stay yours. Tasks assigned to you go back to Unassigned.</p>
      <div className="og-btns"><button type="button" className="og-btn pri" onClick={go} data-testid="leave-confirm">Leave {org.name}</button><button type="button" className="og-btn ghost" onClick={onClose}>Stay</button></div>
    </Dialog>
  );
}
function TransferDialog({ org, me, onClose, run }) {
  const { data } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const others = (data?.members || []).filter((m) => m.userId !== me && m.status === 'active' && m.role !== 'guest');
  const [pick, setPick] = useState('');
  const [typed, setTyped] = useState('');
  const target = others.find((m) => m.userId === pick);
  const go = async () => { if (await run(async () => { await workspacesAPI.setMember(org.id, pick, { role: 'owner' }); await workspacesAPI.setMember(org.id, me, { role: 'admin' }); })) onClose(); };
  return (
    <Dialog icon={Shield} tone="lilac" title="Transfer ownership" onClose={onClose} narrow>
      <p className="og-note">{target ? `${target.name} becomes an owner. You stay as an admin.` : 'Pick who becomes an owner. You stay as an admin.'} Type the organization name to confirm.</p>
      <div className="og-chips">{others.map((m) => <button key={m.userId} type="button" className={`og-chip${pick === m.userId ? ' on' : ''}`} aria-pressed={pick === m.userId} onClick={() => setPick(m.userId)}>{m.name}</button>)}</div>
      <input className="og-field" aria-label="Organization name" placeholder={org.name} value={typed} onChange={(e) => setTyped(e.target.value)} />
      <div className="og-btns"><button type="button" className="og-btn rose" disabled={!pick || typed.trim() !== org.name} onClick={go} data-testid="transfer-confirm">Transfer</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
    </Dialog>
  );
}

export function OrgsPage() {
  const { data, isLoading } = useWorkspaces();
  const navigate = useNavigate();
  const { msg, run } = useRun();
  const [creating, setCreating] = useState(false);
  const [leaving, setLeaving] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const orgs = data?.orgs || [];
  const me = data?.me?.id;
  const desc = (o) => {
    const t = o.spaces.filter((s) => s.kind === 'team').length;
    const off = o.spaces.some((s) => s.kind === 'office');
    return t === 0 && !off ? 'No spaces yet' : `Member of ${[t ? `${t} team${t === 1 ? '' : 's'}` : '', off ? 'the Office' : ''].filter(Boolean).join(', and ')}`;
  };
  return (
    <div className="og-cols" data-testid="org-list" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
      <Msg msg={msg} />
      <section className="og-card" aria-label="Organizations you belong to">
        <div className="og-head"><h2>Organizations you belong to</h2><button type="button" className="og-btn pri" onClick={() => setCreating(true)} data-testid="org-create">Set up an organization</button></div>
        <div className="og-rows">
          {isLoading && <p className="og-note">Loading...</p>}
          {!isLoading && orgs.length === 0 && <p className="og-note">You are not in an organization yet. Set one up to share notes and tasks with a team.</p>}
          {orgs.map((o, i) => (
            <div key={o.id} className="og-row" data-testid="org-row">
              <span className="og-ico lg" style={{ background: `var(--s-${i % 2 ? 'mint' : 'sky'})` }}>{i % 2 ? <Building2 size={20} /> : <Users size={20} />}</span>
              <div className="txt"><b>{o.name}</b><small>{desc(o)}</small></div>
              <span className="og-tag" style={{ height: 34, padding: '0 14px' }}>{cap(o.role)}</span>
              {o.role === 'owner' && <button type="button" className="og-btn plain" onClick={() => setTransfer(o)} data-testid="org-transfer">Transfer</button>}
              <button type="button" className="og-btn plain" onClick={() => setLeaving(o)} data-testid="org-leave">Leave</button>
            </div>
          ))}
        </div>
      </section>
      <section className="og-card tone" style={{ background: 'var(--s-mint)' }} aria-label="Your Personal space">
        <h2>Your Personal space</h2><p>Stays with you if you leave an organization. Nobody in an organization can read it.</p>
        <button type="button" className="og-btn white" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/settings/data')}><Download size={15} /> Back up my notes</button>
      </section>
      {creating && <CreateOrgDialog onClose={() => setCreating(false)} />}
      {leaving && <LeaveDialog org={leaving} me={me} run={run} onClose={() => setLeaving(null)} />}
      {transfer && <TransferDialog org={transfer} me={me} run={run} onClose={() => setTransfer(null)} />}
    </div>
  );
}
