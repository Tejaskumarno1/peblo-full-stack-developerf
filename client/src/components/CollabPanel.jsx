import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock, Eye, Link2, MoreHorizontal, Pencil, UserMinus, WifiOff, X, Zap } from 'lucide-react';
import { peerColor } from '../utils/peerCursors';
import ShareQr, { QR_CSS } from './ShareQr';
import PollManager from './PollManager';
import './collab.css';

/** The people-on-the-link UI shared by the notes editor and the public share page. All data comes from the server's presence list. */

const WAIT_CSS = '.cp-wait{margin:0 0 10px;padding:8px 10px;border-radius:12px;background:rgba(226,80,26,.09)}.cp-wait ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.cp-wait li{display:flex;align-items:center;gap:8px}.cp-wait li b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cp-wait button{border:1px solid var(--cp-line,#ddd);background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font:inherit;font-size:12.5px;cursor:pointer}.cp-wait button.ok{background:#e2501a;border-color:#e2501a;color:#fff}.cp-appr{display:flex;gap:10px;align-items:flex-start;margin-top:10px;cursor:pointer}.cp-appr span{display:flex;flex-direction:column}.cp-appr small{opacity:.65;font-size:11.5px}';
export const initials = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || 'G';
export const ago = (value) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const seen = (s) => (s < 10 ? 'now' : s < 60 ? `${s} sec ago` : `${Math.round(s / 60)} min ago`);
export const left = (iso) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const h = ms / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(ms / 60000))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};
const fmtSecs = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
export const STATUS = { editing: 'Editing', viewing: 'Viewing', reading: 'Reading', idle: 'Idle' };
const WORDS = { viewed: 'opened the note', edited: 'edited the note', merged: 'edited (merged with other changes)', clash: 'edited (both versions kept)' };
const EVENT_WORDS = { joined: 'joined', left: 'left', back: 'reconnected', knock: 'is asking to join', extend: 'asked to keep the link going' };

