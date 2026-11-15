import '../../styles/appearance.css';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card, Row, Switch, Seg, useSave } from './ui';
import { ACCENTS, normHex, applyAccent, deriveAccent, contrast, readableOn, DEFAULT_ACCENT, normalizeSchedule, effectiveDensity, a11yDeviceOnly, setA11yDeviceOnly, effectiveA11y } from '../../utils/appearance';
import { load as loadA11y, store as storeA11y, apply as applyA11y, normalize as normA11y } from '../../utils/a11yPrefs';

/** Accent colour: six curated colours plus any colour you pick. Previews live; Apply (or a swatch) saves it on the account. */
export function AccentCard() {
  const { settings } = useAuth();
  const save = useSave();
  const saved = normHex(settings?.accent);
  const [draft, setDraft] = useState(saved || DEFAULT_ACCENT);
  const [text, setText] = useState(saved || DEFAULT_ACCENT);
  useEffect(() => { setDraft(saved || DEFAULT_ACCENT); setText(saved || DEFAULT_ACCENT); }, [saved]);
  // leaving the page drops a preview that was never applied
  useEffect(() => () => { try { applyAccent(normHex(JSON.parse(localStorage.getItem('peblo-settings') || '{}').accent)); } catch { /* ignore */ } }, []);
  const valid = normHex(text);
  const preview = (hex) => { const h = normHex(hex); if (h) { setDraft(h); applyAccent(h === DEFAULT_ACCENT ? null : h); } };
  const choose = (hex) => { preview(hex); setText(hex); save({ accent: hex === DEFAULT_ACCENT ? null : hex }); };
  const fit = valid ? deriveAccent(valid, 'light') : null;
  const on = fit ? fit.on : '#FFFFFF';
  const ratio = fit ? contrast(fit.solid, on).toFixed(1) : '';
  const dirty = !!valid && valid !== (saved || DEFAULT_ACCENT);
  const current = saved || DEFAULT_ACCENT;
  return (
    <Card title="Accent colour" hint="The colour of buttons, highlights and the active tab in every style. Text on it is picked so it stays readable, in light, dark and midnight.">
      <div className="ax-swatches" role="radiogroup" aria-label="Accent colour">
        {ACCENTS.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={current === a.hex && !dirty} aria-label={a.name} title={a.name} className="ax-sw" style={{ '--ax': a.hex, '--ax-on': readableOn(a.hex) }} onClick={() => choose(a.hex)}>
            <span aria-hidden="true">{current === a.hex && !dirty ? '✓' : ''}</span>
          </button>
        ))}
      </div>
      <Row label="Custom colour" hint={valid ? `Text on it: ${on === '#FFFFFF' ? 'white' : 'dark'} (${ratio}:1).` : 'Use a hex colour such as #4F46E5.'} htmlFor="ax-hex">
        <span className="ax-custom">
          <input type="color" aria-label="Pick a colour" value={draft} onChange={(e) => { setText(e.target.value.toUpperCase()); preview(e.target.value); }} />
          <input id="ax-hex" className="ax-hex" type="text" maxLength={7} spellCheck={false} value={text} aria-invalid={!valid} aria-describedby="ax-hex-err"
            onChange={(e) => { setText(e.target.value); preview(e.target.value); }} />
          <button type="button" className="s-outline s-set-btn" disabled={!dirty} onClick={() => choose(valid)}>Apply</button>
          <button type="button" className="s-outline s-set-btn" disabled={!saved && !dirty} onClick={() => choose(DEFAULT_ACCENT)}>Reset</button>
        </span>
      </Row>
      <small id="ax-hex-err" role="alert" className="ax-err">{!valid && text ? 'That is not a colour. Try #4F46E5.' : ''}</small>
      <div className="ax-preview" aria-hidden="true">
        {['light', 'dark', 'midnight'].map((m) => { const d = deriveAccent(valid || draft, m); return <span key={m} className="ax-pv" style={{ background: d.solid, color: d.on }}>{m}</span>; })}
      </div>
    </Card>
  );
}

