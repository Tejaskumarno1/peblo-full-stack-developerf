import { useEffect, useState } from 'react';
import { Card, Row, useSave } from './ui';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

/** "CommandOrControl+Shift+Space" -> "Ctrl + Shift + Space" for display. */
export function shortcutLabel(accelerator) {
  return (accelerator || '').split('+').map((p) => (p === 'CommandOrControl' ? (isMac ? '⌘' : 'Ctrl') : p)).join(' + ');
}

/** A key event -> an Electron accelerator, or null while only modifiers are held. */
function toAccelerator(e) {
  const code = e.code || '';
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else if (['Space', 'Tab', 'Backspace', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(code)) key = code;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code.slice(5);
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

/**
 * Lets the person change the global quick-capture key. Only appears inside the desktop app
 * (window.pebloDesktop comes from electron/preload.cjs); in a browser the key does not exist.
 */
export default function CaptureShortcut() {
  const desktop = typeof window !== 'undefined' ? window.pebloDesktop : null;
  const save = useSave();
  const [info, setInfo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (desktop) desktop.getCaptureShortcut().then(setInfo).catch(() => {});
  }, [desktop]);

  if (!desktop || !info) return null;

  // Outside the Settings page there is no header to report to (useSave then does nothing), so run the call here.
  const apply = async (promise) => {
    const res = await promise.catch(() => ({ ok: false, error: 'Could not reach the desktop app.' }));
    if (res.ok) { setInfo((p) => ({ ...p, shortcut: res.shortcut, registered: true })); setError(''); } else setError(res.error || 'That key did not work.');
    save(() => Promise.resolve(res.ok));
  };

  const onKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setRecording(false); setError(''); return; }
    const acc = toAccelerator(e);
    if (!acc) return; // only modifiers so far
    if (!/^(CommandOrControl|Alt)/.test(acc)) { setError('Hold Ctrl (or ⌘) or Alt together with the key.'); return; }
    setRecording(false);
    apply(desktop.setCaptureShortcut(acc));
  };

  return (
    <Card title="Quick capture key" hint="Press this anywhere in Windows to jot down a note or task, even when Peblo is in the tray.">
      <Row label="Shortcut" hint={info.registered ? 'Works anywhere on your computer.' : 'Not active right now: another app is probably using it. Pick another.'}>
        <button
          type="button"
          className={`s-outline s-set-btn${recording ? ' on' : ''}`}
          aria-label={`Quick capture shortcut: ${shortcutLabel(info.shortcut)}. Click to change.`}
          onClick={() => { setRecording(true); setError(''); }}
          onKeyDown={recording ? onKeyDown : undefined}
          onBlur={() => setRecording(false)}
        >
          {recording ? 'Press the new keys… (Esc to cancel)' : <kbd>{shortcutLabel(info.shortcut)}</kbd>}
        </button>
        {info.shortcut !== info.defaultShortcut && (
          <button type="button" className="s-link-btn" onClick={() => apply(desktop.resetCaptureShortcut())}>Reset to {shortcutLabel(info.defaultShortcut)}</button>
        )}
      </Row>
      {error && <p role="alert" className="s-set-bad">{error}</p>}
    </Card>
  );
}
