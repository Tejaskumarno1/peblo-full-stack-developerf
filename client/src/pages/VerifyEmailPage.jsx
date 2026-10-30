import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, LoaderCircle } from 'lucide-react';
import { authAPI } from '../api';
import { getToken } from '../api/token';
import './verify-email.css';

/** The page an email link opens (/verify-email?token=...). Works signed in or out: the link itself is the proof. */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ s: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React runs effects twice in development; a link only works once
    ran.current = true;
    if (!token) { setState({ s: 'bad', error: 'This link is incomplete. Open it again from your email.' }); return; }
    authAPI.verifyEmail(token)
      .then((r) => setState({ s: 'ok', kind: r.data.kind, email: r.data.email }))
      .catch((e) => setState({ s: 'bad', error: e.response?.data?.error || 'Could not check this link. Check your connection and try again.' }));
  }, [token]);

  const signedIn = !!getToken();
  return (
    <main className="ve-page">
      <div className="ve-card" role="status" aria-live="polite">
        {state.s === 'working' && <><LoaderCircle className="ve-spin" size={38} aria-hidden="true" /><h1>Checking your link…</h1></>}
        {state.s === 'ok' && (
          <>
            <CheckCircle2 size={42} className="ve-ok" aria-hidden="true" />
            <h1>{state.kind === 'change' ? 'Your email was changed' : state.kind === 'signup' ? 'Your account is ready' : 'Email confirmed'}</h1>
            <p>{state.kind === 'change' ? <>Your Peblo account now uses <b>{state.email}</b>. Use it the next time you sign in.</> : state.kind === 'signup' ? <><b>{state.email}</b> is confirmed and your account was created. Sign in with the password you chose.</> : <><b>{state.email}</b> is confirmed.</>}</p>
            <Link className="ve-btn" to={signedIn ? '/settings/profile' : '/'}>{signedIn ? 'Back to Settings' : 'Go to sign in'}</Link>
          </>
        )}
        {state.s === 'bad' && (
          <>
            <XCircle size={42} className="ve-bad" aria-hidden="true" />
            <h1>This link did not work</h1>
            <p>{state.error}</p>
            <Link className="ve-btn" to={signedIn ? '/settings/profile' : '/'}>{signedIn ? 'Open Settings' : 'Go to sign in'}</Link>
          </>
        )}
      </div>
    </main>
  );
}