/** "Dark from HH:MM to HH:MM": shown under the theme choices once "Auto by time" is picked. */
export function ScheduleRow() {
  const { theme, settings } = useAuth();
  const save = useSave();
  if (theme !== 'auto') return null;
  const s = normalizeSchedule(settings?.themeSchedule);
  const set = (patch) => save({ themeSchedule: { ...s, ...patch } });
  return (
    <Row label="Dark from" hint="Light the rest of the day. Checked every minute." stack>
      <span className="ax-sched" data-testid="dark-schedule">
        <label>From <input type="time" aria-label="Dark from" value={s.from} onChange={(e) => e.target.value && set({ from: e.target.value })} /></label>
        <label>to <input type="time" aria-label="Dark until" value={s.to} onChange={(e) => e.target.value && set({ to: e.target.value })} /></label>
        <Seg label="Dark theme at night" value={s.dark} onChange={(v) => set({ dark: v })} options={[{ id: 'dark', label: 'Dark' }, { id: 'midnight', label: 'Midnight' }]} />
      </span>
    </Row>
  );
}

/** The one Compact switch. It is the same value as Settings > Notes > Density and the notes list View menu. */
export function DensityRow() {
  const { settings } = useAuth();
  const save = useSave();
  return (
    <Row label="Compact" hint="Tighter lists and cards, so more fits on screen. Same as Density under Notes.">
      <Switch label="Compact" checked={effectiveDensity(settings) === 'compact'} onChange={(v) => save({ noteDensity: v ? 'compact' : 'cozy' })} />
    </Row>
  );
}

/** Text size (the one global control), motion, contrast and focus ring. Saved on the account unless this device keeps its own. */
export function A11yCard() {
  const { settings } = useAuth();
  const save = useSave();
  const [deviceOnly, setDeviceOnly] = useState(() => a11yDeviceOnly());
  const [p, setP] = useState(() => effectiveA11y(settings?.a11y && normA11y(settings.a11y), loadA11y(), a11yDeviceOnly()));
  const acct = settings?.a11y ? JSON.stringify(normA11y(settings.a11y)) : '';
  useEffect(() => { if (acct && !deviceOnly) setP(JSON.parse(acct)); }, [acct, deviceOnly]);
  const set = (patch) => {
    const n = normA11y({ ...p, ...patch });
    setP(n); storeA11y(n); applyA11y(n);
    if (!deviceOnly) save({ a11y: n });
  };
  const toggleDevice = (v) => {
    setDeviceOnly(v); setA11yDeviceOnly(v);
    if (!v) save({ a11y: normA11y(p) }); // sharing again: this device's choices go to the account
  };
  return (
    <Card title="Accessibility" hint={deviceOnly ? 'This device keeps its own choices; the account is not changed.' : 'Saved on your account, so every device follows. Turn on "Only this device" to differ.'}>
      <Row label="Text size" hint="Makes the whole app larger or smaller. This is the one text size control.">
        <Seg label="Text size" value={p.size} onChange={(v) => set({ size: v })} options={[{ id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }, { id: 'XL', label: 'XL' }]} />
      </Row>
      <Row label="Reduce motion" hint="Turns off animations and slides."><Switch label="Reduce motion" checked={p.motion} onChange={(v) => set({ motion: v })} /></Row>
      <Row label="High contrast" hint="Darker text and clearer outlines in every style."><Switch label="High contrast" checked={p.contrast} onChange={(v) => set({ contrast: v })} /></Row>
      <Row label="Visible focus ring" hint="A bold outline on whatever the keyboard is on."><Switch label="Visible focus ring" checked={p.focus} onChange={(v) => set({ focus: v })} /></Row>
      <Row label="Only this device" hint="Keep these four choices on this device instead of the account."><Switch label="Only this device" checked={deviceOnly} onChange={toggleDevice} /></Row>
    </Card>
  );
}
