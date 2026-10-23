// PEB-281: the model store. A fake Ollama on this machine stands in for the real one, so the whole path
// (status, hardware, recommendation, download with progress, cancel, "use it") runs for real without a 2 GB download.
import http from 'http';
import fs from 'fs';
import { boot } from './lib.mjs';

let installed = [];
const pulls = [];
const fake = http.createServer((req, res) => {
  if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ models: installed.map((name) => ({ name })) })); }
  if (req.url === '/api/pull' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const { model } = JSON.parse(body); pulls.push(model);
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
      let i = 0; const total = 1000;
      const timer = setInterval(() => {
        i += 1;
        if (model === 'qwen2.5:14b' || i < 5) { res.write(JSON.stringify({ status: 'pulling abc', total, completed: Math.min(total - 1, i * 200) }) + '\n'); if (model === 'qwen2.5:14b' && i > 60) { clearInterval(timer); res.end(); } return; }
        clearInterval(timer); installed.push(model + (model.includes(':') ? '' : ':latest'));
        res.write(JSON.stringify({ status: 'success' }) + '\n'); res.end();
      }, 350);
      res.on('close', () => clearInterval(timer));
    });
    return;
  }
  if (req.url === '/api/delete' && req.method === 'DELETE') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const { model } = JSON.parse(body); installed = installed.filter((n) => n !== model && n !== model + ':latest'); res.end('{}');
    });
    return;
  }
  res.statusCode = 404; res.end();
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

