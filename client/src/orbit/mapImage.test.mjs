import test from 'node:test';
import assert from 'node:assert/strict';
import { mapToSvg } from './mapImage.js';

const nodes = [
  { x: 300, y: 100, d: 120, name: 'Joins <b>', kind: 'topic', level: 'weak', count: 1, tag: 'joins' },
  { x: 100, y: 300, d: 100, name: 'Normal forms', kind: 'topic', level: 'strong', count: 3, tag: 'nf' },
];

test('mapToSvg draws every topic and escapes names', () => {
  const svg = mapToSvg({ nodes, center: { name: 'DBMS' }, cx: 200, cy: 200, colours: { joins: '#ff0000' }, icons: { nf: '🧠' } });
  assert.match(svg, /^<svg xmlns=/);
  assert.equal((svg.match(/<circle/g) || []).length, 3);
  assert.ok(svg.includes('Joins &lt;b&gt;'));
  assert.ok(!svg.includes('<b>'));
  assert.ok(svg.includes('#ff000033'));
  assert.ok(svg.includes('🧠 Normal forms'));
  assert.ok(svg.includes('1 note<'));
  assert.ok(svg.includes('3 notes'));
});

test('mapToSvg copes with an empty map', () => {
  const svg = mapToSvg({ nodes: [], center: { name: 'Empty' }, cx: 0, cy: 0 });
  assert.ok(svg.includes('Empty'));
});
