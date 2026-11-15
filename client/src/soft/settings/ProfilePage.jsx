import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, getSavedAccounts, forgetAccount } from '../../context/AuthContext';
import { authAPI, profileAPI } from '../../api';
import { getToken, setToken, authHeaders, signOutIfRejected } from '../../api/token';
import { PasswordInput, passwordStrength, useSave } from './ui';
import Avatar from '../../components/Avatar';
import AvatarCropper from '../../components/AvatarCropper';
import './profilePage.css';

const MAX_PICTURE_MB = 5;
const apiBase = () => import.meta.env.VITE_API_URL || '/api';
const initialOf = (u) => (String(u?.name || u?.email || 'You').trim().charAt(0) || 'Y').toUpperCase();
const errText = (e, fallback) => e?.response?.data?.error || fallback;

/** "3 months ago", from a date. */
export function ago(date) {
  const t = date ? new Date(date).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** "Chrome on Windows", from the browser's own description of itself. */
export function deviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'This browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** "Asia/Kolkata (UTC+05:30)" for each time zone this browser knows. */
function zoneOptions(current) {
  let names = [];
  try { names = Intl.supportedValuesOf('timeZone'); } catch { names = []; }
  if (!names.includes('UTC')) names = ['UTC', ...names];
  if (current && !names.includes(current)) names = [current, ...names];
  const now = new Date();
  return names.map((z) => {
    let off = '';
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'longOffset' }).formatToParts(now).find((x) => x.type === 'timeZoneName')?.value || '';
      off = p === 'GMT' ? 'UTC+00:00' : p.replace('GMT', 'UTC');
    } catch { off = ''; }
    return { id: z, label: off ? `${z} (${off})` : z };
  });
}

/** After the sign-in token changed on this device, keep the saved-accounts list pointing at the new one. */
function keepSavedToken(user) {
  try {
    if (!user) return;
    const me = user.id || user.email;
    forgetAccount(me);
    const list = getSavedAccounts();
    localStorage.setItem('peblo-accounts', JSON.stringify([{ id: me, email: user.email, name: user.name || '', avatar: user.avatar || '', token: getToken() }, ...list].slice(0, 3)));
  } catch { /* the list is only a convenience */ }
}

/** A labelled text box that saves when you leave it. onCommit resolves true (saved) or a string (why it was refused). */
function Field({ id, label, value, onCommit, placeholder, maxLength, show = (v) => v ?? '', read = (s) => s }) {
  const shown = show(value);
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  const [msg, setMsg] = useState('');
  if (shown !== seen) { setSeen(shown); setDraft(shown); }
  const commit = async () => {
    const next = read(draft.trim());
    if (next === (value ?? '')) { setDraft(shown); return; }
    const res = await onCommit(next);
    if (typeof res === 'string') setMsg(res); else setMsg('');
  };
  return (
    <label className="pf-field">{label}
      <input id={id} className="pf-in" value={draft} placeholder={placeholder} maxLength={maxLength} aria-invalid={msg ? true : undefined}
        onChange={(e) => { setDraft(e.target.value); if (msg) setMsg(''); }} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      {msg && <span className="pf-bad" role="alert">{msg}</span>}
    </label>
  );
}

function Pick({ id, label, value, options, onChange }) {
  return (
    <label className="pf-field">{label}
      <select id={id} className="pf-in" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Button that asks "sure?" once before it runs. */
function TwoStep({ label, ask, onYes, danger }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className={`pf-btn small${danger ? ' danger' : ''}`} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="pf-ask" role="group" aria-label={ask}>
      <span>{ask}</span>
      <button type="button" className="pf-btn small primary" disabled={busy} onClick={async () => { setBusy(true); try { await onYes(); } finally { setBusy(false); setOpen(false); } }}>Yes</button>
      <button type="button" className="pf-btn small quiet" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

function PictureCard() {
  const { user, updateProfile } = useAuth();
  const save = useSave();
  const fileRef = useRef(null);
  const [cropFile, setCropFile] = useState(null);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const take = (f) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) { setErr('Choose a picture file.'); return; }
    if (f.size > MAX_PICTURE_MB * 1024 * 1024) { setErr(`That picture is too big. Choose one under ${MAX_PICTURE_MB} MB.`); return; }
    setErr('');
    setCropFile(f);
  };
  const letter = initialOf(user);
  return (
    <>
      <div className="pf-top"
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files?.[0]); }}>
        <div className="pf-title">Your picture</div>
        <div className={`pf-pic${over ? ' over' : ''}`}>
          <div className="pf-av-wrap">
            <div className="pf-av l" aria-hidden="true"><Avatar src={user?.avatar} fallback={letter} /></div>
            <button type="button" className="pf-cam" aria-label="Change picture" onClick={() => fileRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            </button>
          </div>
          <div className="pf-pic-side">
            <div className="pf-btns">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }} />
              <button type="button" className="pf-btn primary" onClick={() => fileRef.current?.click()}>Upload a photo</button>
              <button type="button" className="pf-btn" disabled={!user?.avatar} onClick={() => save(() => updateProfile({ avatar: '' }))}>Remove</button>
            </div>
            <div className="pf-help">JPG, PNG or WebP, up to {MAX_PICTURE_MB} MB. You can crop it to a square after choosing it. Or drop a picture here.</div>
            {err && <div className="pf-bad" role="alert">{err}</div>}
          </div>
        </div>
        <div className="pf-shown">
          <b>Shown as</b>
          <span className="pf-av m" aria-hidden="true"><Avatar src={user?.avatar} fallback={letter} /></span>
          <span className="pf-av s" aria-hidden="true"><Avatar src={user?.avatar} fallback={letter} /></span>
          <span>in the header, comments and shared notes</span>
        </div>
      </div>
      {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onSave={async (data) => { const ok = await updateProfile({ avatar: data }); if (ok) { setCropFile(null); save(() => true); } else throw new Error('Could not save the picture. Try again.'); }} />}
    </>
  );
}

