// Pictures, GIF, video, voice notes, dictation: insert menu, drop veil, group bar (stack / grid / row), inline crop, mic pill.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// fake speech and microphone so the real controls can be driven without hardware
await page.addInitScript(() => {
  window.__srs = [];
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    constructor() { window.__srs.push(this); this.started = 0; }
    start() { this.started += 1; this.on = true; }
    stop() { this.on = false; this.onend && this.onend(); }
    abort() { this.on = false; }
  };
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const dest = ac.createMediaStreamDestination();
  const osc = ac.createOscillator(); osc.connect(dest); osc.start();
  navigator.mediaDevices.getUserMedia = async () => { await ac.resume(); return dest.stream; };
});

const png = async (w, h, hue) => page.evaluate(async ([w, h, hue]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, `hsl(${hue},80%,60%)`); g.addColorStop(1, `hsl(${hue + 80},80%,50%)`);
  x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(0, 0, w / 4, h / 4);
  const b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
}, [w, h, hue]);

async function slash(text) {
  await page.keyboard.type('/' + text);
  await page.locator('.bn-suggestion-menu').waitFor({ timeout: 5000 });
  await wait(500);
}
async function newLine() {
  if (await page.locator('[data-testid="group-bar"]').count()) {
    const bb = await page.locator('.bn-block-content').first().boundingBox();
    await page.mouse.click(bb.x + Math.min(540, bb.width - 40), bb.y + bb.height / 2);
  } else await page.locator('.bn-block-content').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
}

