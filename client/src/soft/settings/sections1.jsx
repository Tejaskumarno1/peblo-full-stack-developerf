import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Sun, Moon, Monitor } from 'lucide-react';
import { useAuth, getSavedAccounts, forgetAccount, clearAccountData } from '../../context/AuthContext';
import { authAPI } from '../../api';
import { getToken, setToken, clearToken } from '../../api/token';
import { Card, Row, Switch, Seg, Confirm, PasswordInput, passwordStrength, useSave } from './ui';
import Avatar from '../../components/Avatar';
import ProfilePage from './ProfilePage';

const initialOf = (u) => (String(u?.name || u?.email || 'You').trim().charAt(0) || 'Y').toUpperCase();
const apiBase = () => import.meta.env.VITE_API_URL || '/api';

/** The Profile page (picture, details, email, sign-in and security). See ProfilePage.jsx. */
export function ProfileSection() {
  return <ProfilePage />;
}

export function AccountsSection() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [accounts, setAccounts] = useState(() => getSavedAccounts());
  const [acctMsg, setAcctMsg] = useState('');
  const [switching, setSwitching] = useState('');
  const me = user?.id || user?.email;
  const others = accounts.filter((a) => a.id !== me);

  // Check the saved sign-in is still good BEFORE leaving this account; an expired one is removed with a clear message.
  const switchTo = async (a) => {
    setSwitching(a.id); setAcctMsg('');
    let status = 0;
    try { status = (await fetch(`${apiBase()}/profile`, { headers: { Authorization: `Bearer ${a.token}` } })).status; } catch { status = -1; }
    setSwitching('');
    if (status === 401) {
      forgetAccount(a.id); setAccounts(getSavedAccounts());
      setAcctMsg(`${a.email} was signed out (the password changed, or it expired). Use "Add another account" to sign in to it again.`);
      return;
    }
    if (status === -1) { setAcctMsg('Could not reach Peblo. Check your connection and try again.'); return; }
    clearAccountData(); // wipes the sign-in token too, so set the other account's token afterwards
    setToken(a.token);
    queryClient.clear();
    window.location.assign('/');
  };
  const addAnother = () => {
    clearToken();
    clearAccountData();
    queryClient.clear();
    window.location.assign('/');
  };
  const remove = (a) => { forgetAccount(a.id); setAccounts(getSavedAccounts()); };
  const removeAll = () => { others.forEach((a) => forgetAccount(a.id)); setAccounts(getSavedAccounts()); setAcctMsg('The other accounts were removed from this device.'); };

  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const strength = passwordStrength(pw.next);
  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 8) return setPwMsg({ ok: false, text: 'The new password must be at least 8 characters.' });
    if (pw.next !== pw.again) return setPwMsg({ ok: false, text: 'The two new passwords do not match.' });
    setPwBusy(true); setPwMsg(null);
    try {
      const { data } = await authAPI.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      if (data?.token) setToken(data.token); // this device stays signed in, every other device is signed out
      if (user) { forgetAccount(me); const list = getSavedAccounts(); localStorage.setItem('peblo-accounts', JSON.stringify([{ id: me, email: user.email, name: user.name || '', avatar: user.avatar || '', token: getToken() }, ...list].slice(0, 3))); }
      setAccounts(getSavedAccounts());
      setPw({ current: '', next: '', again: '' });
      setPwMsg({ ok: true, text: 'Password changed. Your other devices were signed out.' });
    } catch (err) {
      setPwMsg({ ok: false, text: err.response?.data?.error || 'Could not change the password. Try again.' });
    } finally { setPwBusy(false); }
  };

  const signOutEverywhere = async () => {
    try { await authAPI.logoutAll(); } catch { /* signing out here still happens */ }
    logout();
  };

  const [delPw, setDelPw] = useState('');
  const [delWord, setDelWord] = useState('');
  const [delMsg, setDelMsg] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const deleteAccount = async () => {
    if (delWord.trim().toUpperCase() !== 'DELETE') { setDelMsg('Type DELETE in the box first.'); return; }
    if (!delPw) { setDelMsg('Type your password first.'); return; }
    setDelBusy(true); setDelMsg('');
    try { await authAPI.scheduleDeletion({ password: delPw }); forgetAccount(me); logout(); }
    catch (err) { setDelMsg(err.response?.data?.error || 'Could not delete the account.'); }
    finally { setDelBusy(false); }
  };

  return (
    <>
      <Card id="set-accounts" title="Accounts on this device" hint="Switch between accounts without typing a password. Up to three are kept, so one device does not hold a pile of sign-ins. They live in this browser, so remove any you do not need, especially on a shared computer.">
        <ul className="s-set-accts">
          <li className="on">
            <span className="s-set-avatar sm" aria-hidden="true"><Avatar src={user?.avatar} fallback={initialOf(user)} /></span>
            <span className="grow"><b>{user?.name || user?.email}</b><small>{user?.email}</small></span>
            <span className="s-set-pill"><Check size={13} strokeWidth={3} /> Using now</span>
          </li>
          {others.map((a) => (
            <li key={a.id}>
              <span className="s-set-avatar sm" aria-hidden="true"><Avatar src={a.avatar} fallback={initialOf(a)} /></span>
              <span className="grow"><b>{a.name || a.email}</b><small>{a.email}</small></span>
              <button type="button" className="s-outline s-set-btn" onClick={() => switchTo(a)} disabled={!!switching}>{switching === a.id ? 'Checking…' : 'Switch'}</button>
              <button type="button" className="s-link-btn" aria-label={`Remove ${a.email} from this device`} onClick={() => remove(a)}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="s-set-actions">
          <button type="button" className="s-outline s-set-btn" onClick={addAnother} disabled={accounts.length >= 3} title={accounts.length >= 3 ? 'Remove one first (three at most)' : undefined}><Plus size={15} /> Add another account</button>
          {others.length > 0 && <Confirm label="Remove the other accounts" ask="Forget the other accounts on this device?" onYes={removeAll} />}
          {accounts.length >= 3 && <small>Three accounts is the most. Remove one to add another.</small>}
        </div>
        {acctMsg && <p role="status" className="s-set-note">{acctMsg}</p>}
      </Card>

      <Card title="Password">
        <form onSubmit={changePassword} className="s-set-form">
          <Row label="Current password" htmlFor="set-pw0"><PasswordInput id="set-pw0" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Row>
          <Row label="New password" hint="At least 8 characters. A few random words is stronger than one word with symbols." htmlFor="set-pw1">
            <PasswordInput id="set-pw1" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
            {pw.next && <span className={`s-set-meter l${strength.level}`} role="status"><i /><i /><i /><em>{strength.label}</em></span>}
          </Row>
          <Row label="New password again" htmlFor="set-pw2"><PasswordInput id="set-pw2" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required /></Row>
          <div className="s-set-actions">
            <button type="submit" className="s-accent-btn s-set-btn" disabled={pwBusy}>{pwBusy ? 'Changing…' : 'Change password'}</button>
            {pwMsg && <small role={pwMsg.ok ? 'status' : 'alert'} className={pwMsg.ok ? 'ok' : 'bad'}>{pwMsg.text}</small>}
          </div>
        </form>
      </Card>

      <Card title="Sign out" hint="Lost a laptop, or signed in somewhere you should not have? Signing out everywhere ends every sign-in on every device, this one included.">
        <div className="s-set-actions">
          <button type="button" className="s-outline s-set-btn" onClick={() => logout()}>Sign out of this device</button>
          <Confirm label="Sign out everywhere" ask="Sign out of every device, including this one?" onYes={signOutEverywhere} />
        </div>
      </Card>

      <Card title="Delete account" hint="Your account, notes, tasks and shared links are removed 30 days after you ask. Sign in again before then and nothing is lost." tone="peach">
        <p className="s-set-note">Want a copy first? <Link to="/settings/data" className="s-link-btn">Back up your notes</Link> before you delete.</p>
        <Row label="Type DELETE" hint="To show you mean it." htmlFor="set-delword"><input id="set-delword" className="s-set-input" value={delWord} onChange={(e) => setDelWord(e.target.value)} autoComplete="off" /></Row>
        <Row label="Your password" hint="To make sure it is you." htmlFor="set-delpw"><PasswordInput id="set-delpw" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} /></Row>
        <div className="s-set-actions">
          <Confirm danger label="Delete my account" ask="Delete everything after 30 days?" onYes={deleteAccount} busy={delBusy} />
          {delMsg && <small role="alert" className="bad">{delMsg}</small>}
        </div>
      </Card>
    </>
  );
}

const STYLES = [
  { id: 'soft', name: 'Soft Studio', desc: 'Friendly tiles and a floating dock', tags: ['Beginners', 'Visual'] },
  { id: 'river', name: 'River', desc: 'Your day as one timeline, past to future', tags: ['Meetings', 'Planners'] },
  { id: 'orbit', name: 'Orbit', desc: 'A map of what you know, built for studying', tags: ['Students', 'Exams'] },
];
const THEMES = [
  { id: 'light', name: 'Light', icon: Sun },
  { id: 'dark', name: 'Dark', icon: Moon },
  { id: 'midnight', name: 'Midnight', icon: Moon },
  { id: 'system', name: 'System', icon: Monitor },
];

export function AppearanceSection() {
  const { uiStyle, setUiStyle, theme, setTheme, settings } = useAuth();
  const save = useSave();
  return (
    <>
      <Card title="Style" hint="Changes the layout, type and colours of the whole app. Your notes stay exactly the same. Light, dark and midnight work with every style.">
        <div className="style-grid s-set-stylegrid" role="radiogroup" aria-label="Style">
          {STYLES.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={uiStyle === o.id} className={`style-card${uiStyle === o.id ? ' active' : ''}`} onClick={() => save(async () => { setUiStyle(o.id); return true; })}>
              <span className={`style-preview ${o.id}`} aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /><i className="d" /><i className="e" /></span>
              <span className="style-name">{o.name}</span>
              <span className="style-desc">{o.desc}</span>
              <span className="style-tags">{o.tags.map((t) => <span key={t}>{t}</span>)}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Colours" hint="System follows your computer.">
        <div className="settings-theme-grid s-set-themegrid" role="radiogroup" aria-label="Theme">
          {THEMES.map(({ id, name, icon: Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} className={`theme-card${theme === id ? ' active' : ''}`} onClick={() => save(async () => { setTheme(id); return true; })}>
              <span className={`theme-preview ${id === 'midnight' ? 'dark' : id}`} style={id === 'midnight' ? { background: '#000' } : undefined} />
              <span className="s-set-themename"><Icon size={14} /> {name}</span>
            </button>
          ))}
        </div>
        <Row label="Compact" hint="Tighter lists and cards, so more fits on screen.">
          <Switch label="Compact" checked={!!settings?.compact} onChange={(v) => save({ compact: v })} />
        </Row>
      </Card>
    </>
  );
}

const zonesList = () => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']; }
};

export function NotesSection() {
  const { settings, user, updateProfile } = useAuth();
  const save = useSave();
  const device = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
  const zones = zonesList();
  const zone = user?.timezone && user.timezone !== 'UTC' ? user.timezone : (user?.timezone || device || 'UTC');
  const list = zones.includes(zone) ? zones : [zone, ...zones];
  return (
    <>
      <Card title="Writing">
        <Row label="Text size in notes" hint="Only changes what you read and write in a note.">
          <Seg label="Text size" value={settings?.fontSize || 'medium'} onChange={(v) => save({ fontSize: v })} options={[{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }]} />
        </Row>
        <Row label="Check spelling" hint="Underline misspelled words while you type in a note.">
          <Switch label="Check spelling" checked={settings?.spellcheck !== false} onChange={(v) => save({ spellcheck: v })} />
        </Row>
      </Card>
      <Card title="Calendar and time">
        <Row label="Week starts on">
          <Seg label="Week starts on" value={['sun', 'sat'].includes(settings?.weekStart) ? settings.weekStart : 'mon'} onChange={(v) => save({ weekStart: v })} options={[{ id: 'mon', label: 'Monday' }, { id: 'sat', label: 'Saturday' }, { id: 'sun', label: 'Sunday' }]} />
        </Row>
        <Row label="Time zone" hint="Used for reminders, 'today' and the times AI reads in your notes." htmlFor="set-zone">
          <span className="s-set-field">
            <select id="set-zone" className="s-set-input" value={zone} onChange={(e) => save(() => updateProfile({ timezone: e.target.value }))}>
              {list.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select>
            {device && device !== zone && <button type="button" className="s-link-btn" onClick={() => save(() => updateProfile({ timezone: device }))}>Use this device's ({device.replace(/_/g, ' ')})</button>}
          </span>
        </Row>
      </Card>
    </>
  );
}
