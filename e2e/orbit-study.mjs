// PEB-159..162: Orbit study: mastery explainer, quiz length + review of misses, "Study today" plan, streak and week.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path = '/') => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); localStorage.removeItem('peblo-orbit-quiz-len'); });
  await page.goto(base + path);
  await page.waitForTimeout(1200);
};
try {
  const long = 'Normalization removes redundancy from tables by splitting them.';
  for (const t of ['Keys note', 'Joins note']) await api('POST', '/api/notes', { title: t, content: long, tags: ['dbms', t.startsWith('Keys') ? 'keys' : 'joins'] });
  const at = new Date(); at.setHours(23, 0, 0, 0);
  await api('POST', '/api/todos', { text: 'Submit lab file', deadline: at.toISOString(), tags: ['dbms'] });

  const questions = [
    { q: 'What is a primary key?', options: ['A unique row id', 'A foreign link', 'An index only', 'A view'], answer: 0, explain: 'It uniquely identifies each row.', concept: 'Primary keys' },
    { q: 'What does a join do?', options: ['Deletes rows', 'Combines tables', 'Renames a column', 'Drops a table'], answer: 1, explain: 'It combines rows from two tables.', concept: 'Joins' },
  ];
  let askedCount = null;
  await page.route('**/api/study/mastery', (r) => r.fulfill({ json: { mastery: [{ topic: 'keys', score: 40, quizzes: 2, lastCorrect: 2, lastTotal: 5, missed: [], updatedAt: new Date(Date.now() - 3 * 86400000).toISOString() }] } }));
  await page.route((u) => /\/api\/study\/quiz$/.test(u.pathname), (r) => { askedCount = JSON.parse(r.request().postData() || '{}').count; return r.fulfill({ json: { id: 'q1', topic: 'dbms', questions, fromNotes: 2 } }); });
  await page.route((u) => /\/api\/study\/quiz\/q1\/answers$/.test(u.pathname), (r) => r.fulfill({ json: { correct: 1, total: 2, pct: 50, before: 40, mastery: { topic: 'dbms', score: 45, quizzes: 3, lastCorrect: 1, lastTotal: 2, missed: [{ concept: 'Primary keys', n: 1 }], updatedAt: new Date().toISOString() } } }));

  await go();
  await page.getByRole('button', { name: /^Keys/ }).first().click();
  await page.getByRole('button', { name: 'How is this calculated?' }).first().click();
  const tip = await page.locator('.o-info-pop').first().innerText();
  check('the mastery figure explains itself (last quiz, count, age)', /2 of 5 right/.test(tip) && /3 days ago/.test(tip) && /3 quizzes|2 quizzes/.test(tip), tip);
  await page.keyboard.press('Escape');

  // Study today
  await page.getByRole('button', { name: /Study today/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Study today' });
  check('"Study today" opens a plan', await dlg.isVisible());
  const items = await dlg.locator('.o-plan li').allInnerTexts();
  check('the plan starts with what is due today', /Submit lab file/.test(items[0] || ''), items.join(' | '));
  check('..then revises the weak topic, with minutes', items.some((t) => /Revise DBMS/.test(t) && /min/.test(t)), items.join(' | '));
  check('each topic item offers notes and a quiz', (await dlg.getByRole('link', { name: 'Quiz' }).count()) >= 1 && (await dlg.getByRole('link', { name: 'Notes' }).count()) >= 1);
  const wk = await dlg.locator('.o-week').innerText();
  check('streak and the week so far are shown', /1-day streak/.test(wk) && /2 notes written/.test(wk), wk);
  await dlg.getByRole('link', { name: 'Quiz' }).first().click();
  await page.waitForTimeout(800);

  // Quiz length + review
  check('the quiz asks for a length first', await page.getByRole('radiogroup', { name: 'Quiz length' }).isVisible());
  check('..with 5, 10 and 20', (await page.getByRole('radio').count()) === 3);
  await page.getByRole('radio', { name: '5 questions' }).click();
  await page.getByRole('button', { name: 'Start quiz' }).click();
  await page.getByText(/QUESTION 1 OF 2/).waitFor({ timeout: 10000 });
  check('the chosen length is sent', askedCount === 5, String(askedCount));
  await page.keyboard.press('2'); // wrong (answer is A)
  await page.keyboard.press('Enter');
  await page.keyboard.press('2'); // right
  await page.getByRole('button', { name: 'See my score' }).click();
  await page.getByText('REVIEW · 1 MISSED').waitFor({ timeout: 8000 });
  const rev = await page.getByRole('region', { name: 'Questions you missed' }).innerText().catch(() => page.locator('.o-review').innerText());
  check('the results list the missed question', /What is a primary key/.test(rev));
  check('..with your answer, the right answer and why', /You chose B/.test(rev) && /Right answer A/.test(rev) && /uniquely identifies/.test(rev), rev);
  check('..and not the one you got right', !/What does a join do/.test(rev));
  await page.goto(base + '/quiz/dbms');
  await page.waitForTimeout(900);
  check('the last length is remembered', (await page.getByRole('radio', { name: '5 questions' }).getAttribute('aria-checked')) === 'true');
} catch (e) {
  console.log('FAIL: test crashed', e.message);
  process.exitCode = 1;
}
await finish();
