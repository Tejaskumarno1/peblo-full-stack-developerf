import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { authAPI } from '../api';
import '../styles/auth.css';

/** The page the "reset your password" email opens (/reset-password?token=...). Uses the sign-in screen's look, so it follows the Style setting. */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [token] = useState(() => params.get('token') || '');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const scrubbed = useRef(false);

  // Take the secret out of the address bar and history as soon as the page has read it.
  useEffect(() => {
    if (scrubbed.current) return;
    scrubbed.current = true;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (password.length < 8) { setError('Choose a password with at least 8 characters.'); return; }
    if (password !== again) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      await authAPI.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || (err.response ? 'Something went wrong. Try again.' : 'Can\'t reach the Peblo server. Check your connection and try again.'));
      setBusy(false);
    }
  };

  return (
    <div className="pb-auth">
      <aside className="pb-auth-side" aria-hidden="true">
        <div className="pb-auth-brand">peblo</div>
        <p className="pb-auth-tag">A calm place for notes, tasks and the things you have promised.</p>
      </aside>
      <main className="pb-auth-main">
        {done ? (
          <div className="pb-auth-card pb-auth-done" role="status">
            <div className="pb-auth-brand small">peblo</div>
            <CheckCircle2 size={34} aria-hidden="true" />
            <h1>Password changed</h1>
            <p className="pb-auth-sub">You were signed out everywhere and any access tokens were turned off. Sign in with your new password.</p>
            <Link className="pb-auth-submit pb-auth-linkbtn" to="/">Go to sign in</Link>
          </div>
        ) : !token ? (
          <div className="pb-auth-card pb-auth-done" role="alert">
            <div className="pb-auth-brand small">peblo</div>
            <h1>This link is incomplete</h1>
            <p className="pb-auth-sub">Open the link from your email again, or ask for a new one from the sign-in screen.</p>
            <Link className="pb-auth-submit pb-auth-linkbtn" to="/">Go to sign in</Link>
          </div>
        ) : (
          <form className="pb-auth-card" onSubmit={submit} noValidate>
            <div className="pb-auth-brand small">peblo</div>
            <h1>Choose a new password</h1>
            <p className="pb-auth-sub">Pick something you have not used elsewhere. You will be signed out on every device.</p>
            <label className="pb-auth-field">
              <span>New password</span>
              <div className="pb-auth-pw">
                <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" required autoFocus />
                <button type="button" className="pb-auth-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="pb-auth-field">
              <span>Repeat the new password</span>
              <input type={show ? 'text' : 'password'} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
            </label>
            <div className="pb-auth-error" role="alert" aria-live="polite">{error}</div>
            <button type="submit" className="pb-auth-submit" disabled={busy || !password || !again}>{busy ? 'Saving…' : 'Change password'}</button>
            <p className="pb-auth-switch"><Link className="pb-auth-link" to="/">Back to sign in</Link></p>
          </form>
        )}
      </main>
    </div>
  );
}