function DetailsCard() {
  const { user, settings, refreshUser, updateSettings } = useAuth();
  const save = useSave();
  const zones = useMemo(() => zoneOptions(user?.timezone), [user?.timezone]);
  const [bio, setBio] = useState(settings?.bio ?? user?.bio ?? '');
  const bioSeen = useRef(bio);
  const bioNow = settings?.bio ?? user?.bio ?? '';
  if (bioNow !== bioSeen.current) { bioSeen.current = bioNow; setBio(bioNow); }
  const [bioMsg, setBioMsg] = useState('');

  // Save one or more profile fields on the account. Resolves true, or the reason the server refused (shown under the box).
  const patch = async (fields) => {
    try {
      await profileAPI.updateProfile(fields);
      await refreshUser();
      await save(() => true);
      return true;
    } catch (e) { return errText(e, 'Could not save that. Try again.'); }
  };
  const roleNow = settings?.jobTitle ?? user?.jobTitle ?? '';

  return (
    <div className="pf-card-body">
      <div className="pf-divider" />
      <div className="pf-fields">
        <Field id="set-name" label="Display name" value={user?.name} maxLength={80} onCommit={(v) => (v ? patch({ name: v }) : 'Your name cannot be empty.')} />
        <Field id="set-username" label="Username" value={user?.username} placeholder="@username" maxLength={31}
          show={(v) => (v ? `@${v}` : '')} read={(s) => s.replace(/^@/, '').toLowerCase()} onCommit={(v) => patch({ username: v })} />
        <Field id="set-role" label="Role" value={roleNow} placeholder="Student, Designer, Founder" maxLength={80} onCommit={(v) => save({ jobTitle: v }).then((ok) => ok || 'Could not save that. Try again.')} />
        <Field id="set-pronouns" label="Pronouns" value={user?.pronouns} placeholder="Optional" maxLength={40} onCommit={(v) => patch({ pronouns: v })} />
        <Pick id="set-timezone" label="Time zone" value={user?.timezone || 'UTC'} options={zones} onChange={(v) => patch({ timezone: v })} />
        <Pick id="set-language" label="Language" value={user?.language || 'en'} options={[{ id: 'en', label: 'English' }]} onChange={(v) => patch({ language: v })} />
      </div>
      <label className="pf-field">About you
        <textarea id="set-bio" className="pf-in" rows={3} maxLength={400} value={bio} placeholder="A line or two. AI answers can use it to fit you better." style={{ resize: 'none' }}
          onChange={(e) => { setBio(e.target.value); setBioMsg(''); }}
          onBlur={async () => { if (bio.trim() === (bioNow || '')) return; const ok = await save({ bio: bio.trim() }); setBioMsg(ok ? '' : 'Could not save that. Try again.'); }} />
        <span className="pf-count">{bio.length}/400</span>
        {bioMsg && <span className="pf-bad" role="alert">{bioMsg}</span>}
      </label>
    </div>
  );
}

