import { useState } from 'react';
import { Eye, EyeOff, MailCheck, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../api';
import '../styles/auth.css';

const POINTS = [
  'Write notes and let Peblo find what is in them',
  'Tasks and a calendar that live beside your notes',
  'Your AI, your keys: local or cloud, your choice',
];

/** Sign in or create an account. Shown whenever nobody is signed in. */
export default function AuthScreen() {
  const { signIn, connectError, retryConnect } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [done, setDone] = useState(null); // { title, text }: shown after a mail was asked for
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const signup = mode === 'signup';
  const forgot = mode === 'forgot';
  const switchMode = () => { setMode(signup ? 'login' : 'signup'); setError(''); };
  const backToSignIn = () => { setMode('login'); setDone(null); setError(''); setPassword(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (signup && password.length < 8) { setError('Choose a password with at least 8 characters.'); return; }
    setBusy(true);
    try {
      if (forgot) {
        const r = await authAPI.forgotPassword(email.trim());
        setDone({ title: 'Check your email', text: r.data?.message || 'If an account exists for that email, a reset link is on its way.' });
        setBusy(false);
        return;
      }
      const r = await signIn(mode, signup ? { name: name.trim(), email, password } : { email, password });
      if (r?.pending) { setDone({ title: 'Check your email', text: r.message }); setBusy(false); }
    } catch (err) {
      setError(err.response?.data?.error || (err.response ? 'Something went wrong. Try again.' : 'Can\'t reach the Peblo server. Is it running?'));
      setBusy(false);
    }
  };

  return (
    <div className="pb-auth">
      <aside className="pb-auth-side" aria-hidden="true">
        <div className="pb-auth-brand">peblo</div>
        <p className="pb-auth-tag">A calm place for notes, tasks and the things you have promised.</p>
        <ul>
          {POINTS.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </aside>

      <main className="pb-auth-main">
        {done ? (
          <div className="pb-auth-card pb-auth-done" role="status">
            <div className="pb-auth-brand small">peblo</div>
            <MailCheck size={34} aria-hidden="true" />
            <h1>{done.title}</h1>
            <p className="pb-auth-sub">{done.text}</p>
            <button type="button" className="pb-auth-submit" onClick={backToSignIn}>Back to sign in</button>
          </div>
        ) : (
        <form className="pb-auth-card" onSubmit={submit} noValidate>
          <div className="pb-auth-brand small">peblo</div>
          <h1>{signup ? 'Create your account' : forgot ? 'Reset your password' : 'Welcome back'}</h1>
          <p className="pb-auth-sub">
            {signup ? 'Your notes and tasks stay in your account, private to you.' : forgot ? 'Enter your email and we will send you a link to choose a new password.' : 'Sign in to pick up where you left off.'}
          </p>

          {connectError && (
            <div className="pb-auth-banner" role="alert">
              <WifiOff size={16} />
              <span>{connectError === 'offline' ? 'Can\'t reach the Peblo server.' : 'The Peblo server had a problem.'}</span>
              <button type="button" onClick={retryConnect}>Try again</button>
            </div>
          )}

          {signup && (
            <label className="pb-auth-field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Ananya Rao" maxLength={80} />
            </label>
          )}

          <label className="pb-auth-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required autoFocus />
          </label>

          {!forgot && (
          <label className="pb-auth-field">
            <span>Password</span>
            <div className="pb-auth-pw">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? 'new-password' : 'current-password'}
                placeholder={signup ? 'At least 8 characters' : 'Your password'}
                required
              />
              <button type="button" className="pb-auth-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          )}

          {mode === 'login' && (
            <div className="pb-auth-forgot"><button type="button" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button></div>
          )}

          <div className="pb-auth-error" role="alert" aria-live="polite">{error}</div>

          <button type="submit" className="pb-auth-submit" disabled={busy || !email.trim() || (!forgot && !password)}>
            {busy ? (signup ? 'Creating account…' : forgot ? 'Sending…' : 'Signing in…') : (signup ? 'Create account' : forgot ? 'Send reset link' : 'Sign in')}
          </button>

          <p className="pb-auth-switch">
            {forgot ? (
              <button type="button" onClick={backToSignIn}>Back to sign in</button>
            ) : (
              <>{signup ? 'Already have an account?' : 'New to Peblo?'}{' '}
              <button type="button" onClick={switchMode}>{signup ? 'Sign in' : 'Create an account'}</button></>
            )}
          </p>
        </form>
        )}
      </main>
    </div>
  );
}
