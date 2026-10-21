import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X } from 'lucide-react';
import { useAuth, getSavedAccounts, forgetAccount, clearAccountData } from '../context/AuthContext';
import { setToken, clearToken } from '../api/token';
import '../styles/profiles.css';

export const CHOSEN_KEY = 'peblo-profile-chosen';
export const ASK_KEY = 'peblo-profile-ask';
const hueOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initial = (a) => ((a.name || a.email || '?').trim()[0] || '?').toUpperCase();

/**
 * "Who is using Peblo?": pick a profile, like Chrome. Each profile is its own Peblo account saved on this computer
 * (up to 3), so notes, tasks and settings stay separate. Shown when Peblo starts if more than one profile is saved.
 */
export default function ProfilePicker() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [accounts, setAccounts] = useState(() => getSavedAccounts());
  const [manage, setManage] = useState(false);
  const [ask, setAsk] = useState(() => { try { return localStorage.getItem(ASK_KEY) !== '0'; } catch { return true; } });
  const me = user?.id || user?.email;

  const done = () => { try { sessionStorage.setItem(CHOSEN_KEY, '1'); } catch { /* ignore */ } };
  const pick = (a) => {
    done();
    if (a.id === me) { navigate('/', { replace: true }); return; }
    clearAccountData(); // wipes the sign-in token too, so set the chosen profile's token afterwards
    setToken(a.token);
    queryClient.clear();
    done();
    window.location.assign('/');
  };
  const add = () => {
    clearToken();
    clearAccountData();
    queryClient.clear();
    done();
    window.location.assign('/');
  };
  const remove = (a) => { forgetAccount(a.id); setAccounts(getSavedAccounts()); };
  const toggleAsk = (v) => { setAsk(v); try { localStorage.setItem(ASK_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

  return (
    <main className="pp" aria-labelledby="pp-h">
      <span className="pp-brand">peblo</span>
      <h1 id="pp-h">Who is using Peblo?</h1>
      <p className="pp-sub">Each profile keeps its own notes, tasks and settings.</p>
      <ul className="pp-grid">
        {accounts.map((a) => (
          <li key={a.id}>
            <button type="button" className={'pp-card' + (a.id === me ? ' current' : '')} onClick={() => (manage && a.id !== me ? null : pick(a))} aria-label={'Open ' + (a.name || a.email)}>
              <span className="pp-av" style={{ background: 'hsl(' + hueOf(a.id) + ' 70% 86%)', color: 'hsl(' + hueOf(a.id) + ' 55% 26%)' }}>{initial(a)}</span>
              <b>{a.name || a.email}</b>
              <small>{a.name ? a.email : ''}{a.id === me ? (a.name ? ' · ' : '') + 'Signed in now' : ''}</small>
            </button>
            {manage && a.id !== me && <button type="button" className="pp-x" aria-label={'Remove ' + (a.name || a.email) + ' from this computer'} title="Remove from this computer" onClick={() => remove(a)}><X size={14} strokeWidth={2.6} /></button>}
          </li>
        ))}
        {accounts.length < 3 && (
          <li>
            <button type="button" className="pp-card add" onClick={add}>
              <span className="pp-av"><Plus size={28} strokeWidth={2.2} /></span>
              <b>Add profile</b>
              <small>Sign in or create an account</small>
            </button>
          </li>
        )}
      </ul>
      <div className="pp-foot">
        <button type="button" className="pp-link" onClick={() => setManage((m) => !m)}><Pencil size={14} /> {manage ? 'Done' : 'Manage profiles'}</button>
        <label><input type="checkbox" checked={ask} onChange={(e) => toggleAsk(e.target.checked)} /> Show this when Peblo starts</label>
      </div>
    </main>
  );
}