try {
  const n = (await api('POST', '/api/notes', { title: 'Media probe', content: 'Team offsite photos.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1500);

  // ---- the insert menu
  await newLine();
  await page.keyboard.type('/');
  await page.locator('.bn-suggestion-menu').waitFor({ timeout: 5000 });
  const labels = await page.locator('.bn-suggestion-menu-item .bn-mt-suggestion-menu-item-title').allInnerTexts();
  const first5 = labels.slice(0, 5).map((s) => s.trim());
  check('insert menu: Media group leads with Pictures, GIF, Video, Voice note, Dictate', JSON.stringify(first5) === JSON.stringify(['Pictures', 'GIF', 'Video', 'Voice note', 'Dictate']), first5.join(' | '));
  check('insert menu: shows shortcut hints (/pic)', /\/pic/i.test(await page.locator('.bn-suggestion-menu').innerText()));
  check('insert menu: only one Video entry', labels.filter((s) => s.trim() === 'Video').length === 1);
  await page.keyboard.press('Escape'); await wait(300);
  await page.keyboard.press('Backspace'); await wait(500);

  // ---- Pictures: pick three at once
  await slash('pic');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const fc = await chooser;
  check('Pictures: the file chooser allows many files', await fc.isMultiple());
  await fc.setFiles([
    { name: 'team.png', mimeType: 'image/png', buffer: Buffer.from(await png(640, 480, 10)) },
    { name: 'stage.png', mimeType: 'image/png', buffer: Buffer.from(await png(640, 480, 120)) },
    { name: 'demo.png', mimeType: 'image/png', buffer: Buffer.from(await png(640, 480, 220)) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.bn-editor img.bn-visual-media').length === 3, null, { timeout: 20000 });
  check('Pictures: three pictures landed', true);
  check('Pictures: they start as a stack (no side-by-side marker)', (await page.locator('.bn-block-content[data-gl]').count()) === 0);
  const ys = await page.locator('.bn-editor img.bn-visual-media').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  check('Pictures: stack puts them one under the other', ys[0] < ys[1] && ys[1] < ys[2], ys.join(','));

  // ---- the group bar
  await page.locator('.bn-editor img.bn-visual-media').nth(1).click();
  await page.locator('[data-testid="group-bar"]').waitFor({ timeout: 5000 });
  const barTxt = await page.locator('[data-testid="group-bar"]').innerText();
  check('Group bar: Stack, Grid, Row and columns are offered', /Stack/.test(barTxt) && /Grid/.test(barTxt) && /Row/.test(barTxt) && /2\s*3\s*4/.test(barTxt.replace(/\s+/g, ' ')), barTxt);
  check('Group bar: Stack is the one selected', /on/.test((await page.locator('[data-testid="gb-stack"]').getAttribute('class')) || ''));

  await page.locator('[data-testid="gb-grid"]').click(); await wait(400);
  let boxes = await page.locator('.bn-editor img.bn-visual-media').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left), Math.round(r.width)]; }));
  check('Grid (2 columns): first two sit side by side, third below', boxes[0][0] === boxes[1][0] && boxes[2][0] > boxes[0][0] + 20 && boxes[1][1] > boxes[0][1] + 50, JSON.stringify(boxes));
  await page.locator('.bn-editor img.bn-visual-media').nth(1).click();
  await page.locator('[data-testid="gb-col3"]').click(); await wait(400);
  boxes = await page.locator('.bn-editor img.bn-visual-media').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left), Math.round(r.width)]; }));
  check('Grid (3 columns): all three in one line', boxes[0][0] === boxes[1][0] && boxes[1][0] === boxes[2][0], JSON.stringify(boxes));
  await page.locator('.bn-editor img.bn-visual-media').nth(1).click();
  await page.locator('[data-testid="gb-row"]').click(); await wait(400);
  boxes = await page.locator('.bn-editor img.bn-visual-media').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left), Math.round(r.width)]; }));
  check('Row: all three in one line', boxes[0][0] === boxes[1][0] && boxes[1][0] === boxes[2][0], JSON.stringify(boxes));
  await page.screenshot({ path: 'e2e/media-row.png' });

  // saved with the note and back after reload
  await page.locator('.bn-editor img.bn-visual-media').nth(1).click();
  await page.locator('[data-testid="gb-grid"]').click();
  await wait(4000);
  const saved = (await api('GET', '/api/notes/' + n.id)).note;
  check('Layout is kept in the saved note', /gl=grid/.test(saved.content || ''), (saved.content || '').slice(0, 200));
  await page.reload(); await page.locator('.bn-editor img.bn-visual-media').first().waitFor({ timeout: 20000 }); await wait(800);
  check('Layout survives a reload', (await page.locator('.bn-block-content[data-gl="grid"]').count()) === 3);

  // ---- caption / alt
  await page.locator('.bn-editor img.bn-visual-media').nth(0).click();
  await page.locator('[data-testid="gb-alt"]').click();
  await page.locator('[data-testid="gb-alt-input"]').fill('The whole team on stage');
  await page.keyboard.press('Enter'); await wait(500);
  check('Caption: saved on the picture', /The whole team on stage/.test(await page.locator('.bn-editor').innerText()));

  // ---- inline crop
  await page.locator('.bn-editor img.bn-visual-media').nth(0).click();
  const before = await page.locator('.bn-editor img.bn-visual-media').nth(0).getAttribute('src');
  await page.locator('[data-testid="gb-crop"]').click();
  await page.locator('[data-testid="crop-veil"]').waitFor({ timeout: 5000 });
  const tb = await page.locator('.pb-crop-tb').innerText();
  check('Crop: Free, 1:1, 4:3, 16:9 and Done are in the bar', /Free/.test(tb) && /1:1/.test(tb) && /4:3/.test(tb) && /16:9/.test(tb) && /Done/.test(tb), tb);
  await page.locator('[data-testid="crop-1"]').click(); await wait(200);
  const cb = await page.locator('[data-testid="crop-box"]').boundingBox();
  check('Crop: 1:1 makes the window square', Math.abs(cb.width - cb.height) < 3, JSON.stringify(cb));
  const h = await page.locator('[data-testid="crop-h-se"]').boundingBox();
  await page.mouse.move(h.x + 7, h.y + 7); await page.mouse.down(); await page.mouse.move(h.x - 40, h.y - 40, { steps: 5 }); await page.mouse.up();
  const cb2 = await page.locator('[data-testid="crop-box"]').boundingBox();
  check('Crop: dragging a corner resizes it and keeps it square', cb2.width < cb.width - 20 && Math.abs(cb2.width - cb2.height) < 3, JSON.stringify([cb, cb2]));
  await page.locator('[data-testid="crop-rotate"]').click(); await wait(200);
  await page.locator('[data-testid="crop-flip"]').click(); await wait(200);
  await page.locator('[data-testid="crop-done"]').click();
  await page.locator('[data-testid="crop-veil"]').waitFor({ state: 'detached', timeout: 15000 });
  await wait(800);
  const after = await page.locator('.bn-editor img.bn-visual-media').nth(0).getAttribute('src');
  check('Crop: Done replaces the picture with the cropped one', before !== after);
  const nat = await page.locator('.bn-editor img.bn-visual-media').nth(0).evaluate((e) => [e.naturalWidth, e.naturalHeight]);
  check('Crop: the new picture is square', Math.abs(nat[0] - nat[1]) <= 2 && nat[0] > 20, nat.join('x'));
  check('Crop: it stayed in the grid', (await page.locator('.bn-block-content[data-gl="grid"]').count()) === 3);
  // Esc leaves the picture alone
  await page.locator('.bn-editor img.bn-visual-media').nth(0).click();
  await page.locator('[data-testid="gb-crop"]').click(); await page.locator('[data-testid="crop-veil"]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="crop-veil"]').waitFor({ state: 'detached', timeout: 5000 });
  check('Crop: Esc closes without changing anything', (await page.locator('.bn-editor img.bn-visual-media').nth(0).getAttribute('src')) === after);

  // ---- delete one picture from the group
  await page.locator('.bn-editor img.bn-visual-media').nth(2).click();
  await page.locator('[data-testid="gb-del"]').click(); await wait(500);
  check('Delete: removes just that picture', (await page.locator('.bn-editor img.bn-visual-media').count()) === 2);

  // ---- drop veil
  await page.evaluate(() => {
    const dt = new DataTransfer();
    for (const [name, type] of [['a.png', 'image/png'], ['b.jpg', 'image/jpeg'], ['c.png', 'image/png'], ['d.gif', 'image/gif']]) dt.items.add(new File([new Uint8Array([1])], name, { type }));
    window.__dt = dt;
    document.querySelector('.bn-editor').dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.locator('[data-testid="drop-veil"]').waitFor({ timeout: 3000 });
  const vt = await page.locator('[data-testid="drop-veil"]').innerText();
  check('Drop veil: says how many files', /Drop to add 4 files/.test(vt), vt);
  check('Drop veil: counts pictures and GIFs', /3 pictures/.test(vt) && /1 GIF/.test(vt), vt);
  await page.screenshot({ path: 'e2e/media-drop.png' });
  await page.evaluate(() => document.querySelector('.bn-editor').dispatchEvent(new DragEvent('dragleave', { dataTransfer: window.__dt, bubbles: true })));
  await page.locator('[data-testid="drop-veil"]').waitFor({ state: 'detached', timeout: 3000 });
  check('Drop veil: goes away when the drag leaves', true);

  // ---- video by link
  await newLine();
  await slash('vid'); await page.keyboard.press('Enter');
  await page.locator('[data-testid="media-ask"]').waitFor({ timeout: 3000 });
  check('Video: offers upload and a link box', /Upload video files/.test(await page.locator('[data-testid="media-ask"]').innerText()) && (await page.locator('[data-testid="media-ask-link"]').count()) === 1);
  await page.locator('[data-testid="media-ask-link"]').fill('https://example.com/clips/launch.mp4');
  await page.keyboard.press('Enter'); await wait(600);
  check('Video: a link to a video file becomes a video block', (await page.locator('.bn-block-content[data-content-type="video"]').count()) === 1);

  // ---- GIF by file
  await newLine();
  await slash('gif'); await page.keyboard.press('Enter');
  await page.locator('[data-testid="media-ask"]').waitFor({ timeout: 3000 });
  const gifChooser = page.waitForEvent('filechooser');
  await page.locator('[data-testid="media-ask-upload"]').click();
  const gfc = await gifChooser;
  const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64');
  const picsBefore = await page.locator('.bn-editor img.bn-visual-media').count();
  await gfc.setFiles([{ name: 'wave.gif', mimeType: 'image/gif', buffer: gif }]);
  await page.waitForFunction((n) => document.querySelectorAll('.bn-editor img.bn-visual-media').length === n + 1, picsBefore, { timeout: 15000 });
  check('GIF: a GIF file is added as a picture', true);

  // ---- dictation
  await newLine();
  await slash('dict'); await page.keyboard.press('Enter');
  await page.locator('[data-testid="dictation"]').waitFor({ timeout: 3000 });
  check('Dictation: pill says Listening', /Listening/.test(await page.locator('[data-testid="dictation"]').innerText()));
  await page.evaluate(() => { const r = window.__srs[window.__srs.length - 1]; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'then the team reviews' }], { isFinal: false })] }); });
  check('Dictation: live words show while speaking', /then the team reviews/.test(await page.locator('[data-testid="dictation-live"]').innerText()));
  await page.evaluate(() => { const r = window.__srs[window.__srs.length - 1]; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'then the team reviews every share link' }], { isFinal: true })] }); });
  await wait(500);
  check('Dictation: spoken words are typed into the note', /then the team reviews every share link/.test(await page.locator('.bn-editor').innerText()));
  await page.locator('[data-testid="dictation-pause"]').click();
  check('Dictation: pause works', (await page.locator('[data-testid="dictation"]').getAttribute('data-state')) === 'paused');
  await page.locator('[data-testid="dictation-pause"]').click();
  check('Dictation: resume works', (await page.locator('[data-testid="dictation"]').getAttribute('data-state')) === 'listening');
  await page.screenshot({ path: 'e2e/media-dictation.png' });
  await page.locator('[data-testid="dictation-done"]').click();
  await page.locator('[data-testid="dictation"]').waitFor({ state: 'detached', timeout: 3000 });
  check('Dictation: Done closes the pill', true);

  // ---- voice note
  await newLine();
  await slash('mic'); await page.keyboard.press('Enter');
  await page.locator('[data-testid="recorder"]').waitFor({ timeout: 3000 });
  await wait(2300);
  check('Voice note: the timer runs', /0:0[1-9]/.test(await page.locator('[data-testid="recorder"]').innerText()));
  await page.locator('[data-testid="recorder-done"]').click();
  await page.locator('.bn-block-content[data-content-type="audio"]').waitFor({ timeout: 15000 });
  check('Voice note: the clip is added as an audio block', true);

  // ---- undo / redo are built in
  await newLine();
  await page.keyboard.type('ZZTOP');
  await wait(300);
  await page.keyboard.press('Control+z'); await wait(300);
  check('Undo: Ctrl Z takes the typing back', !/ZZTOP/.test(await page.locator('.bn-editor').innerText()));
  await page.keyboard.press('Control+y'); await wait(300);
  check('Redo: Ctrl Y puts it back', /ZZTOP/.test(await page.locator('.bn-editor').innerText()));
} catch (e) { check('no exception: ' + e.message, false); console.log(e.stack); }
await finish();
