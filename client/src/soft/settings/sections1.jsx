import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Sun, Moon, Monitor } from 'lucide-react';
import { useAuth, getSavedAccounts, forgetAccount, clearAccountData } from '../../context/AuthContext';
import { authAPI } from '../../api';
import { getToken, setToken, clearToken } from '../../api/token';
import { Card, Row, Switch, Seg, TextField, Confirm, useSave } from './ui';
import Avatar from '../../components/Avatar';
import { avatarToWebp } from '../../utils/avatar';

const initialOf = (u) => (String(u?.name || u?.email || 'You').trim().charAt(0) || 'Y').toUpperCase();

export function ProfileSection() {
  const { user, updateProfile, settings } = useAuth();
  const save = useSave();
  const fileRef = useRef(null);
  const [pickErr, setPickErr] = useState('');
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPickErr('');
    try { const data = await avatarToWebp(f); save(() => updateProfile({ avatar: data })); }
    catch (err) { setPickErr(err.message || 'Could not use that picture.'); }
  };
  return (
    <>
      <Card title="Your profile" hint="This is how you appear in shared notes and in Peblo.">
        <div className="s-set-who">
          <span className="s-set-avatar big" aria-hidden="true"><Avatar src={user?.avatar} fallback={initialOf(user)} /></span>
          <div>
            <b>{user?.name || 'Your name'}</b>
            <small>{user?.email}</small>
            <div className="s-set-who-actions">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
              <button type="button" className="s-outline s-set-btn" onClick={() => fileRef.current?.click()}>{user?.avatar ? 'Change picture' : 'Add picture'}</button>
              {user?.avatar && <button type="button" className="s-link-btn" onClick={() => save(() => updateProfile({ avatar: '' }))}>Remove</button>}
            </div>
            {pickErr && <small role="alert" style={{ color: 'crimson' }}>{pickErr}</small>}
          </div>
        </div>
        <Row label="Name" htmlFor="set-name"><TextField id="set-name" value={user?.name} maxLength={80} onSave={(v) => v && save(() => updateProfile({ name: v }))} /></Row>
        <Row label="Role" hint="For example Student, Designer, Founder." htmlFor="set-role"><TextField id="set-role" value={settings?.jobTitle} maxLength={80} onSave={(v) => save({ jobTitle: v })} /></Row>
        <Row label="About you" hint="A line or two. AI answers can use it to fit you better." htmlFor="set-bio" stack><TextField id="set-bio" value={settings?.bio} multiline maxLength={400} onSave={(v) => save({ bio: v })} /></Row>
        <Row label="Email" hint="Your sign-in address."><span className="s-set-static">{user?.email}</span></Row>
      </Card>
    </>
  );
}

