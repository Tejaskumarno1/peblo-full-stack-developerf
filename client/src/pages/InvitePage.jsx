import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, LoaderCircle, Mail } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { workspacesAPI } from '../api';
import { getToken } from '../api/token';
import { useAuth } from '../context/AuthContext';
import './verify-email.css';

const COPY = {
  invalid: ['This invite link is not valid', 'Open it again from the email, or ask for a new invite.'],
  revoked: ['This invite was withdrawn', 'Ask the person who invited you to send a new one.'],
  used: ['This invite was already used', 'Each invite link works once.'],
  expired: ['This invite expired', 'Invites last 7 days. Ask for a new one.'],
  member: ['You are already in this organization', 'Nothing to accept.'],
  wrong_account: ['This invite is for another account', 'Sign in with the address it was sent to, then open the link again.'],
  unverified: ['Confirm your email first', 'Open Settings > Profile to confirm your email address, then open this link again.'],
};

/** The page an invitation email opens (/invite?token=...). Shows the invite's state, and joins on a press. */
export default function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const nav = useNavigate();
  const qc = useQueryClient();
  const [st, setSt] = useState({ s: 'working' });
  const ran = useRef(false);
  const signedIn = !!getToken();
  const auth = useAuth();

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!signedIn) { setSt({ s: 'signin' }); return; }
    workspacesAPI.lookupInvite(token).then((r) => setSt({ s: r.data.state, ...r.data })).catch(() => setSt({ s: 'invalid' }));
  }, [token, signedIn]);

  const join = async () => {
    setSt((x) => ({ ...x, busy: true }));
    try { await workspacesAPI.acceptInvite(token); await qc.invalidateQueries({ queryKey: ['workspaces'] }); setSt((x) => ({ ...x, s: 'joined', busy: false })); }
    catch (e) { setSt((x) => ({ ...x, s: e.response?.data?.state || 'invalid', busy: false })); }
  };

  return (
    <main className="ve-page">
      <div className="ve-card" role="status" aria-live="polite" data-testid="invite-card">
        {st.s === 'working' && <><LoaderCircle className="ve-spin" size={38} aria-hidden="true" /><h1>Checking your invite...</h1></>}
        {st.s === 'signin' && <><Mail size={42} aria-hidden="true" /><h1>Sign in to accept</h1><p>Sign in with the email address this invite was sent to, then open the link again.</p><Link className="ve-btn" to="/">Go to sign in</Link></>}
        {st.s === 'ready' && <><Mail size={42} aria-hidden="true" /><h1>Join {st.orgName}</h1><p>You were invited as <b>{st.email}</b>. Joining gives you access to the spaces you were added to. Your Personal notes and tasks stay private.</p><button type="button" className="ve-btn" data-testid="invite-accept" disabled={st.busy} onClick={join}>{st.busy ? 'Joining...' : 'Join organization'}</button></>}
        {st.s === 'joined' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>You joined {st.orgName}</h1><p>Switch to its spaces from the pill at the top of the page.</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>Open Notes</button></>}
        {st.s === 'wrong_account' && <><XCircle size={42} className="ve-bad" aria-hidden="true" /><h1>{COPY.wrong_account[0]}</h1><p>{COPY.wrong_account[1]}</p>
          <button type="button" className="ve-btn" data-testid="invite-switch" onClick={() => { try { auth?.logout?.(); } finally { nav('/'); } }}>Switch account</button>
          <Link className="ve-btn" to="/notes">Stay here</Link></>}
        {st.s === 'member' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>{COPY.member[0]}</h1><p>{st.orgName ? `${st.orgName} is already in your spaces.` : COPY.member[1]}</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>Open Notes</button></>}
        {COPY[st.s] && st.s !== 'wrong_account' && st.s !== 'member' && <><XCircle size={42} className="ve-bad" aria-hidden="true" /><h1>{COPY[st.s][0]}</h1><p>{COPY[st.s][1]}</p><Link className="ve-btn" to={signedIn ? '/notes' : '/'}>{signedIn ? 'Back to Peblo' : 'Go to sign in'}</Link></>}
      </div>
    </main>
  );
}
