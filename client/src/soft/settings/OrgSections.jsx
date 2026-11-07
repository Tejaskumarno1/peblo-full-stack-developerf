import { useState } from 'react';
import { Building2, Users, Copy, X, LogOut } from 'lucide-react';
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
      <button type="button" className="s-soft-btn s-leave" onClick={() => run(() => workspacesAPI.leave(org.id))}><LogOut size={14} /> Leave organization</button>
    </div>
  );
}
