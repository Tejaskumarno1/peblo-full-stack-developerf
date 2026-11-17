import { useEffect } from 'react';
import { applyAccent, storeAccent, normHex, normalizeSchedule, storeSchedule, loadSchedule, resolveTheme, effectiveDensity, a11yDeviceOnly, applyThemeClasses, applyTextAndColourPrefs, normNoteFont, normLineHeight, colourBlindOn, normExportTheme } from './appearance';
import '../styles/print.css';
import '../styles/appearance-extra.css';
import { normalize as normA11y, apply as applyA11y, store as storeA11y } from './a11yPrefs';

/**
 * Keeps the page in step with the appearance settings (called once, from AuthProvider):
 * the accent colour, the theme (including "Auto by time" and System), density and the account's accessibility options.
 */
export default function useAppearanceSync(settings, theme) {
  // accent colour: the account's value wins; no value means the style's own colour
  const accent = normHex(settings?.accent);
  useEffect(() => { applyAccent(accent); storeAccent(accent); }, [accent]);

  // the schedule is kept on this device too, so the pre-paint script can use it
  const sched = settings?.themeSchedule;
  const schedKey = sched ? JSON.stringify(normalizeSchedule(sched)) : '';
  useEffect(() => { if (schedKey) storeSchedule(JSON.parse(schedKey)); }, [schedKey]);

  // theme: light, dark, midnight, system or auto (dark between two times). Checked every minute and when the window gets focus.
  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const run = () => {
      const resolved = resolveTheme(theme, { systemDark: !!mq?.matches, schedule: schedKey ? JSON.parse(schedKey) : loadSchedule(), date: new Date() });
      if (document.documentElement.hasAttribute('data-theme-preview')) return; // a theme card is being previewed; leaving it restores this
      applyThemeClasses(resolved);
    };
    run();
    const timer = theme === 'auto' ? setInterval(run, 60_000) : null;
    if (theme === 'auto') { window.addEventListener('focus', run); document.addEventListener('visibilitychange', run); }
    if (theme === 'system') mq?.addEventListener('change', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run);
      mq?.removeEventListener('change', run);
    };
  }, [theme, schedKey]);

  // density: one value (settings.noteDensity); the old Compact switch is read when it is unset
  const density = effectiveDensity(settings);
  useEffect(() => { document.documentElement.setAttribute('data-compact', density === 'compact' ? '1' : '0'); }, [density]);

  // "Easy to read" uses fonts already on the computer (Atkinson Hyperlegible, Lexend or OpenDyslexic when installed, else Verdana):
  // the Content-Security-Policy only allows fonts from the app's own origin, so no web font is fetched.
  // note font and line height (FT9, FT10), colour-blind friendly status colours (FT8) and the export / print theme
  const prefsKey = [normNoteFont(settings?.noteFont), normLineHeight(settings?.lineHeight), colourBlindOn(settings), normExportTheme(settings?.exportTheme)].join('|');
  useEffect(() => {
    const [noteFont, lineHeight, cb, exportTheme] = prefsKey.split('|');
    applyTextAndColourPrefs({ noteFont, lineHeight, colourBlind: cb === 'true', exportTheme });
  }, [prefsKey]);

  // accessibility options saved on the account apply here unless this device keeps its own
  const a11yKey = settings?.a11y && typeof settings.a11y === 'object' ? JSON.stringify(normA11y(settings.a11y)) : '';
  useEffect(() => {
    if (!a11yKey || a11yDeviceOnly()) return;
    const p = JSON.parse(a11yKey);
    storeA11y(p);
    applyA11y(p);
  }, [a11yKey]);
}

