// Orbit look preferences, kept in the account settings as settings.orbit.
export const ACCENTS = {
  blue: { label: 'Blue', hex: '#2350FF', soft: '#E8EDFF' },
  green: { label: 'Green', hex: '#14804A', soft: '#E3F5EA' },
  purple: { label: 'Purple', hex: '#7A3FD1', soft: '#F0E8FB' },
  orange: { label: 'Orange', hex: '#C2530A', soft: '#FDEBDD' },
  pink: { label: 'Pink', hex: '#C2307E', soft: '#FBE6F1' },
};
export const SCALES = { small: 0.92, normal: 1, large: 1.12, xlarge: 1.25 };

export const orbitPrefs = (settings) => (settings && typeof settings.orbit === 'object' && settings.orbit) || {};

/** Extra class names for the .orbit root. */
export function prefsClass(p) {
  const out = [];
  if (p.font === 'serif') out.push('o-font-serif');
  if (p.font === 'mono') out.push('o-font-mono');
  if (p.width === 'wide') out.push('o-wide');
  if (p.contrast) out.push('o-contrast');
  if (p.motion === 'off') out.push('o-reduce');
  else if (p.motion !== 'on') out.push('o-motion-system');
  return out.join(' ');
}

/** Inline style for the .orbit root (accent colour, text size). */
export function prefsStyle(p) {
  const style = {};
  const a = ACCENTS[p.accent];
  if (a && p.accent !== 'blue') { style['--o-path'] = a.hex; style['--o-path-soft'] = a.soft; style['--o-path-ink'] = a.hex; }
  const z = SCALES[p.scale];
  if (z && z !== 1) style.zoom = z;
  return style;
}