/** Round person badge: a colour of their own (the same one as their cursor), their initials, and a status dot. */
export function Avatar({ v, size = 36 }) {
  return (
    <span className={`cp-av${v.status === 'editing' ? ' typing' : ''}${v.status === 'idle' ? ' idle' : ''}`} style={{ '--cp-c': peerColor(v.id), width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {initials(v.name)}
      <i className={`cp-dot s-${v.status || 'viewing'}`} />
    </span>
  );
}

/** Joins and leaves, worked out from the presence list. Nothing is reported for the first list or for yourself. */
export function useCollabEvents(viewers, enabled = true) {
  const [events, setEvents] = useState([]);
  const prev = useRef(null);
  const [muted, setMutedState] = useState(() => { try { return localStorage.getItem('peblo-collab-mute') === '1'; } catch { return false; } });
  const setMuted = (value) => { setMutedState(value); try { localStorage.setItem('peblo-collab-mute', value ? '1' : '0'); } catch { /* ignore */ } };
  useEffect(() => {
    if (!enabled) { prev.current = null; return; }
    const now = new Map(viewers.filter((v) => !v.self).map((v) => [v.id, v]));
    if (prev.current) {
      const add = [];
      now.forEach((v, id) => { if (!prev.current.has(id)) add.push({ kind: 'joined', name: v.name, at: Date.now(), id: `${id}-j-${Date.now()}` }); });
      prev.current.forEach((v, id) => { if (!now.has(id)) add.push({ kind: 'left', name: v.name, at: Date.now(), id: `${id}-l-${Date.now()}` }); });
      if (add.length) setEvents((e) => [...add, ...e].slice(0, 30));
    }
    prev.current = now;
  }, [viewers, enabled]);
  const note = (kind, name = 'You') => setEvents((e) => [{ kind, name, at: Date.now(), id: `${kind}-${Date.now()}` }, ...e].slice(0, 30));
  return { events, muted, setMuted, note, dismiss: (id) => setEvents((e) => e.filter((x) => x.id !== id)), clear: () => setEvents([]) };
}

/** The small bar at the bottom: how many people are here. Opens the panel. */
export function CollabBar({ viewers, open, onToggle, offline, toasts = [], onDismissToast, soon, expiresAt, waiting = 0 }) {
  const others = viewers.filter((v) => !v.self);
  const typers = others.filter((v) => v.typing);
  const text = offline ? 'Reconnecting…'
    : waiting > 0 ? `${waiting} waiting to join`
    : typers.length === 1 ? `${typers[0].name} is typing`
      : typers.length === 2 ? `${typers[0].name} and ${typers[1].name} are typing`
        : typers.length > 2 ? `${typers.length} people are typing`
          : others.length === 1 ? `${others[0].name} is viewing this page`
            : others.length > 1 ? `${others.length} people are viewing this page`
              : soon ? `Shared link ends in ${left(expiresAt)}` : 'Shared link';
  return (
    <div className="cp-wrap">
      {toasts.map((t) => (
        <div key={t.id} className="cp-toast" role="status">
          <b>{t.name}</b> {EVENT_WORDS[t.kind]}
          <button type="button" aria-label="Dismiss" onClick={() => onDismissToast?.(t.id)}><X size={13} /></button>
        </div>
      ))}
      <button type="button" className={`cp-bar${typers.length ? ' is-typing' : ''}${soon ? ' is-soon' : ''}${offline ? ' is-off' : ''}`} aria-expanded={open} onClick={onToggle} data-testid="live-editors" title="Who is here, and what happened">
        <span className="cp-bar-eye" aria-hidden="true">{offline ? <WifiOff size={15} /> : <Eye size={15} />}</span>
        <span className="cp-bar-text">{text}</span>
        {others.length > 0 && <span className="cp-avs" aria-hidden="true">{others.slice(0, 3).map((v) => <Avatar key={v.id} v={v} size={24} />)}</span>}
        {!offline && <span className="cp-live"><i />Live</span>}
        <ChevronDown size={15} className={`cp-chev${open ? ' up' : ''}`} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Header chips next to the title: link state, who can do what, copy link, avatars. */
export function CollabChips({ viewers, canEdit, onCopy, onOpen, copied }) {
  const others = viewers.filter((v) => !v.self);
  return (
    <div className="cp-chips" data-testid="share-chips">
      <span className="cp-chip ok"><Link2 size={13} />Shared link active</span>
      <span className="cp-chip">{canEdit ? 'Anyone can view & edit' : 'Anyone can view'}</span>
      <button type="button" className="cp-chip btn" onClick={onCopy}>{copied ? 'Copied' : 'Copy link'}</button>
      <button type="button" className="cp-chip btn live" onClick={onOpen} aria-label="Open live collaboration">
        {others.length > 0 && <span className="cp-avs" aria-hidden="true">{others.slice(0, 3).map((v) => <Avatar key={v.id} v={v} size={22} />)}{others.length > 3 && <em>+{others.length - 3}</em>}</span>}
        <span className="cp-live"><i />Live</span>
      </button>
    </div>
  );
}

export function CollabPanel({
  viewers, mode = 'guest', canEdit, expiresAt, activity = [], events = [], offline, synced, muted, onMute, onClearEvents,
  onRemove, onExtend, onTurnOff, onCopy, busy, onClose, followId, onFollow, link, stats, waiting = [], approval, onApproval, onAdmit, onDecline, onRole, shortLink, noteId, extendRequest,
}) {
  const [tab, setTab] = useState('viewers');
  const [menu, setMenu] = useState(null);
  const [tip, setTip] = useState(() => { try { return localStorage.getItem('peblo-collab-tip') !== '1'; } catch { return true; } });
  const [confirmOff, setConfirmOff] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 5000); return () => window.clearInterval(t); }, []);
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!e.target.closest?.('.cp-menu, .cp-more')) setMenu(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const mine = viewers.find((v) => v.self);
  const rows = [...viewers].sort((a, b) => (b.self ? 1 : 0) - (a.self ? 1 : 0) || (a.owner ? -1 : 0) - (b.owner ? -1 : 0));
  const soon = expiresAt && new Date(expiresAt).getTime() - Date.now() < 48 * 3600 * 1000;
  const log = [
    ...events.map((e) => ({ key: e.id, who: e.name, text: EVENT_WORDS[e.kind] || e.kind, at: e.at, local: true })),
    ...activity.map((a, i) => ({ key: `${a.at}-${i}`, who: a.actor, text: WORDS[a.action] || a.action, at: new Date(a.at).getTime() })),
  ].sort((a, b) => b.at - a.at).slice(0, 40);

  return (
    <aside className="cp" role="dialog" aria-label="Live collaboration" data-testid="live-panel" ref={ref}>
      <div className="cp-head">
        <span className="cp-title"><i className={offline ? 'off' : ''} />Live collaboration</span>
        {mode === 'owner' && onCopy && <button type="button" className="cp-share" onClick={onCopy}><Link2 size={14} />Share</button>}
        <button type="button" className="cp-x" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      {offline && <div className="cp-banner off" role="status"><WifiOff size={14} />Reconnecting… your changes are kept and will sync.</div>}
      {!offline && synced && <div className="cp-banner ok" role="status">Back online. Everything is synced.</div>}
      <div className="cp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'viewers'} className={tab === 'viewers' ? 'on' : ''} onClick={() => setTab('viewers')}>Viewers</button>
        <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity</button>
      </div>

      {tab === 'viewers' && <div className="cp-body" role="tabpanel">
        {mode === 'owner' && waiting.length > 0 && <section className="cp-wait" aria-label="Waiting to join" data-testid="waiting-list">
          <h3 className="cp-h">Waiting to join ({waiting.length})</h3>
          <ul>{waiting.map((w) => (
            <li key={w.id} data-testid="waiting-row"><span className="cp-av mini" style={{ '--cp-c': peerColor(w.id) }}>{initials(w.name)}</span><b>{w.name}</b>
              <button type="button" className="ok" data-testid="admit" onClick={() => onAdmit?.(w.id)}>Admit</button>
              <button type="button" data-testid="decline" onClick={() => onDecline?.(w.id)}>Decline</button></li>
          ))}</ul>
        </section>}
        <h3 className="cp-h">Viewers ({rows.length})</h3>
        {rows.length === 0 && <p className="cp-empty">Nobody is here right now.</p>}
        <ul className="cp-list" data-testid="live-viewers">
          {rows.map((v) => (
            <li key={v.id} className="cp-row">
              <Avatar v={v} />
              <span className="cp-who">
                <b>{v.name}</b>
                <small className={`st s-${v.status || 'viewing'}`}>{STATUS[v.status] || 'Viewing'} · {seen(v.idleSeconds || 0)}{v.cursor != null && v.status !== 'idle' ? ` · paragraph ${v.cursor + 1}` : ''}</small>
              </span>
              {v.self && <span className="cp-badge you">You</span>}
              {v.owner && !v.self && <span className="cp-badge">Owner</span>}
              {mode === 'owner' && v.custom && !v.self && <span className="cp-badge" data-testid="role-badge">{v.canEdit ? 'Can edit' : 'Can view'}</span>}
              {onFollow && !v.self && v.cursor != null && <button type="button" className={`cp-follow`} aria-pressed={followId === v.id} onClick={() => onFollow(followId === v.id ? null : v.id)}>{followId === v.id ? 'Following' : 'Follow'}</button>}
              {mode === 'owner' && !v.self && !v.owner && onRemove && (
                <span className="cp-menuwrap">
                  <button type="button" className="cp-more" aria-label={`Options for ${v.name}`} aria-haspopup="menu" aria-expanded={menu === v.id} onClick={() => setMenu(menu === v.id ? null : v.id)}><MoreHorizontal size={16} /></button>
                  {menu === v.id && <div className="cp-menu" role="menu">
                    {onRole && <>
                      {!(v.custom && !v.canEdit) && v.canEdit !== false && <button type="button" role="menuitem" data-testid="role-view" onClick={() => { setMenu(null); onRole(v.id, 'view'); }}><Eye size={14} />Can view only</button>}
                      {!(v.custom && v.canEdit) && v.canEdit !== true && <button type="button" role="menuitem" data-testid="role-edit" onClick={() => { setMenu(null); onRole(v.id, 'edit'); }}><Pencil size={14} />Can edit</button>}
                      {v.custom && <button type="button" role="menuitem" data-testid="role-default" onClick={() => { setMenu(null); onRole(v.id, null); }}><Link2 size={14} />Use the link's setting</button>}
                    </>}
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); onRemove(v.id, v.name); }}><UserMinus size={14} />Remove from this link</button></div>}
                </span>
              )}
            </li>
          ))}
        </ul>
        {mine && mode === 'guest' && !canEdit && <p className="cp-note">This link is view only. You can read, but not change it.</p>}

        {mode === 'owner' && (
          <section className="cp-access" aria-label="Access">
            <h3 className="cp-h">Access</h3>
            <div className="cp-line"><Eye size={14} />{canEdit ? 'Anyone with the link can view and edit' : 'Anyone with the link can view'}</div>
            <div className={`cp-line${soon ? ' soon' : ''}`} data-testid="live-expiry"><Clock size={14} />{expiresAt ? `Link ends in ${left(expiresAt)}` : 'Link never ends'}</div>
            {extendRequest && <div className="cp-extreq" data-testid="extend-request"><span><b>{extendRequest.by}</b> asked to keep this link going</span><span><button type="button" data-testid="extend-req-1" disabled={busy} onClick={() => onExtend?.(1)}>+1 day</button><button type="button" disabled={busy} onClick={() => onExtend?.(7)}>+7 days</button></span></div>}
            <div className="cp-ext">
              <button type="button" disabled={busy} onClick={() => onExtend?.(1)}>+1 day</button>
              <button type="button" disabled={busy} onClick={() => onExtend?.(7)}>+7 days</button>
              <button type="button" disabled={busy} onClick={() => onExtend?.(null)}>Never</button>
            </div>
            {onApproval && <label className="cp-appr"><input type="checkbox" data-testid="approval-toggle" checked={!!approval} onChange={(e) => onApproval(e.target.checked)} /><span><b>Let people in one by one</b><small>New visitors wait until you admit them.</small></span></label>}
            {shortLink && <div className="cp-short" data-testid="short-link"><span>Short link</span><code>{shortLink.replace(/^https?:\/\//, '')}</code><button type="button" onClick={() => navigator.clipboard?.writeText(shortLink).catch(() => {})}>Copy</button></div>}
            {link && <ShareQr link={shortLink || link} />}
            {noteId && <PollManager noteId={noteId} />}
            {!confirmOff
              ? <button type="button" className="cp-off" onClick={() => setConfirmOff(true)}>Turn sharing off</button>
              : <div className="cp-confirm">Everyone loses access to this link.<span><button type="button" className="danger" disabled={busy} onClick={() => { setConfirmOff(false); onTurnOff?.(); }}>Turn off</button><button type="button" onClick={() => setConfirmOff(false)}>Keep</button></span></div>}
          </section>
        )}
      </div>}

      {tab === 'activity' && <div className="cp-body" role="tabpanel">
        {stats && <div className="cp-stats" data-testid="link-stats">
          <div><b>{stats.visits}</b><small>Visits</small></div>
          <div><b>{stats.people}</b><small>People</small></div>
          <div><b>{stats.edits}</b><small>Edits</small></div>
          <svg viewBox="0 0 70 26" aria-label="Visits in the last 7 days" role="img">{(() => { const mx = Math.max(1, ...stats.perDay); return stats.perDay.map((n, i) => <rect key={i} x={i * 10 + 1} y={24 - Math.round((n / mx) * 22) - 1} width="8" height={Math.max(2, Math.round((n / mx) * 22))} rx="2" fill="currentColor" opacity={n ? 0.85 : 0.25} />); })()}</svg>
        </div>}
        {stats?.readers?.count > 0 && <div className="cp-readers" data-testid="reader-stats">
          <div className="cp-rhead"><div><b data-testid="reader-finish">{stats.readers.finishRate}%</b><small>Read to the end</small></div><div><b>{fmtSecs(stats.readers.avgSecs)}</b><small>Average time</small></div><div><b>{stats.readers.count}</b><small>Readers</small></div></div>
          <div className="cp-stops" role="img" aria-label="Where readers stop">{(() => { const mx = Math.max(1, ...stats.readers.stops); return stats.readers.stops.map((n, i) => <i key={i} title={`${i * 10}% to ${i * 10 + 10}%: ${n}`} style={{ height: `${Math.max(3, Math.round((n / mx) * 34))}px`, opacity: n ? 0.85 : 0.25 }} />); })()}</div>
          <small className="cp-stopl">Where readers stop, top to bottom of the page</small>
          <ul className="cp-rlist">{stats.readers.people.slice(0, 6).map((r, i) => <li key={i}><span>{r.name}</span><em>{r.progress}% · {fmtSecs(r.secs)}</em></li>)}</ul>
        </div>}
        <h3 className="cp-h">Recent activity {log.length > 0 && events.length > 0 && <button type="button" className="cp-link" onClick={onClearEvents}>Clear joins</button>}</h3>
        {log.length === 0 && <p className="cp-empty">Nothing yet.</p>}
        <ul className="cp-log" data-testid="live-activity">
          {log.map((a) => (
            <li key={a.key}><span className="cp-av mini" style={{ '--cp-c': peerColor(a.who) }}>{initials(a.who)}</span><span><b>{a.who}</b> {a.text}<small>{ago(a.at)}</small></span></li>
          ))}
        </ul>
        <label className="cp-mute"><input type="checkbox" checked={!!muted} onChange={(e) => onMute?.(e.target.checked)} />Hide “joined / left” pop-ups</label>
      </div>}

      <style>{QR_CSS + WAIT_CSS + '.cp-stats{display:flex;align-items:center;gap:14px;padding:8px 0 10px}.cp-stats div{display:flex;flex-direction:column}.cp-stats b{font-size:18px}.cp-stats small{opacity:.65;font-size:11.5px}.cp-stats svg{margin-left:auto;width:70px;height:26px}.cp-readers{padding:6px 0 10px;border-top:1px solid rgba(127,127,127,.25)}.cp-rhead{display:flex;gap:18px}.cp-rhead div{display:flex;flex-direction:column}.cp-rhead b{font-size:17px}.cp-rhead small,.cp-stopl{opacity:.65;font-size:11.5px}.cp-stops{display:flex;align-items:flex-end;gap:3px;height:36px;margin:8px 0 2px}.cp-stops i{flex:1;background:currentColor;border-radius:2px}.cp-rlist{list-style:none;margin:6px 0 0;padding:0;font-size:12.5px}.cp-rlist li{display:flex;justify-content:space-between;gap:8px;padding:2px 0}.cp-rlist em{opacity:.65;font-style:normal}.cp-extreq{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;padding:8px 10px;border-radius:10px;background:rgba(226,80,26,.1);font-size:12.5px}.cp-extreq button{margin-left:6px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;border-radius:8px;padding:3px 9px;font:inherit;cursor:pointer}.cp-short{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px}.cp-short span{opacity:.65}.cp-short code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.cp-short button{border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;border-radius:8px;padding:3px 9px;font:inherit;cursor:pointer}'}</style>
      {tip && <div className="cp-tip"><Zap size={15} /><span><b>Collaboration makes ideas better</b>Everyone here sees changes as they are saved. Edits are merged, never overwritten.</span><button type="button" onClick={() => { setTip(false); try { localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } }}>Got it</button></div>}
    </aside>
  );
}
