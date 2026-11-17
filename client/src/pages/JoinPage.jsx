import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, LoaderCircle, Link2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { workspacesAPI } from '../api';
import api from '../api/client';
import { getToken } from '../api/token';
import './verify-email.css';

const COPY = {
  seat_limit: ['This organization is full', 'It has reached its seat limit. Ask an owner or admin to free a seat, then try again.'],
  invalid: ['This link is not valid', 'Check the link, or ask for a new one.'],
  revoked: ['This link was turned off', 'Ask the person who shared it for a new link.'],
  expired: ['This link has expired', 'Ask the person who shared it for a new link.'],
  full: ['This link is full', 'It has reached the number of people it allows. Ask for a new link.'],
  unverified: ['Confirm your email first', 'Open Settings > Profile to confirm your email address, then open this link again.'],
  domain_not_allowed: ['This organization uses company accounts', 'Only email addresses at its company domain can join. Sign in with your work account, then open this link again.'],
};

/** The token is after the # in new links (never sent to a server or kept in an access log); older links had ?token=. */
const tokenFromUrl = () => {
  try { return new URLSearchParams((window.location.hash || '').replace(/^#/, '')).get('token') || new URLSearchParams(window.location.search).get('token') || ''; } catch { return ''; }
};

/** The page a team join link opens (/join#token=..., older links /join?token=...): shows who is inviting, the link's state, and joins on a press (mockup E04). */
export default function JoinPage() {
  const [token] = useState(tokenFromUrl);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [st, setSt] = useState({ s: 'working' });
  const ran = useRef(false);
  const signedIn = !!getToken();

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!signedIn) { setSt({ s: 'signin' }); return; } // signed out: the address keeps the token so the link still works after signing in
    try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* the address bar stays as it is */ }
    api.post('/workspaces/join-links/lookup', { token }).then((r) => setSt({ ...r.data, s: r.data.state })).catch(() => setSt({ s: 'invalid' }));
  }, [token, signedIn]);

  const join = async () => {
    setSt((x) => ({ ...x, busy: true }));
    try { const r = await workspacesAPI.acceptJoinLink(token); await qc.invalidateQueries({ queryKey: ['workspaces'] }); setSt((x) => ({ ...x, ...r.data, s: 'joined', busy: false })); }
    catch (e) { setSt((x) => ({ ...x, s: e.response?.data?.state || e.response?.data?.code || 'invalid', allowedDomains: e.response?.data?.allowedDomains || x.allowedDomains, busy: false })); }
  };

  return (
    <main className="ve-page">
      <div className="ve-card" role="status" aria-live="polite" data-testid="join-card">
        {st.s === 'working' && <><LoaderCircle className="ve-spin" size={38} aria-hidden="true" /><h1>Checking the link...</h1></>}
        {st.s === 'signin' && <><Link2 size={42} aria-hidden="true" /><h1>Sign in to join</h1><p>Sign in or create your account, then open this link again.</p><Link className="ve-btn" to="/">Go to sign in</Link></>}
        {st.s === 'ready' && <><Link2 size={42} aria-hidden="true" /><h1>Join {st.spaceName || st.orgName}</h1><p>You were invited to <b>{st.orgName}</b>. Your Personal notes and tasks stay private to you.{st.expiresAt ? ` This link works until ${new Date(st.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.` : ''}</p><button type="button" className="ve-btn" data-testid="join-accept" disabled={st.busy} onClick={join}>{st.busy ? 'Joining...' : 'Join'}</button></>}
        {st.s === 'joined' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>You joined {st.spaceName || st.orgName}</h1><p>Switch to it from the pill at the top of the page.</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>Open Notes</button></>}
        {st.s === 'member' && <><CheckCircle2 size={42} className="ve-ok" aria-hidden="true" /><h1>You are already in</h1><p>{st.orgName ? `${st.orgName} is already in your spaces.` : 'Nothing to join.'}</p><button type="button" className="ve-btn" onClick={() => nav('/notes')}>Open Notes</button></>}
        {COPY[st.s] && <><XCircle size={42} className="ve-bad" aria-hidden="true" /><h1>{COPY[st.s][0]}</h1><p data-testid="join-why">{st.s === 'domain_not_allowed' && st.allowedDomains?.length ? `Only addresses at ${st.allowedDomains.map((d) => `@${d}`).join(', ')} can join. Sign in with that account, then open this link again.` : COPY[st.s][1]}</p><Link className="ve-btn" to={signedIn ? '/notes' : '/'}>{signedIn ? 'Back to Peblo' : 'Go to sign in'}</Link></>}
      </div>
    </main>
  );
}
