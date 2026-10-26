// A shared note, read by a bot: Markdown / JSON from the same link, pictures listed, nothing leaks once sharing stops.
import { boot } from './lib.mjs';

const { base, api, token, check, finish } = await boot();
try {
  // a real (tiny) PNG stored as a picture
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` }, body: png })).json();
  check('0 a picture can be stored', !!up.id, JSON.stringify(up));
  const note = (await api('POST', '/api/notes', { title: 'Bot note', content: `# Heading one\n\nSome words for a bot.\n\n![shot](/api/media/${up.id})\n\n- [ ] a task`, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const url = `${base}/s/note/${tok}`;

  let r = await fetch(url, { headers: { Accept: 'text/markdown' } });
  let t = await r.text();
  check('1 Accept: text/markdown returns Markdown', r.status === 200 && /markdown/.test(r.headers.get('content-type')) && t.startsWith('# Bot note') && t.includes('Some words for a bot.'), t.slice(0, 200));
  check('2 the picture has an absolute address a bot can fetch', t.includes(`${base}/api/media/${up.id}`), t);
  check('3 it says who shared it and whether it can be edited', /Shared by: E2E/.test(t) && /Can be edited through this link: no/.test(t));
  r = await fetch(url + '.md'); t = await r.text();
  check('4 the .md ending works with a normal browser Accept', r.status === 200 && t.startsWith('# Bot note'));
  r = await fetch(url + '.json'); const j = await r.json();
  check('5 the .json ending returns structured data with the picture list', j.title === 'Bot note' && j.images?.length === 1 && j.images[0].url.endsWith(up.id) && /Heading one/.test(j.markdown), JSON.stringify(j).slice(0, 200));
  r = await fetch(url, { headers: { 'User-Agent': 'GPTBot/1.1' } }); t = await r.text();
  check('6 a known AI agent gets Markdown without asking', r.status === 200 && t.startsWith('# Bot note'));
  r = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 Chrome/120' } }); t = await r.text();
  check('7 a person gets the page, which points to the plain version', /<div id="root"/.test(t) && t.includes(`href="${url}.md"`), t.slice(0, 200));
  r = await fetch(`${base}/api/media/${up.id}/text`); const tx = await r.json();
  check('8 the picture text address answers (empty until described)', r.status === 200 && tx.id === up.id && tx.description === null);
  r = await fetch(`${base}/api/media/${up.id}/describe`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  check('9 describing without an AI key says so clearly (no crash)', r.status === 400 && /Gemini key/.test((await r.json()).error || ''));
  r = await fetch(`${base}/s/note/${'a'.repeat(24)}.md`);
  check('10 an unknown link is a plain 404', r.status === 404);
  await api('DELETE', `/api/share/note/${note.id}`);
  r = await fetch(url, { headers: { Accept: 'text/markdown' } });
  check('11 after sharing is turned off the bot gets nothing', r.status === 404 && !(await r.text()).includes('Some words'));
} catch (e) { check('script ran to the end', false, e.stack || e.message); }
await finish();
