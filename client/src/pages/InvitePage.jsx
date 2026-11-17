import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, LoaderCircle, Mail } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { workspacesAPI, authAPI } from '../api';
import { getToken } from '../api/token';
import { useAuth } from '../context/AuthContext';
import './verify-email.css';

const COPY = {
  seat_limit: ['This organization is full', 'It has reached its seat limit. Ask an owner or admin to free a seat, then try again.'],
  invalid: ['This invite link is not valid', 'Open it again from the email, or ask for a new invite.'],
  revoked: ['This invite was withdrawn', 'Ask the person who invited you to send a new one.'],
  used: ['This invite was already used', 'Each invite link works once.'],
  expired: ['This link has expired', 'Invites work for 7 days.'],
  member: ['You are already in this organization', 'Nothing to accept.'],
  wrong_account: ['This invite is for another account', 'Sign in with the address it was sent to, then open the link again.'],
  unverified: ['Verify your email first', 'Confirm your address with the link we sent, then come back to accept.'],
  domain_not_allowed: ['This organization uses company accounts', 'Only email addresses at its company domain can join. Ask the person who invited you to invite your work address.'],
};

/** The invite token is carried in the URL fragment (/invite#token=...), which is never sent to a server. Older emails used ?token=..., still read here. */
const tokenFromUrl = () => {
  try { return new URLSearchParams((window.location.hash || '').replace(/^#/, '')).get('token') || new URLSearchParams(window.location.search).get('token') || ''; } catch { return ''; }
};

/** The page an invitation email opens (/invite#token=...), and where a signed-in person finds their own pending invites (/invite). Shows the invite's state, and joins on a press. */
export default function InvitePage() {
  const [token] = useState(tokenFromUrl); // read once; the address bar is cleaned below so the token is not left in history or screenshots
  const [ref, setRef] = useState(() => (token ? { token } : null)); // what names the invite: its token, or its id from the person's own list
  const nav = useNavigate();
  const qc = useQueryClient();
  const [st, setSt] = useState({ s: 'working' });
  const ran = useRef(false);
  const signedIn = !!getToken();
  const auth = useAuth();

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!signedIn) { setSt({ s: 'signin' }); return; } // signed out: the fragment stays so the link still works after signing in
    if (token) {
      try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* the address bar stays as it is */ }
      workspacesAPI.lookupInvite({ token }).then((r) => setSt({ s: r.data.state, ...r.data })).catch(() => setSt({ s: 'invalid' }));
    } else {
      workspacesAPI.myInvites().then((r) => setSt({ s: 'list', invites: r.data.invites || [], verified: r.data.verified !== false, email: r.data.email })).catch(() => setSt({ s: 'list', invites: [], verified: true, failed: true }));
    }
  }, [token, signedIn]);

  const openInvite = async (id) => {
    setSt((x) => ({ ...x, busy: true }));
    try { const r = await workspacesAPI.lookupInvite({ inviteId: id }); setRef({ inviteId: id }); setSt({ s: r.data.state, ...r.data }); }
    catch { setSt((x) => ({ ...x, busy: false, note: 'Could not open that invite.' })); }
  };

  const join = async () => {
    setSt((x) => ({ ...x, busy: true }));
    try { await workspacesAPI.acceptInvite(ref); await qc.invalidateQueries({ queryKey: ['workspaces'] }); setSt((x) => ({ ...x, s: 'joined', busy: false })); }
    catch (e) { setSt((x) => ({ ...x, s: e.response?.data?.state || 'invalid', allowedDomains: e.response?.data?.allowedDomains || x.allowedDomains, busy: false })); }
  };

  const remind = async () => {
    setSt((x) => ({ ...x, busy: true }));
    try { await workspacesAPI.remindInviter(ref); setSt((x) => ({ ...x, busy: false, note: 'Reminder sent. They will see it in their notifications.' })); }
    catch (e) { setSt((x) => ({ ...x, busy: false, note: e.response?.data?.error || 'Could not send the reminder.' })); }
  };
  const resend = async () => {
    setSt((x) => ({ ...x, busy: true }));
    try { await authAPI.sendVerification(); setSt((x) => ({ ...x, busy: false, note: `We sent a new link to ${x.signedInAs || 'your address'}.` })); }
    catch (e) { setSt((x) => ({ ...x, busy: false, note: e.response?.data?.error || 'Could not send the link. Try again in a moment.' })); }
  };
  const inviter = st.inviterName || 'the person who invited you';

  return (
    <main className="ve-page">
      <div className="ve-card" role="status" aria-live="polite" data-testid="invite-card">
        {st.s === 'working' && <><LoaderCircle className="ve-spin" size={38} aria-hidden="true" /><h1>Checking your invite...</h1></>}
        {st.s === 'list' && <><Mail size={42} aria-hidden="true" /><h1>Your invites</h1>
          {!st.verified && <p>Verify {st.email || 'your email'} first. Invites sent to it will show here.</p>}
          {st.verified && !st.invites.length && <p data-testid="invite-none">{st.failed ? 'Could not load your invites. Try again in a moment.' : `No invites are waiting for ${st.email || 'you'}. Open the link from the email, or ask to be invited again.`}</p>}
          {st.verified && st.invites.length > 0 && <ul className="ve-list" data-testid="invite-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, width: '100%' }}>
            {st.invites.map((i) => (
              <li key={i.id} data-testid="invite-item" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', textAlign: 'left' }}>
                <span><b>{i.orgName}</b><br /><small>{i.inviterName ? `From ${i.inviterName}, ` : ''}{i.expired ? 'expired' : `until ${new Date(i.expiresAt).toLocaleDateString()}`}</small></span>
                <button type="button" className="ve-btn" data-testid="invite-open-one" disabled={st.busy} onClick={() => openInvite(i.id)}>{i.expired ? 'See' : 'Open'}</button>
              </li>
            ))}
          </ul>}
          {st.note && <small role="status">{st.note}</small>}
          <Link className="ve-btn" to="/notes">Back to Peblo</Link></>}
        {st.s === 'signin' && <><Mail size={42} aria-hidden="true" /><h1>Sign in to accept</h1><p>Sign in with the email address this invite was sent to. After you sign in, your pending invites are listed on this page (/invite), or open the email link again.</p><Link className="ve-btn" to="/">Go to sign in</Link></>}
        {st.s === 'ready' && <><Mail size={42} aria-hidden="true" /><h1>Join {st.orgName}</h1><p>{st.inviterName ? `${st.inviterName} invited ` : 'You were invited as '}<b>{st.email}</b>{st.inviterName ? ` as a ${st.role || 'member'}` : ''}. You are signed in as {st.email}, and that address is verified.</p><button type="button" className="ve-btn" data-testid="invite-accept" disabled={st.busy} onClick={join}>{st.busy ? 'Joining...' : 'Accept and open'}</button><Link className="ve-btn" to="/notes">Not now</Link></>}
        {st.s === 'joined' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>You joined {st.orgName}</h1><p>Switch to its spaces from the pill at the top of the page.</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>Open Notes</button></>}
        {st.s === 'wrong_account' && <><XCircle size={42} className="ve-bad" aria-hidden="true" /><h1>Wrong account</h1><p>{st.email ? `This invite is for ${st.email}. You are signed in as ${st.signedInAs || 'another account'}.` : COPY.wrong_account[1]}</p>
          <button type="button" className="ve-btn" data-testid="invite-switch" onClick={() => { try { auth?.logout?.(); } finally { nav('/'); } }}>Switch account</button>
          <Link className="ve-btn" to="/notes">Stay here</Link></>}
        {st.s === 'member' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>You are already a member</h1><p>{st.orgName ? `${st.orgName} is already in your spaces.` : COPY.member[1]}</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>{st.orgName ? `Open ${st.orgName}` : 'Open Notes'}</button></>}
        {COPY[st.s] && st.s !== 'wrong_account' && st.s !== 'member' && <><XCircle size={42} className="ve-bad" aria-hidden="true" /><h1>{COPY[st.s][0]}</h1>
          <p>{st.s === 'expired' ? `Invites work for 7 days. Ask ${inviter} to send a new one${st.email ? ` to ${st.email}` : ''}.` : st.s === 'unverified' ? `Confirm ${st.email || 'your address'} with the link we sent, then come back to accept.` : st.s === 'domain_not_allowed' && st.allowedDomains?.length ? `${st.orgName || 'This organization'} only accepts addresses at ${st.allowedDomains.map((d) => `@${d}`).join(', ')}. Ask ${inviter} to invite your work address.` : COPY[st.s][1]}</p>
          {st.s === 'expired' && <button type="button" className="ve-btn" data-testid="invite-remind" disabled={st.busy} onClick={remind}>{`Email ${st.inviterName || 'them'} a reminder`}</button>}
          {st.s === 'unverified' && <button type="button" className="ve-btn" data-testid="invite-resend" disabled={st.busy} onClick={resend}>Resend the link</button>}
          {st.note && <small role="status" data-testid="invite-note">{st.note}</small>}
          <Link className="ve-btn" to={signedIn ? '/notes' : '/'}>{signedIn ? 'Back to Peblo' : 'Go to sign in'}</Link></>}
      </div>
    </main>
  );
}
