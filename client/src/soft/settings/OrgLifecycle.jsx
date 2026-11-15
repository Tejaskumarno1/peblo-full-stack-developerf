import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, RotateCcw, Trash2, UserMinus } from 'lucide-react';
import { workspacesAPI } from '../../api';
import { useSwitchSpace, useCurrentSpace } from '../spaces';
import { OrgDialog as Dialog } from './OrgPages';

/*
 * Team and member lifecycle UI (audit R6, R8, R15, R16). Server: server/src/routes/teamAdmin.ts and the guest/seat rules in routes/orgs.ts.
 * Kept out of OrgPages.jsx so that file only gets small hook-ins.
 */
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const dayText = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Who could receive a person's notes: active, non-guest members of the organization. */
function useReceivers(org, exceptId) {
  const { data } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  return (data?.members || []).filter((m) => m.status === 'active' && m.role !== 'guest' && m.userId !== exceptId);
}

/** In the "Remove member" dialog: hand the person's notes (also private Office notes) to someone, or leave them with the team. Shown to owners and admins only. */
export function NotesHandoverPicker({ org, userId, first, value, onChange }) {
  const people = useReceivers(org, userId);
  const { data } = useQuery({ queryKey: ['notes-summary', org.id, userId], queryFn: () => workspacesAPI.notesSummary(org.id, userId).then((r) => r.data) });
  if (!data || !data.total) return null;
  const priv = data.spaces.reduce((a, s) => a + (s.private || 0), 0);
  return (
    <div data-testid="notes-handover-pick">
      <div className="og-cap">{first}'s notes in team spaces ({data.total})</div>
      <div className="og-chips">
        <button type="button" className={`og-chip${!value ? ' on' : ''}`} aria-pressed={!value} onClick={() => onChange('')}>Leave with the team</button>
        {people.map((p) => <button key={p.userId} type="button" className={`og-chip${value === p.userId ? ' on' : ''}`} aria-pressed={value === p.userId} data-testid="notes-handover-to" onClick={() => onChange(p.userId)}>Hand to {p.name.split(' ')[0]}</button>)}
      </div>
      {priv > 0 && <p className="og-note">{priv} {priv === 1 ? 'is a private Office note' : 'are private Office notes'}. Unless you hand them over, nobody can read them.</p>}
    </div>
  );
}

/** Hand over a person's notes after they have already gone (the list of former members on the Members page). */
export function HandoverNotesDialog({ org, from, name, onClose, run }) {
  const people = useReceivers(org, from);
  const { data } = useQuery({ queryKey: ['notes-summary', org.id, from], queryFn: () => workspacesAPI.notesSummary(org.id, from).then((r) => r.data) });
  const [to, setTo] = useState('');
  const [result, setResult] = useState(null);
  const go = async () => { if (to) await run(async () => { const r = await workspacesAPI.handoverNotes(org.id, from, { toUserId: to }); setResult(r.data); }); };
  return (
    <Dialog icon={FileText} tone="sky" title={`Hand over ${name}'s notes`} onClose={onClose} narrow>
      {result ? (
        <>
          <p className="og-note" data-testid="notes-handover-done">{result.moved} note{result.moved === 1 ? '' : 's'} handed over.{result.skipped?.length ? ` Not moved, because the receiver is not in ${result.skipped.map((s) => s.name).join(', ')}.` : ''}</p>
          <div className="og-btns"><button type="button" className="og-btn pri" onClick={onClose}>Done</button></div>
        </>
      ) : (
        <>
          <p className="og-note">{data ? `${data.total} note${data.total === 1 ? '' : 's'} in ${data.spaces.map((s) => s.name).join(', ') || 'no spaces'}.` : 'Loading...'} The receiver becomes the author. Only people in the same team or Office can receive its notes.</p>
          <div className="og-chips">{people.map((p) => <button key={p.userId} type="button" className={`og-chip${to === p.userId ? ' on' : ''}`} aria-pressed={to === p.userId} onClick={() => setTo(p.userId)}>{p.name}</button>)}</div>
          <div className="og-btns"><button type="button" className="og-btn pri" disabled={!to || !data?.total} onClick={go} data-testid="notes-handover-go">Hand over</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
        </>
      )}
    </Dialog>
  );
}

