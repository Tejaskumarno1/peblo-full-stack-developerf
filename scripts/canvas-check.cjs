// Design canvas check, run inside the real Electron app (see scripts/run-canvas-check.mjs).
//
// Every screen must lay out exactly like the design (1440 × 900 design pixels) whatever the
// window size, zoom keys, Ctrl + mouse wheel or screen DPI. This opens each style and screen,
// resizes the window through a range of sizes and shapes, presses the zoom keys, and records
// where every element sits on the canvas. The runner then compares them all.
//
// Only used when PEBLO_CANVAS_CHECK is set; it always runs on a throwaway data folder.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// PEBLO_CANVAS_QUICK=1 only takes a screenshot of each screen at 1440 × 900 (for reviewing a design).
const QUICK = process.env.PEBLO_CANVAS_QUICK === '1';
const SIZES = QUICK ? [[1440, 900]] : [[1440, 900], [1920, 1080], [1600, 900], [1440, 810], [1280, 720], [1024, 576], [1200, 900], [960, 600]];
const STYLES = (process.env.PEBLO_CANVAS_STYLES || 'soft,studio,console,river,orbit').split(',');
const ROUTES = (process.env.PEBLO_CANVAS_ROUTES || '/,/notes,/tasks,/calendar,/ai,/ai/connections').split(',');
const THEME = process.env.PEBLO_CANVAS_THEME || 'light';
const ZOOM_STEPS = [
  ['Ctrl +', { keyCode: '=', modifiers: ['control'] }, 3],
  ['Ctrl −', { keyCode: '-', modifiers: ['control'] }, 6],
  ['Ctrl + wheel', { wheel: true }, 4],
  ['Ctrl 0', { keyCode: '0', modifiers: ['control'] }, 1],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keep drawing while the test window is behind other windows (Windows would otherwise pause it).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Runs in the page: where every element on the canvas sits, in design pixels.
const PROBE = `(() => {
  const root = document.getElementById('root');
  const r = root.getBoundingClientRect();
  const els = [...root.querySelectorAll('*')].filter((e) => {
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && !e.closest('.s-now, [class*="now-line"], [class*="nowline"]');
  });
  const rects = els.map((e) => {
    const b = e.getBoundingClientRect();
    return [Math.round(b.left - r.left), Math.round(b.top - r.top), Math.round(b.width), Math.round(b.height)];
  });
  const names = els.map((e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/)[0] : ''));
  // How many lines each element's own text wraps onto (0 for elements without text)
  // (tops within 4px count as one line, so slightly rotated cards don't count extra lines)
  const lines = els.map((e) => {
    if (e.getBoundingClientRect().height < 1) return 0;
    const tops = [];
    for (const n of e.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const rc of range.getClientRects()) if (rc.width > 0) tops.push(rc.top);
    }
    tops.sort((a, b) => a - b);
    return tops.filter((t, i) => i === 0 || t - tops[i - 1] > 4).length;
  });
  // Each element's own text, so the runner can tell a content difference from a layout one
  const texts = els.map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 80));
  return {
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    root: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    rects, names, lines, texts,
  };
})()`;

// Windows can round a window to a size 1px off (at 150% display scaling, for example).
// Correct it so every screen scale is compared at exactly the same window size.
async function setSize(win, w, h) {
  for (let i = 0; i < 4; i++) {
    win.setContentSize(w, h);
    await sleep(60);
    const [gw, gh] = win.getContentSize();
    if (gw === w && gh === h) return;
    win.setContentSize(w - (gw - w), h - (gh - h));
    await sleep(60);
    const [cw, ch] = win.getContentSize();
    if (cw === w && ch === h) return;
  }
}

async function waitForWindow(getMainWindow) {
  for (let i = 0; i < 300; i++) {
    const w = getMainWindow();
    if (w && !w.webContents.isLoading() && w.isVisible()) return w;
    await sleep(100);
  }
  throw new Error('The main window never finished loading');
}

async function load(win, url) {
  const wc = win.webContents;
  await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.loadURL(url); });
  await sleep(1500); // lazy screens + first data
}

