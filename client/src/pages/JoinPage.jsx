import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, LoaderCircle, Link2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { workspacesAPI } from '../api';
import { getToken } from '../api/token';
import './verify-email.css';

const COPY = {
  invalid: ['This link is not valid', 'Check the link, or ask for a new one.'],
  revoked: ['This link was turned off', 'Ask the person who shared it for a new link.'],
  expired: ['This link has expired', 'Ask the person who shared it for a new link.'],
  full: ['This link is full', 'It has reached the number of people it allows. Ask for a new link.'],
  unverified: ['Confirm your email first', 'Open Settings > Profile to confirm your email address, then open this link again.'],
};

/** The page a team join link opens (/join?token=...): shows who is inviting, the link's state, and joins on a press (mockup E04). */
export default function JoinPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const nav = useNavigate();
  const qc = useQueryClient();
  const [st, setSt] = useState({ s: 'working' });
  const ran = useRef(false);
  const signedIn = !!getToken();

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!signedIn) { setSt({ s: 'signin' }); return; }
    workspacesAPI.lookupJoinLink(token).then((r) => setSt({ ...r.data, s: r.data.state })).catch(() => setSt({ s: 'invalid' }));
  }, [token, signedIn]);

  const join = async () => {
    setSt((x) => ({ ...x, busy: true }));
    try { const r = await workspacesAPI.acceptJoinLink(token); await qc.invalidateQueries({ queryKey: ['workspaces'] }); setSt((x) => ({ ...x, ...r.data, s: 'joined', busy: false })); }
    catch (e) { setSt((x) => ({ ...x, s: e.response?.data?.state || 'invalid', busy: false })); }
  };

  return (
    <main className="ve-page">
      <div className="ve-card" role="status" aria-live="polite" data-testid="join-card">
        {st.s === 'working' && <><LoaderCircle className="ve-spin" size={38} aria-hidden="true" /><h1>Checking the link...</h1></>}
        {st.s === 'signin' && <><Link2 size={42} aria-hidden="true" /><h1>Sign in to join</h1><p>Sign in or create your account, then open this link again.</p><Link className="ve-btn" to="/">Go to sign in</Link></>}
        {st.s === 'ready' && <><Link2 size={42} aria-hidden="true" /><h1>Join {st.spaceName || st.orgName}</h1><p>You were invited to <b>{st.orgName}</b>. Your Personal notes and tasks stay private to you.{st.expiresAt ? ` This link works until ${new Date(st.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.` : ''}</p><button type="button" className="ve-btn" data-testid="join-accept" disabled={st.busy} onClick={join}>{st.busy ? 'Joining...' : 'Join'}</button></>}
        {st.s === 'joined' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>You joined {st.spaceName || st.orgName}</h1><p>Switch to it from the pill at the top of the page.</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>Open Notes</button></>}
        {st.s === 'member' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>You are already in</h1><p>{st.orgName ? `${st.orgName} is already in your spaces.` : 'Nothing to join.'}</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>Open Notes</button></>}
        {COPY[st.s] && <><XCircle size={42} className="ve-bad" aria-hidden="true" /><h1>{COPY[st.s][0]}</h1><p>{COPY[st.s][1]}</p><Link className="ve-btn" to={signedIn ? '/notes' : '/'}>{signedIn ? 'Back to Peblo' : 'Go to sign in'}</Link></>}
      </div>
    </main>
  );
}
