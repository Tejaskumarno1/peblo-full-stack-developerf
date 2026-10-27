import { useEffect, useState } from 'react';

/* Seeing other people's mouse pointers, text cursors and "edited by" hints.
   On a share page it is on from the start (key peblo-pointers; the switch there turns it off). In the app it is off until it is turned on,
   and it is switched on by itself while a note is in full screen (key peblo-pointers-app; the older shared key still turns it on there). */
const onSharePage = () => { try { return /^\/s\//.test(window.location.pathname); } catch { return false; } };
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const appPref = () => read('peblo-pointers-app');
export const presenceOn = () => {
  if (onSharePage()) return read('peblo-pointers') !== 'off';
  const own = appPref();
  if (own) return own === 'on';
  return read('peblo-pointers') === 'on';
};

const apply = () => { try { document.documentElement.classList.toggle('pb-presence-off', !presenceOn()); } catch { /* no document */ } };
apply();

export function setPresence(on) {
  try { localStorage.setItem(onSharePage() ? 'peblo-pointers' : 'peblo-pointers-app', on ? 'on' : 'off'); } catch { /* not remembered */ }
  apply();
  window.dispatchEvent(new Event('pb-pointers-pref'));
}
/** Put the app's own choice back to what it was (null = never chosen, which means off). */
export function restoreAppPresence(prev) {
  try { localStorage.setItem('peblo-pointers-app', prev === 'on' ? 'on' : 'off'); } catch { /* not remembered */ }
  apply();
  window.dispatchEvent(new Event('pb-pointers-pref'));
}

export function usePresence() {
  const [on, setOn] = useState(presenceOn);
  useEffect(() => {
    const f = () => { setOn(presenceOn()); apply(); };
    f();
    window.addEventListener('pb-pointers-pref', f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener('pb-pointers-pref', f); window.removeEventListener('storage', f); };
  }, []);
  return [on, setPresence];
}