function EmailCard() {
  const { user, refreshUser } = useAuth();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [pw, setPw] = useState('');
  const verified = user?.emailVerified === true;

  const sendLink = async () => {
    setBusy('link'); setMsg(null);
    try {
      const { data } = await authAPI.sendVerification();
      setMsg(data.alreadyVerified ? { ok: true, text: 'This address is already confirmed.' } : { ok: true, text: `We sent a link to ${user.email}. Open it to confirm. It works once and lasts 24 hours.` });
      if (data.alreadyVerified) await refreshUser();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not send the email. Try again in a few minutes.') }); }
    finally { setBusy(''); }
  };
  const change = async (e) => {
    e.preventDefault();
    if (!/^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)+$/.test(next.trim())) return setMsg({ ok: false, text: 'Enter a valid email address.' });
    setBusy('change'); setMsg(null);
    try {
      const { data } = await profileAPI.updateProfile({ email: next.trim(), currentPassword: pw });
      await refreshUser();
      setMsg({ ok: true, text: data.message || 'Email changed.' });
      setOpen(false); setNext(''); setPw('');
    } catch (err) { setMsg({ ok: false, text: errText(err, 'Could not change the email. Try again.') }); }
    finally { setBusy(''); }
  };
  const cancel = async () => {
    setBusy('cancel');
    try { await authAPI.cancelEmailChange(); await refreshUser(); setMsg({ ok: true, text: 'The change was cancelled.' }); } catch { setMsg({ ok: false, text: 'Could not cancel. Try again.' }); } finally { setBusy(''); }
  };

  return (
    <section className="pf-card" id="set-email" aria-labelledby="set-email-h">
      <div className="pf-title" id="set-email-h">Email</div>
      <div className="pf-email">{user?.email} <span className={`pf-pill ${verified ? 'ok' : 'warn'}`}>{verified ? 'Confirmed' : 'Not confirmed'}</span></div>
      <div className="pf-btns">
        {!verified && <button type="button" className="pf-btn primary" onClick={sendLink} disabled={busy === 'link'}>{busy === 'link' ? 'Sending…' : 'Send confirmation link'}</button>}
        <button type="button" className="pf-btn" aria-expanded={open} onClick={() => { setOpen((o) => !o); setMsg(null); }}>Change email</button>
      </div>
      {user?.pendingEmail && (
        <p className="pf-note" role="status">Waiting for you to open the link we sent to <b>{user.pendingEmail}</b>. Your email changes then.{' '}
          <button type="button" className="pf-link" onClick={cancel} disabled={busy === 'cancel'}>Cancel the change</button></p>
      )}
      {open && (
        <form onSubmit={change} className="pf-panel">
          <label className="pf-field">New email<input id="set-newemail" className="pf-in" type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
          <label className="pf-field">Your password<PasswordInput id="set-emailpw" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
          <div className="pf-btns">
            <button type="submit" className="pf-btn primary" disabled={busy === 'change'}>{busy === 'change' ? 'Working…' : user?.mailReady ? 'Send a link to the new address' : 'Change email'}</button>
            <button type="button" className="pf-btn quiet" onClick={() => { setOpen(false); setPw(''); setNext(''); }}>Cancel</button>
          </div>
          {user?.mailReady && <small className="pf-note">Your address changes only after you open the link we send to the new one.</small>}
        </form>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'pf-ok' : 'pf-bad'}>{msg.text}</p>}
      {user && user.mailReady === false && !verified && <p className="pf-note">This Peblo server cannot send email yet, so the link cannot be sent. Whoever runs it needs to set up mail (see the README).</p>}
    </section>
  );
}

function PasswordPanel({ onDone }) {
  const { user, refreshUser } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(pw.next);
  const submit = async (e) => {
    e.preventDefault();
    if (pw.next.length < 8) return setMsg({ ok: false, text: 'The new password must be at least 8 characters.' });
    if (pw.next !== pw.again) return setMsg({ ok: false, text: 'The two new passwords do not match.' });
    if (pw.next === pw.current) return setMsg({ ok: false, text: 'The new password must be different from the current one.' });
    setBusy(true); setMsg(null);
    try {
      const { data } = await authAPI.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      if (data?.token) setToken(data.token); // this device stays signed in, every other device is signed out
      keepSavedToken(user);
      await refreshUser();
      setPw({ current: '', next: '', again: '' });
      onDone('Password changed. Your other devices were signed out.');
    } catch (err) { setMsg({ ok: false, text: errText(err, 'Could not change the password. Try again.') }); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="pf-panel">
      <label className="pf-field">Current password<PasswordInput id="set-pw0" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
      <label className="pf-field">New password
        <PasswordInput id="set-pw1" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        {pw.next && <span className={`s-set-meter l${strength.level}`} role="status"><i /><i /><i /><em>{strength.label}</em></span>}
        <small className="pf-note">At least 8 characters. A few random words is stronger than one word with symbols.</small>
      </label>
      <label className="pf-field">New password again<PasswordInput id="set-pw2" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required /></label>
      <div className="pf-btns">
        <button type="submit" className="pf-btn primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
        <button type="button" className="pf-btn quiet" onClick={() => onDone('')}>Cancel</button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'pf-ok' : 'pf-bad'}>{msg.text}</p>}
    </form>
  );
}

