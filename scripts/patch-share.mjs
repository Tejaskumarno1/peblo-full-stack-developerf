import fs from 'fs';
const edit = (f, pairs) => {
  let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(`missing in ${f}: ${a.slice(0, 50)}`); s = s.replace(a, b); }
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
};
edit('server/src/index.ts', [
  ["import { shareRoutes, publicRoutes, shortRedirect } from './routes/share.js';", "import { shareRoutes, publicRoutes, shortRedirect } from './routes/share.js';\nimport { listShareRoutes, listPublicRoutes, listMarkdownHandler } from './routes/listShare.js';"],
  ["app.use('/api/public', publicRoutes);", "app.use('/api/task-lists', listShareRoutes);\napp.use('/api/public/list', listPublicRoutes);\napp.use('/api/public', publicRoutes);"],
  ["app.get('/s/note/:tok', apiLimiter(), agentNote);", "app.get(/^\\/s\\/list\\/([A-Za-z0-9_-]{20,40})\\.md$/, apiLimiter(), listMarkdownHandler);\napp.get('/s/note/:tok', apiLimiter(), agentNote);"],
]);
edit('client/src/App.jsx', [
  ["const SharedPage = lazy(() => import('./pages/SharedPage'));", "const SharedPage = lazy(() => import('./pages/SharedPage'));\nconst SharedList = lazy(() => import('./soft/SharedList'));"],
  ['<Route path="/s/:kind/:token" element={<SharedPage />} />', '<Route path="/s/list/:token" element={<SharedList />} />\n        <Route path="/s/:kind/:token" element={<SharedPage />} />'],
]);
edit('client/src/soft/SoftTasks.jsx', [
  ["import { ListCards,", "import ShareList from './ShareList';\nimport { ListCards,"],
  ["onArchive={archiveList} onDelete={(l) => setDelList(l)} />}", "onArchive={archiveList} onShare={(l) => setShareList(l)} onDelete={(l) => setDelList(l)} />}\n      {shareList && <ShareList list={shareList} open={tasksOfList(shareList).filter((t) => !t.completed).length} onClose={() => setShareList(null)} />}"],
  ["  const confirmDeleteList = async", "  const [shareList, setShareList] = useState(null);\n  const confirmDeleteList = async"],
]);
console.log('patched');