async function seed(wc) {
  await wc.executeJavaScript(`(async () => {
    const api = (u, body, method = 'POST') => fetch('/api' + u, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const pause = () => new Promise((r) => setTimeout(r, 20));
    await api('/profile', { name: 'Aarav Reddy' }, 'PUT');
    const day = (o, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + o); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const notes = [
      ['DBMS · Unit 3 Normalization', '## Normal forms at a glance\\n\\n| Form | Rule |\\n|---|---|\\n| 2NF | No partial dependency |\\n| 3NF | No transitive dependency |\\n| BCNF | Every determinant is a candidate key |\\n\\n> Revisit: decomposition example 2.\\n\\n## Worked example\\n\\nR(A, B, C, D) with AB → C and C → D.', ['dbms', 'normalization']],
      ['1NF to BCNF, in plain words', 'Normal forms are a checklist for one question: does every fact live in exactly one place? Vikram will send the solved examples by Thursday.', ['dbms', 'normalization']],
      ['Transactions and ACID', 'Atomicity, consistency, isolation, durability. Deadlock vs rollback.', ['dbms', 'transactions']],
      ['B+ tree indexing', 'Why B+ trees keep range scans fast. Leaf nodes are linked.', ['dbms', 'indexing']],
      ['SQL joins cheat sheet', 'Inner, left, right, full outer and self joins with examples.', ['dbms', 'sql-joins']],
      ['Hospital ER diagram', 'Entities: patient, doctor, ward. Relationships and cardinality.', ['dbms', 'er-diagrams']],
      ['Internship · weekly log', 'Fixed the token refresh bug in the login API. I told Ananya I would send the metrics dashboard date by Tuesday.', ['internship']],
      ['Startup idea · campus ride-share', 'Talk to 10 hostel students first.', ['ideas']],
      ['OS · process scheduling', 'Round robin, SJF, priority scheduling.', ['os']],
    ];
    for (const [title, content, tags] of notes) { await api('/notes', { title, content, tags }); await pause(); }
    const tasks = [
      ['Revise normalization (3NF, BCNF)', 'high', day(0, 19), ['dbms', 'normalization']],
      ['Push login API fix for review', 'medium', day(0, 18), ['internship']],
      ['Solve PYQ 2024 Q3', 'high', day(1, 10), ['dbms', 'normalization']],
      ['DBMS mid-sem exam', 'high', day(2, 10), ['dbms']],
      ['Lab 6 file', 'medium', day(3, 17), ['dbms', 'sql-joins']],
      ['Reply to Priya about the mini-project', 'medium', day(3, 17), ['college']],
      ['Read chapter 4 of the OS book', 'low', null, ['os']],
    ];
    for (const [text, priority, deadline, tags] of tasks) { await api('/todos', { text, priority, deadline, tags }); await pause(); }
    const meetings = [
      ['1:1 with Ananya', 0, '11:00', '11:45', ['internship']],
      ['Design crit', 0, '13:00', '14:00', ['internship']],
      ['Focus: DBMS revision', 0, '14:15', '15:30', ['focus']],
      ['Internship standup', 0, '17:00', '17:30', ['internship']],
      ['Gym', 0, '19:30', '20:30', ['personal']],
      ['Sprint planning', 1, '09:30', '11:00', ['internship']],
    ];
    for (const [text, o, s, e, tags] of meetings) {
      const [h, m] = s.split(':').map(Number);
      await api('/todos', { text, priority: 'medium', deadline: day(o, h, m), startTime: s, endTime: e, tags }); await pause();
    }
  })()`);
}

/** Orbit needs mastery scores, which normally come from AI quizzes. Write a few directly. */
async function seedMastery() {
  try {
    const dir = path.join(__dirname, '../server/generated/prisma');
    const { PrismaClient } = require(dir);
    const prisma = new PrismaClient();
    const rows = [['normalization', 40, 4, 10, [{ concept: '3NF vs BCNF', n: 3 }, { concept: 'functional dependencies', n: 2 }]], ['sql-joins', 30, 3, 10, [{ concept: 'outer joins', n: 4 }]], ['transactions', 65, 7, 10, []], ['indexing', 85, 9, 10, []], ['er-diagrams', 90, 9, 10, []]];
    for (const [topic, score, c, t, missed] of rows) {
      await prisma.topicMastery.upsert({
        where: { userId_topic: { userId: 'local-user', topic } },
        create: { userId: 'local-user', topic, score, quizzes: 1, lastCorrect: c, lastTotal: t, missed: JSON.stringify(missed) },
        update: {},
      });
    }
    await prisma.$disconnect();
  } catch (err) {
    console.warn('[canvas-check] could not seed mastery:', err.message);
  }
}

