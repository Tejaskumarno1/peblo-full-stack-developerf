import test from 'node:test';
import assert from 'node:assert/strict';
import { normNoteFont, normLineHeight, normExportTheme, exportModeFor, exportPalette, contrast, nextTheme, themeLabel, colourBlindOn, applyTextAndColourPrefs } from './appearance.js';

test('note font and line height fall back to the defaults', () => {
  assert.equal(normNoteFont('serif'), 'serif');
  assert.equal(normNoteFont('easy'), 'easy');
  assert.equal(normNoteFont('comic'), 'sans');
  assert.equal(normNoteFont(undefined), 'sans');
  assert.equal(normLineHeight('relaxed'), 'relaxed');
  assert.equal(normLineHeight('huge'), 'normal');
});

test('exports are light unless "Same as app" and the app is dark', () => {
  assert.equal(normExportTheme(undefined), 'light');
  assert.equal(exportModeFor('light', 'dark'), 'light');
  assert.equal(exportModeFor(undefined, 'midnight'), 'light');
  assert.equal(exportModeFor('app', 'dark'), 'dark');
  assert.equal(exportModeFor('app', 'midnight'), 'midnight');
  assert.equal(exportModeFor('app', 'light'), 'light');
});

test('every export palette text colour reaches 4.5:1 on its page and code colours on the code fill', () => {
  for (const mode of ['light', 'dark', 'midnight']) {
    const p = exportPalette(mode);
    for (const k of ['fg', 'heading', 'muted', 'accent']) assert.ok(contrast(p[k], p.bg) >= 4.5, `${mode} ${k}`);
    assert.ok(contrast(p.codeFg, p.codeBg) >= 4.5, `${mode} code`);
  }
  assert.equal(exportPalette('nope'), exportPalette('light'));
});

test('theme names and the header cycle', () => {
  assert.equal(themeLabel('midnight'), 'Midnight');
  assert.equal(themeLabel('auto'), 'Auto by time');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'midnight');
  assert.equal(nextTheme('midnight'), 'light');
  assert.equal(nextTheme('system'), 'light');
});

test('applyTextAndColourPrefs sets and clears the html attributes', () => {
  const attrs = new Map();
  const html = { setAttribute: (k, v) => attrs.set(k, String(v)), removeAttribute: (k) => attrs.delete(k) };
  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  applyTextAndColourPrefs({ noteFont: 'mono', lineHeight: 'relaxed', colourBlind: true, exportTheme: 'app' }, { documentElement: html }, storage);
  assert.equal(attrs.get('data-note-font'), 'mono');
  assert.equal(attrs.get('data-line-height'), 'relaxed');
  assert.equal(attrs.get('data-cb'), '1');
  assert.equal(attrs.get('data-print-theme'), 'app');
  assert.equal(store.get('peblo-export-theme'), 'app');
  applyTextAndColourPrefs({}, { documentElement: html }, storage);
  assert.ok(!attrs.has('data-note-font') && !attrs.has('data-line-height') && !attrs.has('data-cb'));
  assert.equal(attrs.get('data-print-theme'), 'light');
  assert.ok(!store.has('peblo-export-theme'));
  assert.equal(colourBlindOn({ colourBlind: 'yes' }), false);
});
