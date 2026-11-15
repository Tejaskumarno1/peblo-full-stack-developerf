// Appearance helpers: accent colour, the dark-mode schedule, density and the account copy of the accessibility options.
// Pure functions first (unit tested in appearance.test.mjs); the few functions that touch the page take the document as an argument.

// ---------- colour maths ----------
export const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** '#abc' / 'ABCDEF' -> '#AABBCC', or null when it is not a colour. */
export function normHex(v) {
  const m = HEX_RE.exec(String(v ?? '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toUpperCase()}`;
}
export const toRgb = (hex) => { const h = normHex(hex).slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
export const toHex = (rgb) => `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/** WCAG relative luminance. */
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Mix a towards b: t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) { const A = toRgb(a), B = toRgb(b); return toHex(A.map((c, i) => c + (B[i] - c) * t)); }

const WHITE = '#FFFFFF';
const DARK_INK = '#1A1210';
/** The text colour to put on top of an accent fill: whichever of white and near-black reads better. */
export function readableOn(bg) {
  return contrast(bg, WHITE) >= contrast(bg, DARK_INK) ? WHITE : DARK_INK;
}
/** The fill itself, nudged lighter or darker when neither white nor dark text reaches 4.5 on it (mid greys, about 1 in 20 colours). */
export function fitFill(hex) {
  let c = normHex(hex) || DEFAULT_ACCENT;
  const towards = luminance(c) > 0.18 ? WHITE : '#000000';
  for (let i = 0; i < 40 && contrast(c, readableOn(c)) < 4.5; i++) c = mix(c, towards, 0.04);
  return c;
}
/** Moves `hex` towards black (or white) until it reaches `min` contrast on `bg`. */
export function ensureContrast(hex, bg, min = 4.5) {
  let c = hex;
  const towards = luminance(bg) > 0.4 ? '#000000' : WHITE;
  for (let i = 0; i < 40 && contrast(c, bg) < min; i++) c = mix(c, towards, 0.06);
  return c;
}
/** Lightens a colour until it is bright enough to be seen on a dark surface. */
export function lighten(hex, minLum = 0.28) {
  let c = hex;
  for (let i = 0; i < 40 && luminance(c) < minLum; i++) c = mix(c, WHITE, 0.07);
  return c;
}

// ---------- accent ----------
export const ACCENTS = [
  { id: 'terracotta', name: 'Terracotta', hex: '#C4441C' },
  { id: 'indigo', name: 'Indigo', hex: '#4F46E5' },
  { id: 'teal', name: 'Teal', hex: '#0F766E' },
  { id: 'forest', name: 'Forest', hex: '#2F7D32' },
  { id: 'rose', name: 'Rose', hex: '#BE185D' },
  { id: 'blue', name: 'Blue', hex: '#2563EB' },
];
export const DEFAULT_ACCENT = ACCENTS[0].hex;

// the surfaces text and fills sit on, per mode (Soft's own backgrounds; River, Orbit and Studio are close to these)
const SURFACE = { light: '#FFFFFF', dark: '#1F1A27', midnight: '#141019' };

/** Colours for one mode. light: the chosen colour is the fill; dark and midnight: it is lightened so it shows on dark. */
export function deriveAccent(hex, mode = 'light') {
  const base = normHex(hex) || DEFAULT_ACCENT;
  const surface = SURFACE[mode] || SURFACE.light;
  if (mode === 'light') {
    const solid = fitFill(base);
    const ink = ensureContrast(base, surface, 4.5);
    return { solid, ink, soft: mix(base, WHITE, 0.86), on: readableOn(solid) };
  }
  const solid = fitFill(lighten(base));
  const ink = mix(solid, WHITE, 0.15);
  const ink2 = contrast(ink, surface) >= 4.5 ? ink : lighten(ink, 0.45);
  return { solid, ink: ink2, soft: mix(solid, surface, 0.82), on: readableOn(solid) };
}

/** The CSS that re-colours every style. `html:root` keeps it above the theme blocks whatever order the files load in. */
export function buildAccentCss(hex) {
  const base = normHex(hex);
  if (!base) return '';
  // .soft / .river / .orbit are on a wrapper inside <html>, so the descendant form is used
  const build = (scope, mode) => {
    const a = deriveAccent(base, mode);
    return `${scope} .soft{--s-accent:${a.solid};--s-accent-ink:${a.ink};--s-accent-soft:${a.soft};--s-on-accent:${a.on};--s-dock-on:${a.solid};--s-dock-on-fg:${a.on}}`
      + `${scope} .river{--r-now:${a.solid};--r-now-ink:${a.ink};--r-on-now:${a.on}}`
      + `${scope} .orbit{--o-path:${a.solid};--o-path-ink:${a.ink};--o-path-soft:${a.soft};--o-on-path:${a.on}}`
      + `${scope}[data-style]{--pb-accent:${a.ink};--pb-solid:${a.solid};--pb-on-solid:${a.on};--pb-soft:${a.soft};--pb-ring:${a.solid}}`;
  };
  return [build('html:root', 'light'), build('html:root.theme-dark', 'dark'), build('html:root.theme-dark.theme-midnight', 'midnight')].join('\n');
}

export const ACCENT_KEY = 'peblo-accent';
export const ACCENT_CSS_KEY = 'peblo-accent-css'; // the generated CSS, so the pre-paint script in index.html needs no colour maths
export function loadAccent(storage = globalThis.localStorage) {
  try { return normHex(storage.getItem(ACCENT_KEY)); } catch { return null; }
}
export function storeAccent(hex, storage = globalThis.localStorage) {
  try {
    const h = normHex(hex);
    if (!h) { storage.removeItem(ACCENT_KEY); storage.removeItem(ACCENT_CSS_KEY); return; }
    storage.setItem(ACCENT_KEY, h);
    storage.setItem(ACCENT_CSS_KEY, buildAccentCss(h));
  } catch { /* storage blocked: the accent still applies for this session */ }
}
/** Puts the accent on the page (null removes it). Does not write storage. */
export function applyAccent(hex, doc = globalThis.document) {
  if (!doc) return;
  let tag = doc.getElementById('pb-accent');
  const css = buildAccentCss(hex);
  if (!css) { if (tag) tag.remove(); doc.documentElement.removeAttribute('data-accent'); return; }
  if (!tag) { tag = doc.createElement('style'); tag.id = 'pb-accent'; doc.head.appendChild(tag); }
  tag.textContent = css;
  doc.documentElement.setAttribute('data-accent', normHex(hex));
}

// ---------- dark-mode schedule ----------
export const SCHEDULE_KEY = 'peblo-schedule';
export const DEFAULT_SCHEDULE = { from: '20:00', to: '07:00', dark: 'dark' };
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function normalizeSchedule(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    from: TIME_RE.test(r.from) ? r.from : DEFAULT_SCHEDULE.from,
    to: TIME_RE.test(r.to) ? r.to : DEFAULT_SCHEDULE.to,
    dark: r.dark === 'midnight' ? 'midnight' : 'dark',
  };
}
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
/** True when `date` is inside from..to. The window may run past midnight (20:00 to 07:00). from === to means never. */
export function inDarkWindow(date, schedule) {
  const s = normalizeSchedule(schedule);
  const a = mins(s.from), b = mins(s.to), n = date.getHours() * 60 + date.getMinutes();
  if (a === b) return false;
  return a < b ? n >= a && n < b : n >= a || n < b;
}
/** The theme that is really drawn: 'light' | 'dark' | 'midnight'. */
export function resolveTheme(theme, { systemDark = false, schedule = null, date = new Date() } = {}) {
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  if (theme === 'auto') return inDarkWindow(date, schedule) ? normalizeSchedule(schedule).dark : 'light';
  return theme === 'dark' || theme === 'midnight' ? theme : 'light';
}
export function loadSchedule(storage = globalThis.localStorage) {
  try { return normalizeSchedule(JSON.parse(storage.getItem(SCHEDULE_KEY) || 'null')); } catch { return { ...DEFAULT_SCHEDULE }; }
}
export function storeSchedule(s, storage = globalThis.localStorage) {
  try { storage.setItem(SCHEDULE_KEY, JSON.stringify(normalizeSchedule(s))); } catch { /* ignore */ }
}

// ---------- density: one value (settings.noteDensity), old keys still read ----------
/** 'cozy' | 'compact'. settings.noteDensity wins; the old global Compact switch (settings.compact) is read when it is unset. */
export function effectiveDensity(settings) {
  if (settings?.noteDensity === 'compact' || settings?.noteDensity === 'cozy') return settings.noteDensity;
  return settings?.compact ? 'compact' : 'cozy';
}

// ---------- note text size: one value (settings.fontSize), the old per-note key still read ----------
const OLD_NOTE_FONT = { s: 'small', m: 'medium', l: 'large', xl: 'large' };
export function effectiveNoteFont(settings, legacy) {
  if (['small', 'medium', 'large'].includes(settings?.fontSize) && settings.fontSize !== 'medium') return settings.fontSize;
  if (settings?.fontSize === 'medium' && !legacy) return 'medium';
  return OLD_NOTE_FONT[legacy] || settings?.fontSize || 'medium';
}

// ---------- accessibility options: account copy plus a device-local override ----------
export const A11Y_DEVICE_KEY = 'peblo-a11y-device'; // '1' = this device keeps its own choices
export function a11yDeviceOnly(storage = globalThis.localStorage) { try { return storage.getItem(A11Y_DEVICE_KEY) === '1'; } catch { return false; } }
export function setA11yDeviceOnly(on, storage = globalThis.localStorage) { try { if (on) storage.setItem(A11Y_DEVICE_KEY, '1'); else storage.removeItem(A11Y_DEVICE_KEY); } catch { /* ignore */ } }
/** Which options apply: the device's own when it is set to override, otherwise the account's (when it has any), otherwise the device's. */
export function effectiveA11y(account, local, deviceOnly) {
  return deviceOnly || !account || typeof account !== 'object' ? local : account;
}
