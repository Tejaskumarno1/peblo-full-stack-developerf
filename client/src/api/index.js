import api from './client';

export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  login: (data) => api.post('/auth/login', data),
  changePassword: (data) => api.post('/auth/change-password', data),
  logoutAll: () => api.post('/auth/logout-all'),
  deleteAccount: (data) => api.post('/auth/delete-account', data)
};

export const profileAPI = {
  me: () => api.get('/profile'),
  updateProfile: (data) => api.put('/profile', data)
};

export const notesAPI = {
  getAll: (params) => api.get('/notes', { params }),
  get: (id) => api.get(`/notes/${id}`),
  backlinks: (id) => api.get(`/notes/${id}/backlinks`),
  daily: (date) => api.post('/notes/daily', { date }),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.patch(`/notes/${id}`, data),
  delete: (id) => api.delete(`/notes/${id}`),
  restore: (id) => api.post(`/notes/${id}/restore`),
  archive: (id) => api.post(`/notes/${id}/archive`),
  getBackups: (id) => api.get(`/notes/${id}/backups`),
  getBackup: (id, backupId) => api.get(`/notes/${id}/backups/${backupId}`),
  revertBackup: (id, backupId) => api.post(`/notes/${id}/backups/${backupId}/revert`),
  mentions: (id) => api.get(`/notes/${id}/mentions`),
  linkMention: (id, otherId) => api.post(`/notes/${id}/mentions/${otherId}/link`)
};

export const aiAPI = {
  localStatus: () => api.get('/ai/local/status'),
  localPull: (model) => api.post('/ai/local/pull', { model }),
  localCancel: (model) => api.post('/ai/local/cancel', { model }),
  localStart: () => api.post('/ai/local/start'),
  localInstall: () => api.post('/ai/local/install'),
  localInstallCancel: () => api.post('/ai/local/install/cancel'),
  localRemove: (model) => api.post('/ai/local/remove', { model }),
  summary: (id, data, config) => api.post(`/notes/${id}/ai/summary`, data, config),
  actions: (id, data, config) => api.post(`/notes/${id}/ai/actions`, data, config),
  title: (id, data, config) => api.post(`/notes/${id}/ai/title`, data, config),
  suggestTag: (id, data, config) => api.post(`/notes/${id}/ai/tags`, data, config),
  linkPreview: (url) => api.get('/ai/link-preview', { params: { url } }),
  ollamaCheck: (url) => api.get('/ai/ollama/check', { params: { url } }),
  chat: (data, config) => api.post('/ai/chat', data, config),
  smartIntake: (data, config) => api.post('/ai/smart-intake', data, config),
  smartIntakeUpload: (formData, config) => api.post('/ai/smart-intake-upload', formData, config),
  processBlock: (data, config) => api.post('/notes/block/ai', data, config),
  processVoiceCommand: (data, config) => api.post('/ai/voice-command', data, config)
};

export const dashboardAPI = {
  insights: () => api.get('/dashboard/insights'),
  toggleTask: (data) => api.post('/dashboard/toggle-task', data),
  dailyBriefing: () => api.get('/dashboard/daily-briefing'),
  weeklyReport: () => api.get('/dashboard/weekly-report')
};

export const todosAPI = {
  getAll: (params) => api.get('/todos', { params }),
  getToday: () => api.get('/todos/today'),
  getRange: (from, to) => api.get('/todos/range', { params: { from, to } }),
  create: (data) => api.post('/todos', { ...data, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  update: (id, data) => api.patch(`/todos/${id}`, { ...data, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  delete: (id, scope) => api.delete(`/todos/${id}`, { params: scope && scope !== 'this' ? { scope } : undefined })
};

export const transferAPI = {
  importFiles: (formData) => api.post('/import', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 10 * 60 * 1000 })
};

export const hubAPI = {
  models: () => api.get('/ai/hub/models'),
  search: (query, noteIds) => api.post('/ai/hub/search', { query, noteIds })
};

// Orbit style: quizzes and how well each topic is known
export const tokensAPI = {
  list: () => api.get('/tokens'),
  create: (name, scope) => api.post('/tokens', { name, scope }),
  remove: (id) => api.delete('/tokens/' + id)
};

export const tagsAPI = {
  list: () => api.get('/tags'),
  rename: (from, to) => api.post('/tags/rename', { from, to }),
  remove: (name) => api.post('/tags/delete', { name })
};

export const studyAPI = {
  mastery: () => api.get('/study/mastery'),
  quiz: (topic, count) => api.post('/study/quiz', { topic, count }, { timeout: 5 * 60 * 1000 }),
  answer: (id, answers) => api.post(`/study/quiz/${id}/answers`, { answers }),
  noteQuestions: (noteId) => api.get(`/study/notes/${noteId}/questions`),
  activity: () => api.get('/study/activity'),
};

// River style: meeting briefs and promises found in notes
export const riverAPI = {
  brief: (todoId) => api.post('/river/brief', { todoId }, { timeout: 5 * 60 * 1000 }),
  findPromises: (noteId) => api.post(`/river/notes/${noteId}/promises`, null, { timeout: 5 * 60 * 1000 }),
  promises: (noteId) => api.get('/river/promises', { params: noteId ? { noteId } : {} }),
  setPromise: (id, index, status, todoId) => api.patch(`/river/promises/${id}`, { index, status, todoId }),
};


export const backupAPI = {
  get: () => api.get('/backup'),
  restore: (data) => api.post('/restore', data),
  addExample: () => api.post('/example'),
  clearExample: () => api.post('/example/clear'),
};
