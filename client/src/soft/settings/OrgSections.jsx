/** The Organization settings pages now live in OrgPages.jsx (mockups C01-C16). This file adds the Round 3 pages:
 *  - SignInRulesPage (FM24): the company email domains an owner allows for invites and join links
 *  - GroupsPage (FM23): named groups of members, used to give a task or an Office note to several people at once */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Users, Plus, Trash2, Pencil, X } from 'lucide-react';
import api from '../../api/client';
import { workspacesAPI } from '../../api';
import { useActiveOrg } from './OrgPages';
import { Card } from './ui';
import '../orgpages.css';

export { OrgsPage as OrganizationsSection } from './OrgPages';

const errOf = (e, fallback) => e?.response?.data?.error || fallback;

/** FM24: "Sign-in rules". Owners pick the company domains; everyone else sees the rule. */
export function SignInRulesPage() {
  const { org, owner, isLoading } = useActiveOrg();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['org-policy', org?.id], enabled: !!org, queryFn: () => workspacesAPI.policy(org.id).then((r) => r.data.policy) });
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (isLoading) return <Card title="Sign-in rules"><p className="og-note">Loading...</p></Card>;
  if (!org) return <Card title="Sign-in rules" hint="Create or join an organization first." />;
  const current = data?.allowedDomains || [];
  const text = draft ?? current.join(', ');
  const save = async (list) => {
    setBusy(true); setMsg('');
    try {
      const r = await workspacesAPI.setPolicy(org.id, { allowedDomains: list });
      await qc.invalidateQueries({ queryKey: ['org-policy', org.id] });
      setDraft(null);
      const n = r.data?.outside;
      setMsg(list.length ? `Saved. Only ${list.map((d) => `@${d}`).join(', ')} can be invited or use a join link.${n ? ` ${n} ${n === 1 ? 'person already in uses' : 'people already in use'} another address; they stay.` : ''}` : 'Saved. Any email address can be invited again.');
    } catch (e) { setMsg(errOf(e, 'Could not save the sign-in rules.')); }
    setBusy(false);
  };
  const parsed = text.split(/[\s,;]+/).map((d) => d.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean);
  return (
    <div className="og-cols" data-testid="org-signin-rules">
      <section className="og-card" aria-label="Sign-in rules">
        <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={18} /> Company email domains</h2>
        <p>When this list is not empty, only people whose email address ends in one of these domains can be invited, accept an invite or join with a link. Guests too. People already in the organization are not removed.</p>
        {owner ? (
          <>
            <label className="og-note" htmlFor="org-domains">Domains, separated by commas (for example acme.com, acme.co.uk)</label>
            <input id="org-domains" data-testid="org-domains" className="og-input" style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--s-line, #ddd)', background: 'var(--s-surface, #fff)', color: 'inherit' }}
              value={text} placeholder="Anyone can join (no rule)" maxLength={1200} onChange={(e) => setDraft(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="og-btn" data-testid="org-domains-save" disabled={busy || draft === null} onClick={() => save(parsed)}>{busy ? 'Saving...' : 'Save'}</button>
              {current.length > 0 && <button type="button" className="og-btn white" data-testid="org-domains-clear" disabled={busy} onClick={() => save([])}>Allow any address</button>}
            </div>
          </>
        ) : (
          <p data-testid="org-domains-readonly">{current.length ? `Only ${current.map((d) => `@${d}`).join(', ')} can join.` : 'Anyone can be invited. Only an owner can change this.'}</p>
        )}
        {msg && <p className="og-note" role="status" data-testid="org-domains-msg">{msg}</p>}
      </section>
      <section className="og-card tone" style={{ background: 'var(--s-sky)' }}>
        <h2>Single sign-on</h2>
        <p>Signing in through your company's identity provider (SSO) is not available yet. The domain rule above is the way to keep the organization to company accounts.</p>
      </section>
    </div>
  );
}

/** FM23: groups of members. Owners and admins manage them; members can see them. */
export function GroupsPage() {
  const { org, isLoading } = useActiveOrg();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['org-groups', org?.id], enabled: !!org && org.role !== 'guest', queryFn: () => api.get(`/workspaces/orgs/${org.id}/groups`).then((r) => r.data) });
  const members = useQuery({ queryKey: ['org-members', org?.id], enabled: !!org && org.role !== 'guest', queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const [editing, setEditing] = useState(null); // null | { id?, name, userIds }
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (isLoading) return <Card title="Groups"><p className="og-note">Loading...</p></Card>;
  if (!org) return <Card title="Groups" hint="Create or join an organization first." />;
  if (org.role === 'guest') return <Card title="Groups" hint="Guests cannot see groups." />;
  const canManage = !!groups.data?.canManage;
  const people = (members.data?.members || []).filter((m) => m.role !== 'guest' && m.status !== 'paused');
  const refresh = () => qc.invalidateQueries({ queryKey: ['org-groups', org.id] });
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      if (editing.id) await api.patch(`/workspaces/orgs/${org.id}/groups/${editing.id}`, { name: editing.name, userIds: editing.userIds });
      else await api.post(`/workspaces/orgs/${org.id}/groups`, { name: editing.name, userIds: editing.userIds });
      setEditing(null); await refresh();
    } catch (e) { setMsg(errOf(e, 'Could not save the group.')); }
    setBusy(false);
  };
  const remove = async (g) => {
    if (!window.confirm(`Delete the group ${g.name}? Tasks and notes already given to its members stay with them.`)) return;
    try { await api.delete(`/workspaces/orgs/${org.id}/groups/${g.id}`); await refresh(); } catch (e) { setMsg(errOf(e, 'Could not delete the group.')); }
  };
  const toggle = (uid) => setEditing((x) => ({ ...x, userIds: x.userIds.includes(uid) ? x.userIds.filter((u) => u !== uid) : [...x.userIds, uid] }));
  return (
    <div className="og-cols" data-testid="org-groups">
      <section className="og-card" aria-label="Groups">
        <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Users size={18} /> Groups</h2>
        <p>A group is a shortcut: give a task or an Office note to a group and each of its members who is in that team gets it.</p>
        {groups.isLoading && <p className="og-note">Loading...</p>}
        {groups.data && groups.data.groups.length === 0 && <p className="og-note" data-testid="groups-none">No groups yet.</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {(groups.data?.groups || []).map((g) => (
            <li key={g.id} className="og-row" data-testid="group-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="txt" style={{ flex: 1 }}><b>{g.name}</b><small>{g.size} {g.size === 1 ? 'member' : 'members'}{g.members.length ? `: ${g.members.slice(0, 5).map((m) => m.name.split(' ')[0]).join(', ')}${g.members.length > 5 ? '…' : ''}` : ''}</small></div>
              {canManage && <button type="button" className="og-btn white" aria-label={`Edit ${g.name}`} data-testid="group-edit" onClick={() => setEditing({ id: g.id, name: g.name, userIds: g.members.map((m) => m.userId) })}><Pencil size={14} /></button>}
              {canManage && <button type="button" className="og-btn white" aria-label={`Delete ${g.name}`} data-testid="group-delete" onClick={() => remove(g)}><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
        {canManage && !editing && <button type="button" className="og-btn" style={{ alignSelf: 'flex-start', marginTop: 10 }} data-testid="group-new" onClick={() => setEditing({ name: '', userIds: [] })}><Plus size={15} /> New group</button>}
        {msg && <p className="og-note" role="alert">{msg}</p>}
      </section>
      {editing && (
        <section className="og-card" aria-label={editing.id ? 'Edit group' : 'New group'} data-testid="group-editor">
          <h2 style={{ display: 'flex', justifyContent: 'space-between' }}>{editing.id ? 'Edit group' : 'New group'}<button type="button" className="og-btn white" aria-label="Close" onClick={() => setEditing(null)}><X size={14} /></button></h2>
          <label className="og-note" htmlFor="group-name">Name</label>
          <input id="group-name" data-testid="group-name" maxLength={60} value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--s-line, #ddd)', background: 'var(--s-surface, #fff)', color: 'inherit' }} />
          <p className="og-note">Members ({editing.userIds.length})</p>
          <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
            {people.map((m) => (
              <label key={m.userId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" data-testid="group-member" checked={editing.userIds.includes(m.userId)} onChange={() => toggle(m.userId)} />
                <span>{m.name}{m.email ? <small style={{ opacity: 0.7 }}> · {m.email}</small> : null}</span>
              </label>
            ))}
          </div>
          <button type="button" className="og-btn" style={{ alignSelf: 'flex-start', marginTop: 10 }} data-testid="group-save" disabled={busy || editing.name.trim().length < 2} onClick={save}>{busy ? 'Saving...' : 'Save group'}</button>
        </section>
      )}
    </div>
  );
}