/** A card on the Members page: people who wrote notes here and are no longer members. */
export function FormerMembersCard({ org, run }) {
  const [pick, setPick] = useState(null);
  const { data } = useQuery({ queryKey: ['orphaned-notes', org.id], queryFn: () => workspacesAPI.orphanedNotes(org.id).then((r) => r.data) });
  const qc = useQueryClient();
  const people = data?.people || [];
  if (!people.length) return null;
  return (
    <section className="og-card" aria-label="Notes of former members" data-testid="former-members">
      <h2>Notes of former members</h2>
      <p>These people left or were removed. Their notes in team spaces are still here; private Office notes cannot be read by anyone until you hand them over.</p>
      <div className="og-rows">
        {people.map((p) => (
          <div key={p.userId} className="og-row"><div className="txt"><b>{p.name}</b><small>{p.notes} note{p.notes === 1 ? '' : 's'}</small></div>
            <button type="button" className="og-btn white" data-testid="former-handover" onClick={() => setPick(p)}>Hand over</button></div>
        ))}
      </div>
      {pick && <HandoverNotesDialog org={org} from={pick.userId} name={pick.name} run={run} onClose={() => { setPick(null); qc.invalidateQueries({ queryKey: ['orphaned-notes', org.id] }); }} />}
    </section>
  );
}

/** Guest end date in the members list, with a way for an owner or admin to extend it. */
export function GuestExpiry({ m, org, admin, run }) {
  if (m.role !== 'guest') return null;
  const left = m.guestUntil ? Math.ceil((new Date(m.guestUntil).getTime() - Date.now()) / 86400000) : null;
  const expired = left !== null && left <= 0;
  const extend = (days) => run(() => workspacesAPI.setMember(org.id, m.userId, { guestUntil: new Date(Date.now() + days * 86400000).toISOString() }));
  return (
    <span className="og-guest" data-testid="guest-expiry" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className={`og-tag ${expired ? 'peach' : 'butter'}`}>{left === null ? 'No end date' : expired ? `Ended ${dayText(m.guestUntil)}` : `Until ${dayText(m.guestUntil)} (${left} day${left === 1 ? '' : 's'})`}</span>
      {admin && [7, 30, 90].map((d) => <button key={d} type="button" className="og-btn plain" data-testid={`guest-extend-${d}`} aria-label={`Extend ${m.name} by ${d} days`} onClick={() => extend(d)}>+{d}d</button>)}
    </span>
  );
}

/** The people of one team, each with "Remove from team" (a lead, or an owner/admin). The server refuses to remove the only lead. */
export function TeamMemberList({ s, org, me, canManage, run }) {
  const { data } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const [confirm, setConfirm] = useState(null);
  const [note, setNote] = useState('');
  const people = (data?.members || []).map((m) => ({ ...m, here: (m.spaces || []).find((x) => x.id === s.id) })).filter((m) => m.here && m.status === 'active');
  const leads = people.filter((m) => m.here.role === 'lead').length;
  const remove = async (m) => {
    setNote('');
    let notes = 0;
    const ok = await run(async () => { const r = await workspacesAPI.removeFromSpace(s.id, m.userId); notes = r.data.notes || 0; });
    setConfirm(null);
    if (ok && notes > 0) setNote(`${m.name} wrote ${notes} note${notes === 1 ? '' : 's'} here. An owner or admin can hand them over from Members.`);
  };
  if (!people.length) return null;
  return (
    <div data-testid="team-members">
      <div className="og-cap">People in {s.name}</div>
      <div className="og-rows">
        {people.map((m) => {
          const self = m.userId === me;
          const onlyLead = m.here.role === 'lead' && leads <= 1;
          return (
            <div key={m.userId} className="og-row" data-testid="team-member-row">
              <div className="txt"><b>{m.name}{self ? ' (you)' : ''}</b><small>{cap(m.here.role)}</small></div>
              {canManage && !self && (confirm === m.userId
                ? <span className="og-chips"><button type="button" className="og-btn rose" data-testid="team-remove-confirm" onClick={() => remove(m)}>Remove {m.name.split(' ')[0]}</button><button type="button" className="og-btn ghost" onClick={() => setConfirm(null)}>Keep</button></span>
                : <button type="button" className="og-btn plain" data-testid="team-remove" disabled={onlyLead} title={onlyLead ? 'This is the only lead. Make someone else a lead first.' : undefined} aria-label={`Remove ${m.name} from ${s.name}`} onClick={() => setConfirm(m.userId)}><UserMinus size={15} /> Remove from team</button>)}
            </div>
          );
        })}
      </div>
      {confirm && <p className="og-note">They lose access to this team. Their open tasks here become unassigned. Their other teams and Personal notes are not touched.</p>}
      {note && <p className="og-note" role="status">{note}</p>}
    </div>
  );
}

