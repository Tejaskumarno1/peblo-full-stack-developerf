import { useState } from 'react';
import { Building2, Users, Copy, X, LogOut, Download } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workspacesAPI } from '../../api';
import { Card } from './ui';
import { useWorkspaces, CreateOrgDialog } from '../spaces';

/** Settings > Organizations (mockup C16): the organizations a person belongs to, and a way to set one up. */
export function OrganizationsSection() {
  const { data, isLoading } = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const orgs = data?.orgs || [];
  return (
    <>
      <Card title="Organizations you belong to" hint="Personal always stays yours. Nobody in an organization can read it."
        aside={<button type="button" className="s-share-go" data-testid="org-create" onClick={() => setCreating(true)}>Set up an organization</button>}>
        <div className="s-org-list" data-testid="org-list">
          {isLoading && <p className="s-share-msg">Loading...</p>}
          {!isLoading && orgs.length === 0 && <p className="s-share-msg">You are not in an organization yet. Set one up to share notes and tasks with a team.</p>}
          {orgs.map((o) => (
            <div key={o.id}>
            <div className="s-org-row" data-testid="org-row">
              <i><Building2 size={20} /></i>
              <div><b>{o.name}</b><small>{o.spaces.length === 0 ? 'No spaces yet' : `${o.spaces.length} space${o.spaces.length === 1 ? '' : 's'}: ${o.spaces.map((s) => s.name).join(', ')}`}</small></div>
              <span className="s-chip-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800 }}><Users size={14} /> {o.role[0].toUpperCase() + o.role.slice(1)}</span>
              <button type="button" className="s-soft-btn" data-testid="org-open" onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? 'Close' : 'Members'}</button>
            </div>
            {open === o.id && <OrgMembers org={o} />}
            </div>
          ))}
        </div>
      </Card>
      {creating && <CreateOrgDialog onClose={() => setCreating(false)} />}
    </>
  );
}

const ORG_ROLES = ['owner', 'admin', 'member', 'guest'];
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const ago = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Members, pending invites and the audit log of one organization (mockups C01, C02, C03, C06). */
function OrgMembers({ org }) {
  const qc = useQueryClient();
  const admin = org.role === 'owner' || org.role === 'admin';
  const { data } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const audit = useQuery({ queryKey: ['org-audit', org.id], enabled: admin, queryFn: () => workspacesAPI.audit(org.id).then((r) => r.data.events) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [spaceId, setSpaceId] = useState(org.spaces[0]?.id || '');
  const [msg, setMsg] = useState('');
  const [link, setLink] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['org-members', org.id] }); qc.invalidateQueries({ queryKey: ['org-audit', org.id] }); qc.invalidateQueries({ queryKey: ['workspaces'] }); };
  const run = async (fn) => { setMsg(''); try { await fn(); refresh(); } catch (e) { setMsg(e.response?.data?.error || 'That did not work. Try again.'); } };
  const send = (e) => {
    e.preventDefault();
    run(async () => { const r = await workspacesAPI.invite(org.id, { email, orgRole: role, spaceIds: spaceId ? [spaceId] : [], spaceRole: 'member' }); setLink(r.data.link); setEmail(''); });
  };
  const copy = (t) => { try { navigator.clipboard.writeText(t); } catch { /* the link is shown so it can be copied by hand */ } };
  return (
    <div className="s-org-detail" data-testid="org-detail">
      {msg && <p className="s-share-msg" role="alert">{msg}</p>}
      <div className="s-member-list" data-testid="member-list">
        {(data?.members || []).map((m) => (
          <div key={m.userId} className="s-member-row">
            <div><b>{m.name}</b><small>{m.email}{m.status === 'paused' ? ' - paused' : ''}</small></div>
            {admin ? (
              <select aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => run(() => workspacesAPI.setMember(org.id, m.userId, { role: e.target.value }))}>
                {ORG_ROLES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}
              </select>
            ) : <span className="s-chip-tag">{cap(m.role)}</span>}
            {admin && <button type="button" className="s-capture-close" aria-label={`Remove ${m.name}`} onClick={() => run(() => workspacesAPI.removeMember(org.id, m.userId))}><X size={16} /></button>}
          </div>
        ))}
      </div>
      {admin && (
        <form className="s-invite-form" onSubmit={send}>
          <input type="email" required placeholder="Email address" aria-label="Email address to invite" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="invite-email" />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{ORG_ROLES.filter((r) => r !== 'owner' || org.role === 'owner').map((r) => <option key={r} value={r}>{cap(r)}</option>)}</select>
          {org.spaces.length > 0 && <select aria-label="Add to space" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>{org.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">No space yet</option></select>}
          <button type="submit" className="s-share-go" data-testid="invite-send">Invite</button>
        </form>
      )}
      {link && <div className="s-invite-link"><code>{link}</code><button type="button" className="s-soft-btn" onClick={() => copy(link)}><Copy size={14} /> Copy link</button></div>}
      {(data?.invites || []).length > 0 && (
        <div className="s-member-list">
          <small className="s-set-sub">Waiting to join</small>
          {data.invites.map((i) => (
            <div key={i.id} className="s-member-row"><div><b>{i.email}</b><small>{cap(i.orgRole)} - expires {ago(i.expiresAt)}</small></div>
              {admin && <button type="button" className="s-soft-btn" onClick={() => run(() => workspacesAPI.revokeInvite(org.id, i.id))}>Withdraw</button>}</div>
          ))}
        </div>
      )}
      {admin && (audit.data || []).length > 0 && (
        <div className="s-member-list" data-testid="audit-list">
          <small className="s-set-sub">Recent activity</small>
          {audit.data.slice(0, 12).map((e) => <div key={e.id} className="s-member-row"><div><b>{e.action.replace('.', ' ').replace('_', ' ')}</b><small>{e.actorName || 'System'} - {ago(e.at)}</small></div></div>)}
        </div>
      )}
      {admin && <OrgPolicy org={org} run={run} />}
      {org.spaces.length > 0 && <TeamSettings org={org} run={run} admin={admin} />}
      <button type="button" className="s-soft-btn s-leave" onClick={() => run(() => workspacesAPI.leave(org.id))}><LogOut size={14} /> Leave organization</button>
    </div>
  );
}

