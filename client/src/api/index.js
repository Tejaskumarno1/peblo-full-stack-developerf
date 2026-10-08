import api from './client';

export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  login: (data) => api.post('/auth/login', data),
  changePassword: (data) => api.post('/auth/change-password', data),
  logoutAll: () => api.post('/auth/logout-all')
};

export const profileAPI = {
  me: () => api.get('/profile'),
  updateProfile: (data) => api.put('/profile', data)
};

export const notesAPI = {
  getAll: (params) => api.get('/notes', { params }),
  get: (id) => api.get(`/notes/${id}`),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.patch(`/notes/${id}`, data),
  delete: (id) => api.delete(`/notes/${id}`),
  restore: (id) => api.post(`/notes/${id}/restore`),
  archive: (id) => api.post(`/notes/${id}/archive`),
  getBackups: (id) => api.get(`/notes/${id}/backups`),
  revertBackup: (id, backupId) => api.post(`/notes/${id}/backups/${backupId}/revert`)
};

export const aiAPI = {
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
  processVoiceCommand: (data, config) => api.post('/notes/voice-command', data, config)
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
  delete: (id) => api.delete(`/todos/${id}`)
};

export const transferAPI = {
  importFiles: (formData) => api.post('/import', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 10 * 60 * 1000 })
};

export const hubAPI = {
  models: () => api.get('/ai/hub/models'),
  search: (query, noteIds) => api.post('/ai/hub/search', { query, noteIds })
};

// Orbit style: quizzes and how well each topic is known
export const studyAPI = {
  mastery: () => api.get('/study/mastery'),
  quiz: (topic, count) => api.post('/study/quiz', { topic, count }, { timeout: 5 * 60 * 1000 }),
  answer: (id, answers) => api.post(`/study/quiz/${id}/answers`, { answers }),
  noteQuestions: (noteId) => api.get(`/study/notes/${noteId}/questions`),
};

// River style: meeting briefs and promises found in notes
export const riverAPI = {
  brief: (todoId) => api.post('/river/brief', { todoId }, { timeout: 5 * 60 * 1000 }),
  findPromises: (noteId) => api.post(`/river/notes/${noteId}/promises`, null, { timeout: 5 * 60 * 1000 }),
  promises: (noteId) => api.get('/river/promises', { params: noteId ? { noteId } : {} }),
  setPromise: (id, index, status, todoId) => api.patch(`/river/promises/${id}`, { index, status, todoId }),
};