const { base, api, page, check, finish } = await boot();
const shot = async (n) => { await page.getByTestId('local-models').scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(300); await page.screenshot({ path: `C:/Users/tejas/peblo-e2e/shots/${n}.png` }); };
fs.mkdirSync('C:/Users/tejas/peblo-e2e/shots', { recursive: true });
const waitFor = async (fn, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
try {
  await api('PUT', '/api/profile', { settings: { ollamaUrl: fakeUrl } });

  const st = await api('GET', '/api/ai/local/status');
  check('status says local AI is available on the desktop app', st.available === true && st.running === true, JSON.stringify(st).slice(0, 200));
  check('status reports this computer\'s memory and cores', st.hardware?.ramGb > 0 && st.hardware?.cpuCores > 0, JSON.stringify(st.hardware));
  check('a chat model is recommended and the search model is listed', !!st.recommendedChat && st.catalog.some((m) => m.kind === 'search'));
  check('the recommended model fits this computer', st.catalog.find((m) => m.id === st.recommendedChat)?.fits === true);
  check('models too big for the memory are flagged', st.catalog.every((m) => m.fits === (st.hardware.ramGb + 1.5 >= m.minRamGb)));
  const bad = await fetch(base + '/api/ai/local/pull', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x', password: 'y' }) })).json().catch(() => ({}))).token || ''}` }, body: '{}' });
  check('a download needs a sign-in', bad.status === 401);
  const notListed = await api('POST', '/api/ai/local/pull', { model: 'evil/model:latest' });
  check('only models in the list can be downloaded', !!notListed.error && pulls.length === 0, JSON.stringify(notListed));

  for (const style of ['soft', 'river', 'orbit']) {
    await page.goto(base + '/ai/connections');
    await page.evaluate((s) => localStorage.setItem('peblo-style', s), style);
    await page.reload();
    const store = page.getByTestId('local-models');
    await store.waitFor({ timeout: 10000 }).catch(() => {});
    check(`${style}: the model store shows`, await store.isVisible().catch(() => false));
    check(`${style}: it lists the models with sizes`, (await page.locator('.lm-card').count()) === 5 && /GB download/.test(await store.textContent()));
    await shot(`models-${style}-ready`);
  }

  // Download from Soft: progress, finish, then use it
  await page.evaluate(() => localStorage.setItem('peblo-style', 'soft'));
  await page.reload();
  const card = page.locator('.lm-card[data-model="llama3.2"]');
  await card.waitFor({ timeout: 10000 });
  await card.getByRole('button', { name: /Download/ }).click();
  const bar = card.getByRole('progressbar');
  check('a progress bar appears while it downloads', await waitFor(() => bar.isVisible()));
  await shot('models-soft-downloading');
  check('Ollama was asked for exactly that model', pulls.includes('llama3.2'), pulls.join());
  check('the card turns to Downloaded when it finishes', await waitFor(() => card.getByText('Downloaded').isVisible(), 15000));
  await card.getByRole('button', { name: 'Use for chat' }).click();
  check('Use for chat saves it and turns Local AI on', await waitFor(async () => { const me = await api('GET', '/api/profile'); return me.user.settings.ollamaModel === 'llama3.2' && me.user.settings.ollamaEnabled === true; }));
  check('the card then says In use', await waitFor(() => card.getByText('In use').isVisible()));
  check('the graphics card is reported when there is one', 'gpu' in (await api('GET', '/api/ai/local/status')).hardware);
  await card.getByRole('button', { name: /^Remove/ }).click(); // the test browser accepts the confirm
  check('a downloaded model can be removed', await waitFor(() => card.getByRole('button', { name: /Download/ }).isVisible(), 10000));
  check('Ollama no longer has it', !installed.some((n) => n.startsWith('llama3.2:') && !n.includes('1b')) , installed.join());
  const notListedRemove = await api('POST', '/api/ai/local/remove', { model: 'evil/model' });
  check('only listed models can be removed', !!notListedRemove.error);

  // Cancel a long download in Orbit
  await page.evaluate(() => localStorage.setItem('peblo-style', 'orbit'));
  await page.reload();
  const big = page.locator('.lm-card[data-model="qwen2.5:14b"]');
  const small = page.locator('.lm-card[data-model="llama3.2:1b"]');
  await small.getByRole('button', { name: /Download/ }).click();
  await waitFor(() => small.getByRole('progressbar').isVisible());
  await shot('models-orbit-downloading');
  await big.waitFor({ timeout: 10000 });
  const bigBtn = big.getByRole('button', { name: /Download/ });
  if (await bigBtn.count()) {
    await bigBtn.click();
    check('Orbit shows the progress too', await waitFor(() => big.getByRole('progressbar').isVisible()));
    await shot('models-orbit-downloading');
    await big.getByRole('button', { name: /Cancel/ }).click();
    check('a download can be cancelled', await waitFor(() => big.getByText('Download cancelled.').isVisible(), 8000));
  } else {
    check('too-large models are not offered on a small computer', /memory/.test(await big.textContent()));
  }
  await page.evaluate(() => localStorage.setItem('peblo-style', 'river'));
  await page.reload();
  await page.getByTestId('local-models').waitFor({ timeout: 10000 });
  await shot('models-river-after');

  // Ollama not running: install guidance and disabled downloads
  await new Promise((r) => fake.close(r)); fake.closeAllConnections?.();
  await page.reload();
  await page.getByText('Ollama not found').waitFor({ timeout: 10000 }).catch(() => {});
  check('without Ollama the page says how to get it', await page.getByText('Peblo needs the free Ollama app').isVisible().catch(() => false));
  check('downloads are disabled until it runs', await page.locator('.lm-card button:has-text("Download")').first().isDisabled().catch(() => true));
  await shot('models-river-no-ollama');
  check('with no Ollama on the computer, Install Ollama for me is offered', await page.getByRole('button', { name: /Install Ollama for me/ }).isVisible().catch(() => false));

  // Start Ollama from the app: a stand-in program plays the installed Ollama and answers on the same address
  const port = new URL(fakeUrl).port;
  process.env.PEBLO_OLLAMA_EXE = process.execPath;
  process.env.PEBLO_OLLAMA_ARGS = JSON.stringify(['-e', `require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end('{"models":[]}')}).listen(${port},'127.0.0.1');setTimeout(()=>process.exit(),25000)`]);
  await page.reload();
  const startBtn = page.getByRole('button', { name: 'Start Ollama' });
  check('when Ollama is installed but off, the page offers Start Ollama', await startBtn.waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await startBtn.click();
  check('Start Ollama brings it up without a terminal', await page.getByText('Ollama is running').waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
  const st2 = await api('GET', '/api/ai/local/status');
  check('status then says running', st2.running === true && st2.onDisk === true);
  delete process.env.PEBLO_OLLAMA_EXE; delete process.env.PEBLO_OLLAMA_ARGS;

  // On a shared web server the whole store disappears and downloads are refused
  process.env.PEBLO_HOSTED = '1';
  const web = await api('GET', '/api/ai/local/status');
  check('on the web version local AI is not available', web.available === false && !web.catalog, JSON.stringify(web));
  const webPull = await api('POST', '/api/ai/local/pull', { model: 'llama3.2' });
  check('the web version refuses downloads', !!webPull.error && pulls.length >= 1 && !pulls.slice(-1)[0].includes('hosted'), JSON.stringify(webPull));
  await page.reload();
  await page.waitForTimeout(2500);
  check('the web version shows no model store', (await page.getByTestId('local-models').count()) === 0);
  const webInstall = await api('POST', '/api/ai/local/install');
  check('the web version refuses to install anything', !!webInstall.error && /desktop/.test(webInstall.error), JSON.stringify(webInstall));
  delete process.env.PEBLO_HOSTED;
} catch (e) {
  check('test ran without throwing', false, e?.stack || e);
} finally {
  try { fake.close(); } catch {}
  await finish();
}
