import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthScreen from '../components/AuthScreen';
import api from '../api/client';

// The page an app (Claude, Cursor...) sends you to when you click "Connect": sign in to Peblo, then allow or refuse.
export default function OAuthConsent() {
  const { loading, user } = useAuth();
  const [params] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('write');
  const [busy, setBusy] = useState(false);

  const q = {
    client_id: params.get('client_id') || '',
    redirect_uri: params.get('redirect_uri') || '',
    code_challenge: params.get('code_challenge') || '',
    state: params.get('state') || '',
  };

  useEffect(() => {
    if (!user) return;
    api.get('/oauth/info', { params: { client_id: q.client_id, redirect_uri: q.redirect_uri } })
      .then((r) => setInfo(r.data))
      .catch((e) => setError(e.response?.data?.error || 'This connection request is not valid. Start again from the app.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading) return null;
  if (!user) return <AuthScreen />;

  const decide = async (deny) => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/oauth/approve', { ...q, scope, deny });
      const target = String(r.data?.redirect || '');
      if (!target || /^\s*(javascript|data|vbscript):/i.test(target)) throw new Error('Invalid redirect');
      window.location.href = target;
    } catch (e) {
      setError(e.response?.data?.error || 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="pb-consent">
      <style>{`
        .pb-consent{min-height:100vh;background:#fffdf8;color:#2a1f17;font-family:'Figtree',system-ui,sans-serif;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box}
        .pb-consent .card{width:min(460px,100%);background:#fff;border-radius:28px;box-shadow:0 20px 50px rgba(60,40,20,.16),inset 0 0 0 1.5px #eadfce;padding:28px;display:flex;flex-direction:column;gap:16px}
        .pb-consent .brand{display:flex;align-items:center;gap:10px;font-weight:800}
        .pb-consent .brand i{width:26px;height:26px;border-radius:50%;background:#c8421d;display:inline-block}
        .pb-consent h1{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-size:26px;line-height:1.15;margin:0}
        .pb-consent p{margin:0;color:#6b5b4e;font-size:14.5px;line-height:1.5;font-weight:600}
        .pb-consent .opt{display:flex;gap:12px;align-items:flex-start;border-radius:18px;background:#f9f3e9;padding:12px 14px;cursor:pointer;border:2px solid transparent}
        .pb-consent .opt.on{border-color:#2a1f17;background:#fff}
        .pb-consent .opt b{display:block;font-size:15px}
        .pb-consent .opt span{font-size:13px;color:#6b5b4e;font-weight:600}
        .pb-consent .can{font-size:13px;color:#6b5b4e;font-weight:600;background:#f4ede2;border-radius:14px;padding:10px 14px}
        .pb-consent .row{display:flex;gap:10px}
        .pb-consent button{border:none;border-radius:999px;padding:13px 20px;font:800 15px 'Figtree',system-ui,sans-serif;cursor:pointer}
        .pb-consent button.go{flex:1;background:#c8421d;color:#fff}.pb-consent button.no{background:#f4ede2;color:#2a1f17}
        .pb-consent button:disabled{opacity:.6;cursor:default}
        .pb-consent .err{background:#fde3e0;color:#7a1a12;border-radius:14px;padding:10px 14px;font-weight:700;font-size:14px}
      `}</style>
      <main className="card">
        <div className="brand"><i /> Peblo</div>
        {error && !info && <p className="err" role="alert">{error}</p>}
        {info && (
          <>
            <h1>Let {info.name} use your Peblo?</h1>
            <p>You are signed in as {info.email}. {info.name} will send you back to {info.host} afterwards.</p>
            <div role="radiogroup" aria-label="What it can do" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div role="radio" aria-checked={scope === 'write'} tabIndex={0} className={`opt${scope === 'write' ? ' on' : ''}`} onClick={() => setScope('write')} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setScope('write'); }}>
                <div><b>Read and write</b><span>Search and read notes and tasks, add notes, add and tick off tasks.</span></div>
              </div>
              <div role="radio" aria-checked={scope === 'read'} tabIndex={0} className={`opt${scope === 'read' ? ' on' : ''}`} onClick={() => setScope('read')} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setScope('read'); }}>
                <div><b>Read only</b><span>It can look things up but never change anything.</span></div>
              </div>
            </div>
            <div className="can">It can never permanently delete anything (a note it trashes can be restored), change your password or settings, or see your saved AI keys. You can remove its access any time in Settings.</div>
            {error && <p className="err" role="alert">{error}</p>}
            <div className="row">
              <button type="button" className="no" disabled={busy} onClick={() => decide(true)}>Cancel</button>
              <button type="button" className="go" disabled={busy} onClick={() => decide(false)}>{busy ? 'Connecting…' : 'Allow'}</button>
            </div>
          </>
        )}
        {!info && !error && <p>Checking the request…</p>}
      </main>
    </div>
  );
}
