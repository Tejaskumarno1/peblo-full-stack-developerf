// Share links: a note and a task can be opened by anyone with the link, read only, and switched off again.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
try {
  const note = (await api('POST', '/api/notes', { title: 'Shared plan', content: '# Heading\n\nSecret-free body text.\n\n<figure><img src="data:video/mp4;base64,AAAA"><figcaption>clip.mp4</figcaption></figure>', tags: [] })).note;
  const todo = (await api('POST', '/api/todos', { text: 'Share this task', priority: 'high', noteId: note.id })).todo;

  // from the screen: note menu -> Share link
  await page.goto(base + '/notes/' + note.id);
  await page.locator('.s-note-row', { hasText: 'Shared plan' }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Share link/ }).click();
  const dlg = page.getByRole('dialog', { name: /Share this note/ });
  await dlg.waitFor({ timeout: 5000 });
  await dlg.getByRole('button', { name: /Create link/ }).click();
  const input = dlg.getByLabel('Share link');
  await input.waitFor({ timeout: 5000 });
  const url = await input.inputValue();
  check('note link looks right', /\/s\/note\/[\w-]{20,}$/.test(url), url);
  check('no "own computer" warning when a public address is set', !(await dlg.textContent()).includes('your own computer'));
  check('link starts with the public address', url.startsWith(base + '/s/note/'), url);
  const cfg = await (await fetch(base + '/api/config')).json();
  check('/api/config answers the public address', cfg.publicUrl === base, JSON.stringify(cfg));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/share.png' });

  // a stranger (no sign-in) opens it
  const guest = await ctx.browser().newContext();
  const g = await guest.newPage();
  await g.goto(url);
  await g.getByRole('heading', { name: 'Shared plan' }).waitFor({ timeout: 10000 });
  check('stranger sees the note text', (await g.textContent('body')).includes('Secret-free body text.'));
  check('video shows as a video player', (await g.locator('video[controls]').count()) === 1);
  check('stranger cannot see an editor', (await g.locator('.bn-editor, textarea').count()) === 0);

  // task link (also shows the linked note)
  const t = (await api('POST', `/api/share/todo/${todo.id}`)).token;
  await g.goto(`${base}/s/task/${t}`);
  await g.getByRole('heading', { name: 'Share this task' }).waitFor({ timeout: 10000 });
  const plain = await g.textContent('body');
  check('task link shows priority but NOT the linked note by default', /high priority/.test(plain) && !/Secret-free body text/.test(plain), plain.slice(0, 200));
  const apiPlain = await (await g.request.get(`${base}/api/public/todo/${t}`)).json();
  check('public task API has no note unless the owner allows it', apiPlain.note === null, JSON.stringify(apiPlain.note));
  const on = await api('POST', `/api/share/todo/${todo.id}`, { shareNote: true });
  check('owner can turn the linked note on', on.shareNote === true);
  await g.goto(`${base}/s/task/${t}`);
  await g.getByRole('heading', { name: 'Share this task' }).waitFor({ timeout: 10000 });
  const body = await g.textContent('body');
  check('task link shows priority and linked note once allowed', /high priority/.test(body) && /Shared plan/.test(body) && /Secret-free body text/.test(body), body.slice(0, 200));
  await g.screenshot({ path: 'C:/Users/tejas/peblo-e2e/share-task.png' });

  // other people's notes cannot be shared, and a wrong link shows a calm message
  const bad = await g.request.get(`${base}/api/public/note/aaaaaaaaaaaaaaaaaaaaaaaa`);
  check('unknown link is 404', bad.status() === 404);
  const noAuth = await g.request.post(`${base}/api/share/note/${note.id}`);
  check('creating a link needs sign-in', noAuth.status() === 401, String(noAuth.status()));

  // stop sharing
  await dlg.getByRole('button', { name: 'Stop sharing' }).click();
  await dlg.getByRole('button', { name: /Create link/ }).waitFor({ timeout: 5000 });
  const gone = await g.request.get(`${base}/api/public/note/${url.split('/').pop()}`);
  check('old link stops working after Stop sharing', gone.status() === 404, String(gone.status()));
  await guest.close();
} catch (e) {
  check('share test ran', false, String(e));
} finally {
  await finish();
}