async function probe(win) {
  // Wait until the page has caught up with the window's new size and zoom.
  const [cw, ch] = win.getContentSize();
  let data;
  for (let i = 0; i < 40; i++) {
    await sleep(i === 0 ? 500 : 100);
    data = await win.webContents.executeJavaScript(PROBE);
    const z = win.webContents.getZoomFactor();
    if (Math.abs(data.viewport[0] - cw / z) <= 2 && Math.abs(data.viewport[1] - ch / z) <= 2) break;
  }
  await sleep(300);
  data = await win.webContents.executeJavaScript(PROBE);
  return { ...data, content: [cw, ch], zoom: Number(win.webContents.getZoomFactor().toFixed(3)) };
}

async function pressZoom(win, step) {
  const wc = win.webContents;
  const [, input, times] = step;
  for (let i = 0; i < times; i++) {
    if (input.wheel) {
      wc.sendInputEvent({ type: 'mouseWheel', x: 400, y: 400, deltaY: -120, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
    } else {
      wc.sendInputEvent({ type: 'keyDown', ...input });
      wc.sendInputEvent({ type: 'keyUp', ...input });
    }
    await sleep(120);
  }
}

module.exports = function canvasCheck({ getMainWindow }) {
  const out = process.env.PEBLO_CANVAS_OUT;
  fs.mkdirSync(out, { recursive: true });
  const shots = new Set((process.env.PEBLO_CANVAS_SHOTS || '').split(',').filter(Boolean));

  app.whenReady().then(async () => {
    const results = [];
    const pageErrors = [];
    try {
      const win = await waitForWindow(getMainWindow);
      win.setAspectRatio(0); // let the check try window shapes other than the design's
      win.setAlwaysOnTop(true);
      win.show();
      win.webContents.setBackgroundThrottling(false);
      const base = new URL(win.webContents.getURL()).origin;
      // Page errors go into the results, so a broken screen is reported, not just photographed
      win.webContents.on('console-message', (...args) => {
        const e = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] };
        if (e.level === 3 || e.level === 'error') pageErrors.push(`${win.webContents.getURL()} ${String(e.message).slice(0, 300)}`);
      });
      await seed(win.webContents);
      await seedMastery();

      for (const style of STYLES) {
        await win.webContents.executeJavaScript(`localStorage.setItem('peblo-style', '${style}'); localStorage.setItem('peblo-theme', '${THEME}'); 1`);
        for (const route of ROUTES) {
          await setSize(win, 1440, 900);
          await load(win, base + route);
          for (const [w, h] of SIZES) {
            await setSize(win, w, h);
            const p = await probe(win);
            results.push({ style, route, size: `${w}x${h}`, action: 'resize', ...p });
            const key = `${style}${route === '/' ? '/home' : route}@${w}x${h}`.replace(/[/?&=,]/g, '_');
            if (shots.has('all') || (route === '/' && shots.has(style))) {
              const img = await win.webContents.capturePage();
              fs.writeFileSync(path.join(out, `${key}.png`), img.toPNG());
            }
          }
          // Zoom keys and Ctrl + wheel at two window sizes
          for (const [w, h] of QUICK ? [] : [[1440, 900], [1280, 720]]) {
            await setSize(win, w, h);
            await sleep(300);
            for (const step of ZOOM_STEPS) {
              await pressZoom(win, step);
              const p = await probe(win);
              results.push({ style, route, size: `${w}x${h}`, action: step[0], ...p });
            }
          }
        }
      }
    } catch (err) {
      results.push({ error: String(err && err.stack ? err.stack : err) });
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(results));
    fs.writeFileSync(path.join(out, 'page-errors.txt'), pageErrors.join('\n'));
    app.exit(0);
  });
};
