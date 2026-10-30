import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readSheetsWith, readSheets, guardPrototypes, XLSX_MAX_BYTES, PARSE_ROWS, MAX_SHEETS, KEEP_COLS } from './sheetRead.js';

const X = createRequire(import.meta.url)('xlsx');
const book = (sheets) => {
  const wb = X.utils.book_new();
  sheets.forEach(([name, rows]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), name));
  const out = X.write(wb, { type: 'array', bookType: 'xlsx' });
  return out instanceof ArrayBuffer ? out : new Uint8Array(out).buffer;
};

test('a normal workbook reads the same as before', () => {
  const { sheets } = readSheetsWith(X, book([['A', [['h1', 'h2'], [1, 2], [3, 4]]], ['B', [['x']]]]));
  assert.deepEqual(sheets.map((s) => s.name), ['A', 'B']);
  assert.deepEqual(sheets[0].rows, [['h1', 'h2'], ['1', '2'], ['3', '4']]);
  assert.equal(sheets[0].cols, 6);
  assert.equal(sheets[0].more, false);
});

test('rows, columns and sheets are limited', () => {
  const tall = Array.from({ length: PARSE_ROWS + 50 }, (_, i) => [i]);
  const wide = [Array.from({ length: 100 }, (_, i) => i)];
  const many = Array.from({ length: MAX_SHEETS + 5 }, (_, i) => [`S${i}`, [[i]]]);
  const t = readSheetsWith(X, book([['T', tall]])).sheets[0];
  assert.equal(t.rows.length, PARSE_ROWS); assert.equal(t.more, true);
  assert.equal(readSheetsWith(X, book([['W', wide]])).sheets[0].rows[0].length, KEEP_COLS);
  assert.equal(readSheetsWith(X, book(many)).sheets.length, MAX_SHEETS);
});

test('names-only counts every sheet', () => {
  assert.equal(readSheetsWith(X, book([['A', [[1]]], ['B', [[1]]]]), { namesOnly: true }).count, 2);
});

test('files over the cap are refused before parsing', async () => {
  const big = new ArrayBuffer(XLSX_MAX_BYTES + 1);
  assert.throws(() => readSheetsWith(X, big), { code: 'big' });
  await assert.rejects(readSheets(big), { code: 'big' });
});

test('prototype pollution is undone and reported', () => {
  const evil = { read() { Object.prototype.polluted = 'yes'; return { SheetNames: [], Sheets: {} }; }, utils: {} };
  assert.throws(() => readSheetsWith(evil, new ArrayBuffer(8)), { code: 'unsafe' });
  assert.equal({}.polluted, undefined);
});

test('the guard is quiet when nothing changes', () => { assert.doesNotThrow(guardPrototypes()); });

test('readSheets falls back to this thread when there is no Worker', async () => {
  const { sheets } = await readSheets(book([['A', [[1, 2]]]]));
  assert.equal(sheets[0].name, 'A');
});