/** Policy toggles and export (mockups C04, C07). Only settings that change what the app does. */
function OrgPolicy({ org, run }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['org-policy', org.id], queryFn: () => workspacesAPI.policy(org.id).then((r) => r.data.policy) });
  const set = (k, v) => run(async () => { await workspacesAPI.setPolicy(org.id, { [k]: v }); qc.invalidateQueries({ queryKey: ['org-policy', org.id] }); });
  const exportAll = () => run(async () => {
    const r = await workspacesAPI.exportOrg(org.id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${org.name.replace(/[^\w-]+/g, '-')}-export.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  if (!data) return null;
  return (
    <div className="s-member-list" data-testid="org-policy">
      <small className="s-set-sub">Policy</small>
      <label className="s-member-row"><div><b>Allow guests</b><small>Guests can be invited into one space and never see the rest.</small></div>
        <input type="checkbox" role="switch" aria-label="Allow guests" checked={data.guests} onChange={(e) => set('guests', e.target.checked)} data-testid="policy-guests" /></label>
      <label className="s-member-row"><div><b>Members can create teams</b><small>Off means only owners and admins can.</small></div>
        <input type="checkbox" role="switch" aria-label="Members can create teams" checked={data.membersCreateTeams} onChange={(e) => set('membersCreateTeams', e.target.checked)} data-testid="policy-teams" /></label>
      <div className="s-member-row"><div><b>Export everything</b><small>Notes, tasks, members and announcements as one file. Recorded in the activity log.</small></div>
        <button type="button" className="s-soft-btn" onClick={exportAll} data-testid="org-export"><Download size={14} /> Export</button></div>
    </div>
  );
}

/** Team settings and leaving (mockups C11, C12): rename, who new people join as, leave, and close without deleting anything. */
function TeamSettings({ org, run, admin }) {
  const [closing, setClosing] = useState(null);
  return (
    <div className="s-member-list" data-testid="team-settings">
      <small className="s-set-sub">Teams</small>
      {org.spaces.map((s) => <TeamRow key={s.id} s={s} run={run} canManage={admin || s.role === 'lead'} closing={closing === s.id} setClosing={(v) => setClosing(v ? s.id : null)} />)}
    </div>
  );
}
function TeamRow({ s, run, canManage, closing, setClosing }) {
  const [name, setName] = useState(s.name);
  const dirty = name.trim() !== s.name && name.trim().length >= 2;
  return (
    <div className="s-member-row" data-testid="team-row" style={{ flexWrap: 'wrap' }}>
      {canManage ? <input aria-label={`Name of ${s.name}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="team-name" />
        : <div><b>{s.name}</b><small>{s.kind === 'office' ? 'Office' : 'Team'}</small></div>}
      {canManage && dirty && <button type="button" className="s-share-go" onClick={() => run(() => workspacesAPI.updateSpace(s.id, { name }))}>Save</button>}
      {canManage && (
        <select aria-label={`New people join ${s.name} as`} value={s.defaultRole || 'member'} onChange={(e) => run(() => workspacesAPI.updateSpace(s.id, { defaultRole: e.target.value }))}>
          <option value="member">Join as member</option><option value="viewer">Join as viewer</option>
        </select>
      )}
      {s.role && <button type="button" className="s-soft-btn" onClick={() => run(() => workspacesAPI.leaveSpace(s.id))} data-testid="team-leave"><LogOut size={14} /> Leave</button>}
      {canManage && !closing && <button type="button" className="s-soft-btn" onClick={() => setClosing(true)} data-testid="team-close">Close</button>}
      {closing && (
        <p className="s-share-msg" style={{ flexBasis: '100%' }}>Close {s.name}? It leaves everyone's switcher. Nothing is deleted and it stays in the export.{' '}
          <button type="button" className="s-share-go" onClick={() => run(() => workspacesAPI.closeSpace(s.id))} data-testid="team-close-confirm">Close team</button>{' '}
          <button type="button" className="s-soft-btn" onClick={() => setClosing(false)}>Keep it</button></p>
      )}
    </div>
  );
}
