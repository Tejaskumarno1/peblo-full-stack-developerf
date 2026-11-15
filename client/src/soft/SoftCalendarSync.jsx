import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { calSyncAPI } from '../api';
import { exportCalendar, importCalendar } from '../river/calendarIO';
import { Switch } from './settings/ui';
import './calsync.css';

const COLORS = [['sky', '#3b7bbf'], ['mint', '#2d9d6a'], ['peach', '#c4441c'], ['lilac', '#7b52b8'], ['butter', '#d19a12'], ['rose', '#c9577a']];
const hex = (c) => (COLORS.find(([k]) => k === c) || COLORS[0])[1];
const ago = (d) => { if (!d) return 'Not read yet'; const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const errText = (e, fallback) => e?.response?.data?.error || fallback;

/** Soft Studio · Calendar sync (mockup: CalSync). Read-only calendar links, Peblo's own subscribe link, free-time link. */
export default function SoftCalendarSync() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const { data, isError, isLoading } = useQuery({ queryKey: ['cal-sync'], queryFn: () => calSyncAPI.get().then((r) => r.data) });
  const feeds = data?.feeds || [];
  const share = data?.share;
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('sky');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const reload = () => { qc.invalidateQueries({ queryKey: ['cal-sync'] }); };

  const add = async (e) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true); setMsg('');
    try { await calSyncAPI.addFeed({ url: url.trim(), name: name.trim() || undefined, color }); setUrl(''); setName(''); setMsg('Added. Its events now show in your calendar.'); reload(); qc.invalidateQueries({ queryKey: ['cal-sync', 'events'] }); }
    catch (err) { setMsg(errText(err, 'Could not add that link. Check it and try again.')); }
    setBusy(false);
  };
  const patch = async (f, p) => { try { await calSyncAPI.patchFeed(f.id, p); reload(); qc.invalidateQueries({ queryKey: ['cal-sync', 'events'] }); } catch { setMsg('Could not save that.'); } };
  const refresh = async (f) => { try { await calSyncAPI.refreshFeed(f.id); reload(); qc.invalidateQueries({ queryKey: ['cal-sync', 'events'] }); } catch { setMsg('Could not refresh right now.'); } };
  const remove = async (f) => { try { await calSyncAPI.removeFeed(f.id); setConfirmDel(null); reload(); qc.invalidateQueries({ queryKey: ['cal-sync', 'events'] }); } catch { setMsg('Could not remove that.'); } };
  const setShare = async (p) => { try { await calSyncAPI.share(p); reload(); } catch { setMsg('Could not save that.'); } };
  const copy = async (k, text) => { try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1800); } catch { setMsg('Copy did not work. Select the link and copy it.'); } };

  return (
    <div className="soft-page s-cs">
      <div className="s-page-head">
        <div className="s-page-title">
          <h1 className="s-h1">Calendar sync</h1>
          <span className="s-sub">Bring other calendars in, send yours out. Nothing here changes the other calendars.</span>
        </div>
        <span className="s-grow" />
        <button type="button" className="s-pill46" onClick={() => navigate('/calendar')}>Back to calendar</button>
      </div>
      {isError && <p className="s-empty small" role="alert">Could not load your calendar links. Check your connection and try again.</p>}
      {msg && <p className="s-cs-msg" role="status">{msg}</p>}

      <div className="s-cs-cols">
        <section className="s-cs-card" aria-labelledby="cs-links">
          <h2 id="cs-links">Calendar links</h2>
          <p className="s-cs-hint">Paste the secret iCal address from Google Calendar, Outlook, Apple or any calendar. Events are read only and refresh every few hours.</p>
          {isLoading ? <p className="s-empty small">Loading...</p> : feeds.length === 0 ? (
            <p className="s-empty small">No links yet. Add one below and its events appear in your calendar.</p>
          ) : (
            <ul className="s-cs-list">
              {feeds.map((f) => (
                <li key={f.id} className="s-cs-feed" data-feed-row={f.name}>
                  <i className="s-cs-dot" style={{ background: hex(f.color) }} />
                  <div className="s-cs-feed-text">
                    <strong>{f.name}</strong>
                    <small className={f.error ? 'err' : ''}>{f.error ? f.error : `${f.kind} · ${f.count} event${f.count === 1 ? '' : 's'} · ${ago(f.lastSyncedAt)}`}</small>
                  </div>
                  <Switch checked={f.enabled} onChange={(v) => patch(f, { enabled: v })} label={`Show ${f.name}`} />
                  <button type="button" className="s-cs-btn" onClick={() => refresh(f)}>Refresh</button>
                  {confirmDel === f.id ? (
                    <span className="s-cs-confirm"><button type="button" className="s-cs-btn danger" onClick={() => remove(f)}>Remove link</button><button type="button" className="s-cs-btn" onClick={() => setConfirmDel(null)}>Keep</button></span>
                  ) : <button type="button" className="s-cs-btn" onClick={() => setConfirmDel(f.id)} aria-label={`Remove ${f.name}`}>Remove</button>}
                </li>
              ))}
            </ul>
          )}
          <form className="s-cs-add" onSubmit={add}>
            <label htmlFor="cs-url">Calendar link</label>
            <input id="cs-url" type="url" inputMode="url" placeholder="https://calendar.google.com/.../basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
            <div className="s-cs-add-row">
              <input aria-label="Name" placeholder="Name (optional)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <div className="s-cs-swatches" role="radiogroup" aria-label="Colour">
                {COLORS.map(([k, h]) => <button key={k} type="button" role="radio" aria-checked={color === k} aria-label={k} className={color === k ? 'on' : ''} style={{ background: h }} onClick={() => setColor(k)} />)}
              </div>
              <button type="submit" className="s-cs-primary" disabled={busy || !url.trim()}>{busy ? 'Reading...' : 'Add link'}</button>
            </div>
          </form>
          <div className="s-cs-file">
            <button type="button" className="s-cs-btn" onClick={() => fileRef.current?.click()}>Import .ics file</button>
            <button type="button" className="s-cs-btn" onClick={() => exportCalendar().then((n) => setMsg(`Downloaded ${n} item${n === 1 ? '' : 's'} (.ics)`)).catch(() => setMsg('Could not export'))}>Export .ics</button>
            <button type="button" className="s-cs-btn" onClick={() => { navigate('/calendar'); setTimeout(() => window.print(), 600); }}>Print week</button>
            <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importCalendar(f).then((r) => setMsg(`Added ${r.added} meeting${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}`)).catch(() => setMsg('Could not read that file')); }} />
          </div>
        </section>

        <section className="s-cs-card" aria-labelledby="cs-share">
          <h2 id="cs-share">Share and subscribe</h2>
          <p className="s-cs-hint">Anyone with a link can read it, so keep links private. Make a new link at any time and the old one stops working.</p>
          {share && (
            <>
              <div className="s-cs-share">
                <div className="s-cs-share-head"><div><strong>Subscribe link</strong><small>Your tasks and meetings as an iCal feed for Google, Outlook or Apple.</small></div><Switch checked={share.feedOn} onChange={(v) => setShare({ feedOn: v })} label="Subscribe link on" /></div>
                {share.feedOn && (
                  <div className="s-cs-link"><input readOnly aria-label="Subscribe link" value={share.feedUrl.replace(/^https?:/, 'webcal:')} onFocus={(e) => e.target.select()} /><button type="button" className="s-cs-btn" onClick={() => copy('feed', share.feedUrl)}>{copied === 'feed' ? 'Copied' : 'Copy'}</button><button type="button" className="s-cs-btn" onClick={() => setShare({ renew: 'feed' })}>New link</button></div>
                )}
              </div>
              <div className="s-cs-share">
                <div className="s-cs-share-head"><div><strong>Free time link</strong><small>Shows only when you are busy over the next two weeks, never titles.</small></div><Switch checked={share.freeOn} onChange={(v) => setShare({ freeOn: v })} label="Free time link on" /></div>
                {share.freeOn && (
                  <div className="s-cs-link"><input readOnly aria-label="Free time link" value={share.freeUrl} onFocus={(e) => e.target.select()} /><button type="button" className="s-cs-btn" onClick={() => copy('free', share.freeUrl)}>{copied === 'free' ? 'Copied' : 'Copy'}</button><button type="button" className="s-cs-btn" onClick={() => setShare({ renew: 'free' })}>New link</button></div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
