// Unit tests for the AI prompt-injection guard and the http-to-https redirect.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = (f) => import(pathToFileURL(path.resolve('dist/server', f)).href);
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, e.message); } };

const { forceHttps } = await load('middleware/security.js');
const run = (env, req) => {
  const saved = { n: process.env.NODE_ENV, p: process.env.TRUST_PROXY };
  process.env.NODE_ENV = env.NODE_ENV; if (env.TRUST_PROXY) process.env.TRUST_PROXY = env.TRUST_PROXY; else delete process.env.TRUST_PROXY;
  let out = { next: false, redirect: null };
  forceHttps({ secure: false, path: '/x', headers: { host: 'h.example' }, originalUrl: '/x?a=1', ...req }, { redirect: (c, u) => { out.redirect = [c, u]; } }, () => { out.next = true; });
  process.env.NODE_ENV = saved.n ?? ''; if (saved.p) process.env.TRUST_PROXY = saved.p; else delete process.env.TRUST_PROXY;
  return out;
};
await t('production behind a proxy: http goes to https (308, same path)', () => assert.deepEqual(run({ NODE_ENV: 'production', TRUST_PROXY: '1' }, {}).redirect, [308, 'https://h.example/x?a=1']));
await t('already https is left alone', () => assert.equal(run({ NODE_ENV: 'production', TRUST_PROXY: '1' }, { secure: true }).next, true));
await t('the health probe is never redirected', () => assert.equal(run({ NODE_ENV: 'production', TRUST_PROXY: '1' }, { path: '/api/health' }).next, true));
await t('local or desktop use (no proxy) is never redirected', () => assert.equal(run({ NODE_ENV: 'production' }, {}).next, true));
await t('development is never redirected', () => assert.equal(run({ NODE_ENV: 'development', TRUST_PROXY: '1' }, {}).next, true));

const src = (await import('node:fs')).readFileSync('server/src/services/aiService.ts', 'utf8');
await t('every system prompt path carries the injection guard', () => assert.ok((src.match(/AI_GUARD/g) || []).length >= 5));
await t('the guard tells the model notes and emails are data, not orders', () => assert.match(src, /untrusted DATA/));
console.log(fails ? `\n${fails} failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