function DeletePanel({ onCancel }) {
  const { user, logout } = useAuth();
  const [word, setWord] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    if (word.trim().toUpperCase() !== 'DELETE') return setMsg('Type DELETE in the box first.');
    if (!pw) return setMsg('Type your password first.');
    setBusy(true); setMsg('');
    try { await authAPI.scheduleDeletion({ password: pw }); forgetAccount(user?.id || user?.email); logout(); }
    catch (err) { setMsg(errText(err, 'Could not delete the account.')); setBusy(false); }
  };
  return (
    <form onSubmit={go} className="pf-panel danger">
      <p className="pf-note">Your account, notes, tasks and shared links are removed 30 days from now. Sign in again before then and nothing is lost. Want a copy first? Use Export above.</p>
      <label className="pf-field">Type DELETE<input id="set-delword" className="pf-in" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" /></label>
      <label className="pf-field">Your password<PasswordInput id="set-delpw" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <div className="pf-btns">
        <button type="submit" className="pf-btn danger-fill" disabled={busy}>{busy ? 'Working…' : 'Delete my account'}</button>
        <button type="button" className="pf-btn quiet" onClick={onCancel}>Cancel</button>
      </div>
      {msg && <p role="alert" className="pf-bad">{msg}</p>}
    </form>
  );
}

function SecurityCard() {
  const { user } = useAuth();
  const [panel, setPanel] = useState(''); // '' | 'password' | 'delete'
  const [msg, setMsg] = useState(null);
  const [exporting, setExporting] = useState(false);
  const changed = user?.passwordChangedAt || user?.createdAt;

  const signOutOthers = async () => {
    try {
      const { data } = await authAPI.logoutOthers();
      if (data?.token) setToken(data.token);
      keepSavedToken(user);
      setMsg({ ok: true, text: 'Every other device was signed out. This one stays signed in.' });
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not sign the other devices out. Try again.') }); }
  };
  const exportData = async () => {
    setExporting(true); setMsg(null);
    try {
      const res = signOutIfRejected(await fetch(`${apiBase()}/backup`, { headers: authHeaders() }));
      if (!res.ok) throw new Error('Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `peblo-backup-${new Date().toLocaleDateString('en-CA')}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setMsg({ ok: false, text: 'Could not export your data. Try again.' }); }
    finally { setExporting(false); }
  };

  return (
    <section className="pf-card" id="set-security" aria-labelledby="set-security-h">
      <div className="pf-title" id="set-security-h">Sign-in and security</div>
      <div className="pf-row">
        <span className="pf-row-text"><b>Password</b><br /><span>Last changed {ago(changed) || 'when you signed up'}</span></span>
        <button type="button" className="pf-btn small" aria-expanded={panel === 'password'} onClick={() => { setPanel(panel === 'password' ? '' : 'password'); setMsg(null); }}>Change</button>
      </div>
      {panel === 'password' && <PasswordPanel onDone={(text) => { setPanel(''); setMsg(text ? { ok: true, text } : null); }} />}
      <div className="pf-row">
        <span className="pf-row-text"><b>Where you are signed in</b><br /><span>{deviceName()} (this device). Other devices are listed once you sign them out.</span></span>
        <TwoStep label="Sign out others" ask="Sign out every other device?" onYes={signOutOthers} />
      </div>
      <div className="pf-row">
        <span className="pf-row-text"><b>Download your data</b><br /><span>Notes, tasks and your profile as one file</span></span>
        <button type="button" className="pf-btn small" onClick={exportData} disabled={exporting}>{exporting ? 'Preparing…' : 'Export'}</button>
      </div>
      <div className="pf-row">
        <span className="pf-row-text"><b className="pf-red">Delete account</b><br /><span>Removes everything after 30 days</span></span>
        <button type="button" className="pf-btn small danger" aria-expanded={panel === 'delete'} onClick={() => { setPanel(panel === 'delete' ? '' : 'delete'); setMsg(null); }}>Delete</button>
      </div>
      {panel === 'delete' && <DeletePanel onCancel={() => setPanel('')} />}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'pf-ok' : 'pf-bad'}>{msg.text}</p>}
    </section>
  );
}

/** The Profile page: your picture and details on the left, email and sign-in and security on the right. */
export default function ProfilePage() {
  return (
    <div className="s-set-stack pf">
      <div className="pf-grid">
        <section className="pf-card" aria-label="Your picture and details">
          <PictureCard />
          <DetailsCard />
        </section>
        <div className="pf-col">
          <EmailCard />
          <SecurityCard />
        </div>
      </div>
    </div>
  );
}