/** Closed teams a lead or admin can reopen (R16). Nothing was deleted when they were closed. */
export function ClosedTeams({ org, run }) {
  const { data } = useQuery({ queryKey: ['closed-spaces', org.id], queryFn: () => workspacesAPI.closedSpaces(org.id).then((r) => r.data) });
  const list = data?.spaces || [];
  if (!list.length) return null;
  return (
    <section className="og-card" aria-label="Closed teams" data-testid="closed-teams" style={{ gridColumn: '1 / -1' }}>
      <h2>Closed teams</h2>
      <p>Closing hides a team. Its notes and tasks are kept, and reopening brings everything back for the same people.</p>
      <div className="og-rows">
        {list.map((c) => (
          <div key={c.id} className="og-row" data-testid="closed-team-row"><div className="txt"><b>{c.name}</b><small>Closed {dayText(c.closedAt)}</small></div>
            <button type="button" className="og-btn white" data-testid="team-reopen" onClick={() => run(() => workspacesAPI.reopenSpace(c.id))}><RotateCcw size={15} /> Reopen</button></div>
        ))}
      </div>
    </section>
  );
}

/** Delete organization (R16). Soft close: the data is kept for 30 days. The sole owner types the name; other active members block it. */
export function DeleteOrgDialog({ org, me, onClose, run }) {
  const switchTo = useSwitchSpace();
  const current = useCurrentSpace();
  const { data } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => workspacesAPI.members(org.id).then((r) => r.data) });
  const others = (data?.members || []).filter((m) => m.userId !== me && m.status === 'active');
  const [typed, setTyped] = useState('');
  const go = async () => {
    const ok = await run(() => workspacesAPI.deleteOrg(org.id, typed.trim()));
    if (ok) { if (org.spaces.some((x) => x.id === current)) switchTo(null); onClose(); }
  };
  return (
    <Dialog icon={Trash2} tone="peach" title={`Delete ${org.name}?`} onClose={onClose} narrow>
      <div className="og-banner butter"><b>It closes for everyone at once</b><span>Teams, the Office, notes and tasks disappear from every switcher. Pending invites and join links stop working. Nothing is erased for 30 days, and then it is removed. Export it first if you want a copy.</span></div>
      {others.length > 0 && <div className="og-banner rose" data-testid="delete-org-blocked"><b>{others.length} other active member{others.length === 1 ? ' is' : 's are'} still here</b><span>Remove them from Members first, or transfer ownership to someone who should decide.</span></div>}
      <p className="og-note">Type the organization name to confirm.</p>
      <input className="og-field" aria-label="Organization name" placeholder={org.name} value={typed} onChange={(e) => setTyped(e.target.value)} />
      <div className="og-btns"><button type="button" className="og-btn rose" disabled={typed.trim() !== org.name || others.length > 0} onClick={go} data-testid="delete-org-confirm">Delete {org.name}</button><button type="button" className="og-btn ghost" onClick={onClose}>Cancel</button></div>
    </Dialog>
  );
}
