import { useEffect, useState } from 'react';

/* Seeing other people's mouse pointers, text cursors and "edited by" hints is off until you turn it on.
   One switch, remembered in this browser, shared by the app and the share page (key peblo-pointers). */
export const presenceOn = () => { try { return localStorage.getItem('peblo-pointers') === 'on'; } catch { return false; } };

const apply = () => { try { document.documentElement.classList.toggle('pb-presence-off', !presenceOn()); } catch { /* no document */ } };
apply();

export function setPresence(on) {
  try { localStorage.setItem('peblo-pointers', on ? 'on' : 'off'); } catch { /* not remembered */ }
  apply();
  window.dispatchEvent(new Event('pb-pointers-pref'));
}

export function usePresence() {
  const [on, setOn] = useState(presenceOn);
  useEffect(() => {
    const f = () => { setOn(presenceOn()); apply(); };
    window.addEventListener('pb-pointers-pref', f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener('pb-pointers-pref', f); window.removeEventListener('storage', f); };
  }, []);
  return [on, setPresence];
}
