// Unit checks for AI connections: key recognition, model suggestion, and the address rules (desktop vs hosted). Usage: npm run build:server && node scripts/connections-unit.mjs
import path from 'path'; import { pathToFileURL } from 'url';
process.env.DATABASE_URL = 'postgresql://x:y@127.0.0.1:1/peblo_test';
const P = await import(pathToFileURL(path.resolve('dist/server/services/aiProviders.js')).href);
let bad = 0; const t = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) { bad++; if (x) console.log('   ', x); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
t('sk-ant → anthropic', eq(P.candidatesFor('sk-ant-api03-abc'), ['anthropic']));
t('sk-or → openrouter', eq(P.candidatesFor('sk-or-v1-abc'), ['openrouter']));
t('gsk_ → groq', eq(P.candidatesFor('gsk_abc'), ['groq']));
t('xai- → xai', eq(P.candidatesFor('xai-abc'), ['xai']));
t('AIza → gemini', eq(P.candidatesFor('AIzaSyabc'), ['gemini']));
t('sk-proj → openai', eq(P.candidatesFor('sk-proj-abc'), ['openai']));
t('32-hex sk- → deepseek then openai', eq(P.candidatesFor('sk-' + 'a1'.repeat(16)), ['deepseek', 'openai']));
t('plain sk- → openai then deepseek', eq(P.candidatesFor('sk-' + 'Zx'.repeat(24)), ['openai', 'deepseek']));
t('64 hex → together', eq(P.candidatesFor('ab'.repeat(32)), ['together']));
t('32 alnum → mistral', eq(P.candidatesFor('Ab3'.repeat(10) + 'xy'), ['mistral']));
t('unknown → ask', eq(P.candidatesFor('hello world'), []) && eq(P.candidatesFor('  '), []));
t('suggestModel prefers the usual one', P.suggestModel('groq', ['a-embed', 'llama-3.3-70b-versatile', 'z']) === 'llama-3.3-70b-versatile');
t('suggestModel skips non-chat models', P.suggestModel('custom', ['text-embedding-3', 'whisper-1', 'chat-a']) === 'chat-a');
// desktop (not hosted): any address is fine
let r = await P.checkBaseUrl('http://127.0.0.1:1234/v1/');
t('desktop: localhost allowed, trailing slash cleaned', r.problem === null && r.url === 'http://127.0.0.1:1234/v1', r);
t('query part refused', (await P.checkBaseUrl('https://a.b/v1?x=1')).problem !== null);
t('ftp refused', (await P.checkBaseUrl('ftp://a.b')).problem !== null);
// hosted
process.env.PEBLO_HOSTED = '1';
for (const u of ['http://8.8.8.8/v1', 'https://localhost/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/v1', 'https://10.0.0.5/v1', 'https://[::1]/v1', 'https://192.168.1.2/v1', 'https://foo.internal/v1']) {
  t('hosted refuses ' + u, (await P.checkBaseUrl(u)).problem !== null);
}
r = await P.checkBaseUrl('https://8.8.8.8/v1');
t('hosted allows a public https address', r.problem === null, r);
const kept = await P.usableConnections([{ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' }, { provider: 'custom', baseUrl: 'https://10.0.0.1/v1' }, { provider: 'custom', baseUrl: 'https://8.8.8.8/v1' }]);
t('hosted use-time check drops unsafe custom addresses only', kept.length === 2 && kept[0].provider === 'groq' && kept[1].baseUrl === 'https://8.8.8.8/v1', kept);
const v = await P.verifyConnection('custom', 'k', 'https://10.0.0.1/v1');
t('hosted verify never calls a private address', v.ok === false && v.failure === 'address', v);
process.exit(bad ? 1 : 0);
