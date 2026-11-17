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

// ---------- theme names, preview and classes ----------
/** What the UI calls each theme choice. CSS classes stay theme-dark / theme-midnight. */
export const THEME_LABELS = { light: 'Light', dark: 'Dark', midnight: 'Midnight', system: 'System', auto: 'Auto by time' };
export const themeLabel = (id) => THEME_LABELS[id] || THEME_LABELS.light;
/** The theme the River / Orbit header menu offers next: Light -> Dark -> Midnight -> Light. */
export const nextTheme = (theme) => (theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light');

/** Puts a resolved theme ('light' | 'dark' | 'midnight') on <html> and <body>. */
export function applyThemeClasses(resolved, doc = globalThis.document) {
  if (!doc) return;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    el.classList.toggle('theme-dark', resolved === 'dark' || resolved === 'midnight');
    el.classList.toggle('theme-midnight', resolved === 'midnight');
  }
  doc.documentElement.style.colorScheme = resolved === 'light' ? 'light' : 'dark';
}
/** The resolved theme for a choice right now (System reads the OS, Auto reads the stored schedule). */
export function resolveNow(theme, schedule = null) {
  const systemDark = !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return resolveTheme(theme, { systemDark, schedule: schedule || loadSchedule(), date: new Date() });
}
/**
 * Live preview of a theme choice while a theme card is hovered or focused: `previewTheme('dark')` draws it,
 * `previewTheme(null, current)` puts the current choice back. Nothing is saved.
 */
export function previewTheme(id, current, doc = globalThis.document) {
  if (!doc) return;
  if (id) doc.documentElement.setAttribute('data-theme-preview', id); else doc.documentElement.removeAttribute('data-theme-preview');
  applyThemeClasses(resolveNow(id || current), doc);
}

// ---------- note text: font family and line height (FT9, FT10) ----------
export const NOTE_FONTS = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'easy', label: 'Easy to read' },
];
/** 'sans' (the style's own font, default) | 'serif' | 'mono' | 'easy'. */
export const normNoteFont = (v) => (NOTE_FONTS.some((f) => f.id === v) ? v : 'sans');
/** 'normal' (default) | 'relaxed'. */
export const normLineHeight = (v) => (v === 'relaxed' ? 'relaxed' : 'normal');

// ---------- colour-blind friendly status colours (FT8) ----------
export const colourBlindOn = (settings) => settings?.colourBlind === true;

// ---------- exports and printing (light by default, or the same theme as the app) ----------
export const EXPORT_THEME_KEY = 'peblo-export-theme';
/** 'light' (default) | 'app'. */
export const normExportTheme = (v) => (v === 'app' ? 'app' : 'light');
/** The mode an export or printout is drawn in: always light unless "Same as app" is chosen. */
export const exportModeFor = (setting, resolved) => (normExportTheme(setting) === 'app' && (resolved === 'dark' || resolved === 'midnight') ? resolved : 'light');
const EXPORT_PALETTES = {
  light: { bg: '#FFFFFF', fg: '#1E293B', heading: '#0F172A', muted: '#475569', line: '#E2E8F0', accent: '#4F46E5', codeBg: '#F1F5F9', codeFg: '#0F172A' },
  dark: { bg: '#16141B', fg: '#E7E3EC', heading: '#F5F0F7', muted: '#B9B2C4', line: '#2F2839', accent: '#A5B4FC', codeBg: '#0E0C12', codeFg: '#E7E3EC' },
  midnight: { bg: '#000000', fg: '#E4E1EA', heading: '#F5F0F7', muted: '#B3ADBD', line: '#231C2B', accent: '#A5B4FC', codeBg: '#121016', codeFg: '#E4E1EA' },
};
/** Colours for an export page in a mode. Every text colour is at least 4.5:1 on bg (appearance.test.mjs). */
export const exportPalette = (mode) => EXPORT_PALETTES[mode] || EXPORT_PALETTES.light;
export function loadExportTheme(storage = globalThis.localStorage) { try { return normExportTheme(storage.getItem(EXPORT_THEME_KEY)); } catch { return 'light'; } }
/** The mode for an export made now, from this device's copy of the choice and what is on screen. */
export function currentExportMode(doc = globalThis.document) {
  const html = doc?.documentElement;
  const resolved = html?.classList.contains('theme-midnight') ? 'midnight' : html?.classList.contains('theme-dark') ? 'dark' : 'light';
  return exportModeFor(loadExportTheme(), resolved);
}

/**
 * The text and colour choices as attributes on <html>, read by styles/appearance-extra.css:
 * data-note-font, data-line-height, data-cb (colour-blind palette) and data-print-theme.
 */
export function applyTextAndColourPrefs(settings, doc = globalThis.document, storage = globalThis.localStorage) {
  if (!doc) return;
  const html = doc.documentElement;
  const font = normNoteFont(settings?.noteFont);
  const lh = normLineHeight(settings?.lineHeight);
  const exp = normExportTheme(settings?.exportTheme);
  if (font === 'sans') html.removeAttribute('data-note-font'); else html.setAttribute('data-note-font', font);
  if (lh === 'normal') html.removeAttribute('data-line-height'); else html.setAttribute('data-line-height', lh);
  if (colourBlindOn(settings)) html.setAttribute('data-cb', '1'); else html.removeAttribute('data-cb');
  html.setAttribute('data-print-theme', exp);
  try { if (exp === 'app') storage.setItem(EXPORT_THEME_KEY, 'app'); else storage.removeItem(EXPORT_THEME_KEY); } catch { /* storage blocked */ }
}