export function AccountsSection() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [accounts, setAccounts] = useState(() => getSavedAccounts());
  const me = user?.id || user?.email;
  const others = accounts.filter((a) => a.id !== me);

  const switchTo = (a) => {
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

  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 8) return setPwMsg({ ok: false, text: 'The new password must be at least 8 characters.' });
    if (pw.next !== pw.again) return setPwMsg({ ok: false, text: 'The two new passwords do not match.' });
    setPwBusy(true); setPwMsg(null);
    try {
      const { data } = await authAPI.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      setToken(data.token); // this device stays signed in, every other device is signed out
      if (user) { forgetAccount(me); const list = getSavedAccounts(); localStorage.setItem('peblo-accounts', JSON.stringify([{ id: me, email: user.email, name: user.name || '', token: getToken() }, ...list].slice(0, 3))); }
      setAccounts(getSavedAccounts());
      setPw({ current: '', next: '', again: '' });
      setPwMsg({ ok: true, text: 'Password changed. Your other devices were signed out.' });
    } catch (err) {
      setPwMsg({ ok: false, text: err.response?.data?.error || 'Could not change the password. Try again.' });
    } finally { setPwBusy(false); }
  };

  const [outMsg, setOutMsg] = useState('');
  const signOutEverywhere = async () => {
    try { await authAPI.logoutAll(); } catch { /* signing out here still happens */ }
    logout();
  };

  const [delPw, setDelPw] = useState('');
  const [delMsg, setDelMsg] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const deleteAccount = async () => {
    if (!delPw) { setDelMsg('Type your password first.'); return; }
    setDelBusy(true); setDelMsg('');
    try { await authAPI.deleteAccount({ password: delPw }); forgetAccount(me); logout(); }
    catch (err) { setDelMsg(err.response?.data?.error || 'Could not delete the account.'); }
    finally { setDelBusy(false); }
  };

  return (
    <>
      <Card id="set-accounts" title="Accounts on this device" hint="Switch between accounts without typing a password. Up to three are kept on this computer.">
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
              <button type="button" className="s-outline s-set-btn" onClick={() => switchTo(a)}>Switch</button>
              <button type="button" className="s-link-btn" aria-label={`Remove ${a.email} from this device`} onClick={() => remove(a)}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="s-set-actions">
          <button type="button" className="s-outline s-set-btn" onClick={addAnother} disabled={accounts.length >= 3} title={accounts.length >= 3 ? 'Remove one first (three at most)' : undefined}><Plus size={15} /> Add another account</button>
          {accounts.length >= 3 && <small>Three accounts is the most. Remove one to add another.</small>}
        </div>
      </Card>

      <Card title="Password">
        <form onSubmit={changePassword} className="s-set-form">
          <Row label="Current password" htmlFor="set-pw0"><input id="set-pw0" className="s-set-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Row>
          <Row label="New password" hint="At least 8 characters." htmlFor="set-pw1"><input id="set-pw1" className="s-set-input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></Row>
          <Row label="New password again" htmlFor="set-pw2"><input id="set-pw2" className="s-set-input" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required /></Row>
          <div className="s-set-actions">
            <button type="submit" className="s-accent-btn s-set-btn" disabled={pwBusy}>{pwBusy ? 'Changing…' : 'Change password'}</button>
            {pwMsg && <small role={pwMsg.ok ? 'status' : 'alert'} className={pwMsg.ok ? 'ok' : 'bad'}>{pwMsg.text}</small>}
          </div>
        </form>
      </Card>

      <Card title="Sign out" hint="Lost a laptop, or signed in somewhere you should not have?">
        <div className="s-set-actions">
          <button type="button" className="s-outline s-set-btn" onClick={() => logout()}>Sign out of this device</button>
          <Confirm label="Sign out everywhere" ask="Sign out of every device, including this one?" onYes={signOutEverywhere} />
          {outMsg && <small>{outMsg}</small>}
        </div>
      </Card>

      <Card title="Delete account" hint="This removes your account, notes, tasks and shared links for good. It cannot be undone." tone="peach">
        <Row label="Your password" hint="To make sure it is you." htmlFor="set-delpw"><input id="set-delpw" className="s-set-input" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} /></Row>
        <div className="s-set-actions">
          <Confirm danger label="Delete my account" ask="Delete everything for good?" onYes={deleteAccount} busy={delBusy} />
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

export function NotesSection() {
  const { settings } = useAuth();
  const save = useSave();
  return (
    <>
      <Card title="Writing">
        <Row label="Text size in notes" hint="Only changes what you read and write in a note.">
          <Seg label="Text size" value={settings?.fontSize || 'medium'} onChange={(v) => save({ fontSize: v })} options={[{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }]} />
        </Row>
      </Card>
      <Card title="Calendar">
        <Row label="Week starts on">
          <Seg label="Week starts on" value={settings?.weekStart === 'sun' ? 'sun' : 'mon'} onChange={(v) => save({ weekStart: v })} options={[{ id: 'mon', label: 'Monday' }, { id: 'sun', label: 'Sunday' }]} />
        </Row>
      </Card>
      <Card title="Voice">
        <Row label="Voice calls with Peblo" hint="Talk to your notes. Needs a microphone.">
          <Switch label="Voice calls" checked={settings?.voiceCalls !== false} onChange={(v) => save({ voiceCalls: v })} />
        </Row>
      </Card>
    </>
  );
}
