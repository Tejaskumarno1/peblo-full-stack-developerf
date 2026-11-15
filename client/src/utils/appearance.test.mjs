import test from 'node:test';
import assert from 'node:assert/strict';
import { normHex, contrast, readableOn, fitFill, deriveAccent, buildAccentCss, ACCENTS, inDarkWindow, resolveTheme, normalizeSchedule, effectiveDensity, effectiveNoteFont, effectiveA11y, loadAccent, storeAccent } from './appearance.js';

test('normHex accepts 3 and 6 digit colours and rejects the rest', () => {
  assert.equal(normHex('#abc'), '#AABBCC');
  assert.equal(normHex('4f46e5'), '#4F46E5');
  for (const bad of ['', 'red', '#12', '#12345', '#GGGGGG', null, undefined, 42]) assert.equal(normHex(bad), null);
});
test('contrast matches the WCAG reference values', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#FFFFFF').toFixed(2), '4.48');
});
test('text on any accent is readable (>= 4.5) for the curated and for awkward colours', () => {
  const awkward = ['#FFFF00', '#00FFFF', '#808080', '#777777', '#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#000000', '#FF8F6B'];
  for (const hex of [...ACCENTS.map((a) => a.hex), ...awkward]) {
    const f = fitFill(hex);
    assert.ok(contrast(f, readableOn(f)) >= 4.5, `${hex} fitted to ${f}`);
    for (const mode of ['light', 'dark', 'midnight']) {
      const d = deriveAccent(hex, mode);
      assert.ok(contrast(d.solid, d.on) >= 4.5, `${hex} ${mode} fill`);
      assert.ok(contrast(d.ink, mode === 'light' ? '#FFFFFF' : mode === 'dark' ? '#1F1A27' : '#141019') >= 4.5, `${hex} ${mode} ink`);
    }
  }
});
test('dark and midnight variants are lighter than a dark choice', () => {
  assert.notEqual(deriveAccent('#0F766E', 'dark').solid, '#0F766E');
  assert.equal(deriveAccent('#0F766E', 'light').solid, '#0F766E');
});
test('generated css re-colours Soft, River, Orbit and Studio/Console in every mode', () => {
  const css = buildAccentCss('#0F766E');
  for (const needle of ['--s-accent:', '--s-accent-ink:', '--s-accent-soft:', '--s-on-accent:', '--r-now:', '--r-now-ink:', '--o-path:', '--o-path-soft:', '--pb-solid:', 'theme-midnight']) assert.ok(css.includes(needle), needle);
  assert.equal(buildAccentCss('nope'), '');
});
test('accent storage keeps the colour and the css for the pre-paint script', () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  storeAccent('#be185d', st);
  assert.equal(loadAccent(st), '#BE185D');
  assert.ok(m.get('peblo-accent-css').includes('#BE185D'));
  storeAccent(null, st);
  assert.equal(loadAccent(st), null);
  assert.equal(m.size, 0);
});
test('the dark window can span midnight', () => {
  const at = (h, mi) => new Date(2026, 0, 5, h, mi);
  const s = { from: '20:00', to: '07:00' };
  assert.equal(inDarkWindow(at(21, 0), s), true);
  assert.equal(inDarkWindow(at(3, 30), s), true);
  assert.equal(inDarkWindow(at(7, 0), s), false);
  assert.equal(inDarkWindow(at(12, 0), s), false);
  assert.equal(inDarkWindow(at(20, 0), s), true);
  assert.equal(inDarkWindow(at(12, 0), { from: '09:00', to: '17:00' }), true);
  assert.equal(inDarkWindow(at(18, 0), { from: '09:00', to: '17:00' }), false);
  assert.equal(inDarkWindow(at(12, 0), { from: '10:00', to: '10:00' }), false);
});
test('resolveTheme: auto follows the clock, system follows the OS', () => {
  const night = new Date(2026, 0, 5, 23, 0), noon = new Date(2026, 0, 5, 12, 0);
  assert.equal(resolveTheme('auto', { schedule: { from: '20:00', to: '07:00' }, date: night }), 'dark');
  assert.equal(resolveTheme('auto', { schedule: { from: '20:00', to: '07:00', dark: 'midnight' }, date: night }), 'midnight');
  assert.equal(resolveTheme('auto', { schedule: { from: '20:00', to: '07:00' }, date: noon }), 'light');
  assert.equal(resolveTheme('system', { systemDark: true }), 'dark');
  assert.equal(resolveTheme('midnight'), 'midnight');
  assert.equal(resolveTheme('weird'), 'light');
});
test('normalizeSchedule repairs bad values', () => {
  assert.deepEqual(normalizeSchedule({ from: '25:00', to: 'x', dark: 'blue' }), { from: '20:00', to: '07:00', dark: 'dark' });
  assert.deepEqual(normalizeSchedule(null), { from: '20:00', to: '07:00', dark: 'dark' });
});
test('density: noteDensity wins, the old Compact switch is read when it is unset', () => {
  assert.equal(effectiveDensity({ noteDensity: 'compact', compact: false }), 'compact');
  assert.equal(effectiveDensity({ noteDensity: 'cozy', compact: true }), 'cozy');
  assert.equal(effectiveDensity({ compact: true }), 'compact');
  assert.equal(effectiveDensity({}), 'cozy');
  assert.equal(effectiveDensity(null), 'cozy');
});
test('note text size: the account value, the old per-note key as a fallback', () => {
  assert.equal(effectiveNoteFont({ fontSize: 'large' }, 's'), 'large');
  assert.equal(effectiveNoteFont({ fontSize: 'medium' }, null), 'medium');
  assert.equal(effectiveNoteFont({ fontSize: 'medium' }, 's'), 'small');
  assert.equal(effectiveNoteFont({}, 'xl'), 'large');
  assert.equal(effectiveNoteFont({}, null), 'medium');
});
test('a11y: the device override beats the account', () => {
  const acct = { size: 'L' }, local = { size: 'S' };
  assert.equal(effectiveA11y(acct, local, true), local);
  assert.equal(effectiveA11y(acct, local, false), acct);
  assert.equal(effectiveA11y(null, local, false), local);
});
