import { useEffect, useState } from 'react';
import { Card, Row, useSave } from './ui';
import { DEFAULT_CAPTURE_KEY, getWebCaptureKey, setWebCaptureKey, shortcutLabel, toAccelerator } from '../../utils/captureKey';

/** Where the key lives: the desktop shell (window.pebloDesktop, from electron/preload.cjs) or this browser tab. */
function backend() {
  const desktop = typeof window !== 'undefined' ? window.pebloDesktop : null;
  if (desktop) return { desktop: true, ...desktop };
  return {
    desktop: false,
    getCaptureShortcut: async () => ({ shortcut: getWebCaptureKey(), defaultShortcut: DEFAULT_CAPTURE_KEY, registered: true }),
    setCaptureShortcut: async (acc) => { setWebCaptureKey(acc); return { ok: true, shortcut: acc }; },
    resetCaptureShortcut: async () => { setWebCaptureKey(DEFAULT_CAPTURE_KEY); return { ok: true, shortcut: DEFAULT_CAPTURE_KEY }; },
  };
}

/** Lets the person change the quick-capture key: system-wide in the desktop app, while Peblo is open in a browser tab. */
export default function CaptureShortcut() {
  const [api] = useState(backend);
  const save = useSave();
  const [info, setInfo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.getCaptureShortcut().then(setInfo).catch(() => {}); }, [api]);

  if (!info) return null;

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
    apply(api.setCaptureShortcut(acc));
  };

  const where = api.desktop
    ? `Press this anywhere on your ${api.platform === 'win32' ? 'Windows PC' : api.platform === 'darwin' ? 'Mac' : 'computer'} to jot down a note or task, even when Peblo is in the tray.`
    : 'Press this anywhere in Peblo to jot down a note or task. A web page cannot listen outside its tab; the desktop app can.';

  return (
    <Card title="Quick capture key" hint={where}>
      <Row label="Shortcut" hint={info.registered ? (api.desktop ? 'Works anywhere on your computer.' : 'Saved in this browser.') : 'Not active right now: another app is probably using it. Pick another.'}>
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
          <button type="button" className="s-link-btn" onClick={() => apply(api.resetCaptureShortcut())}>Reset to {shortcutLabel(info.defaultShortcut)}</button>
        )}
      </Row>
      {error && <p role="alert" className="s-set-bad">{error}</p>}
    </Card>
  );
}
