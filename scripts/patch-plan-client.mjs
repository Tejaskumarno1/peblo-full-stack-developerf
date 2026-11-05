import fs from 'fs';
const ed = (f, pairs) => {
  let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 70)); s = s.replace(a, b); }
  fs.writeFileSync(f, s);
};
ed('client/src/App.jsx', [
  ["const SoftTasks = lazy(() => import('./soft/SoftTasks'));", "const SoftTasks = lazy(() => import('./soft/SoftTasks'));\nconst SoftPlan = lazy(() => import('./soft/SoftPlan'));"],
  ['<Route path="/tasks/focus/:id" element={<SoftFocus />} />', '<Route path="/tasks/focus/:id" element={<SoftFocus />} />\n          <Route path="/tasks/plan" element={<SoftPlan />} />'],
]);
ed('client/src/soft/SoftTasks.jsx', [
  ['<div className="soft-page s-tasks">', '<div className={`soft-page s-tasks${acct?.calmMode === true ? \' calm\' : \'\'}`}>'],
  ['        {selMode && <button type="button" className="s-selbtn" onClick={exitSelect}>Cancel</button>}', '        {selMode && <button type="button" className="s-selbtn" onClick={exitSelect}>Cancel</button>}\n        {!selMode && <Link to="/tasks/plan" className="s-selbtn plan-link">Plan my day</Link>}'],
]);
ed('client/src/soft/plan.css', []);
fs.appendFileSync('client/src/soft/plan.css', '\n.s-tasks .plan-link { text-decoration: none; display: inline-flex; align-items: center; }\n');
console.log('ok');
