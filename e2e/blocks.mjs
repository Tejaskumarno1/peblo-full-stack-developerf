// Editor blocks: slash menu, AI card, and that video / audio / file / toggle survive save + reopen.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  await page.addInitScript(() => { try { localStorage.setItem('peblo-debug', '1'); } catch { /* ignore */ } });
  const note = (await api('POST', '/api/notes', { title: 'Blocks demo', content: 'Plan the week\n\nBuy milk and call Rohit by Friday', tags: [] })).note;
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(base + '/notes');
  await page.locator('.s-note-row', { hasText: 'Blocks demo' }).first().click();
  const ed = page.locator('.bn-editor');
  await ed.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !!window.__pebloEditor, null, { timeout: 5000 });

  // slash menu has the groups and AI items
  await ed.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.getByText('AI Action items').first().waitFor({ timeout: 5000 });
  check('slash menu lists AI Action items', true);
  check('slash menu lists AI Improve writing', await page.getByText('AI Improve writing').count() > 0);
  check('slash menu lists Table', await page.getByText('Table', { exact: true }).count() > 0);
  check('slash menu lists Toggle', (await page.getByText(/Toggle/).count()) > 0);
  await page.keyboard.press('Escape');

  // AI card: appears, never uses alert()
  await page.keyboard.press('Backspace');
  await page.keyboard.type('/ai action');
  await page.keyboard.press('Enter');
  await page.locator('.pb-aicard').waitFor({ timeout: 8000 });
  check('AI action items opens a card', true);
  await page.locator('.pb-aicard-msg:not(.pb-aicard-msg .pb-spin)').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('AI never pops a browser alert', dialogs.length === 0, dialogs.join('|'));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/blocks-ai.png' });
  await page.locator('.pb-aicard').getByRole('button', { name: 'Close' }).click();
  check('card closes', (await page.locator('.pb-aicard').count()) === 0);

  // insert media / toggle / table / code / divider through the editor
  const VID = 'data:video/mp4;base64,AAAA';
  const AUD = 'data:audio/mpeg;base64,AAAA';
  const FIL = 'data:application/pdf;base64,AAAA';
  await page.evaluate(({ VID, AUD, FIL }) => {
    const e = window.__pebloEditor;
    const last = e.document[e.document.length - 1].id;
    e.insertBlocks([
      { type: 'toggleListItem', content: 'Toggle heading', children: [{ type: 'paragraph', content: 'hidden detail' }] },
      { type: 'video', props: { url: VID, name: 'clip.mp4' } },
      { type: 'audio', props: { url: AUD, name: 'voice.mp3' } },
      { type: 'file', props: { url: FIL, name: 'slides.pdf' } },
      { type: 'codeBlock', props: { language: 'python' }, content: 'print(1)' },
      { type: 'checkListItem', content: 'a checklist item' },
      { type: 'numberedListItem', content: 'first' },
    ], last, 'after');
  }, { VID, AUD, FIL });
  await page.waitForTimeout(2500);
  const saved = (await api('GET', `/api/notes/${note.id}`)).note;
  check('toggle saved', /▸ Toggle heading/.test(saved.content), saved.content);
  check('video saved', /<img src="data:video\/mp4/.test(saved.content));
  check('audio saved', /<img src="data:audio\/mpeg/.test(saved.content));
  check('file saved', /<img src="data:application\/pdf/.test(saved.content));
  check('code block saved with language', /```python/.test(saved.content));

  // reopen: the blocks must come back as real blocks
  await page.goto(base + '/notes');
  await page.locator('.s-note-row', { hasText: 'Blocks demo' }).first().click();
  await page.waitForFunction(() => !!window.__pebloEditor && window.__pebloEditor.document.length > 3, null, { timeout: 15000 });
  const types = await page.evaluate(() => window.__pebloEditor.document.map((b) => b.type));
  check('toggle returns as toggle block', types.includes('toggleListItem'), types.join(','));
  check('video returns as video block', types.includes('video'), types.join(','));
  check('audio returns as audio block', types.includes('audio'), types.join(','));
  check('file returns as file block', types.includes('file'), types.join(','));
  check('code block returns', types.includes('codeBlock'), types.join(','));
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/blocks.png' });
} catch (e) {
  check('blocks test ran without crashing', false, String(e));
} finally {
  await finish();
}
