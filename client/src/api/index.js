import api from './client';

export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  login: (data) => api.post('/auth/login', data),
  googleLogin: (data) => api.post('/auth/google', data),
  me: () => api.get('/auth/me'),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  updateProfile: (data) => api.put('/auth/profile', data),
  updatePassword: (data) => api.post('/auth/password', data),
  logoutAll: () => api.post('/auth/logout-all'),
  linkGoogle: (data) => api.post('/auth/google-link', data)
};

export const notesAPI = {
  getAll: (params) => api.get('/notes', { params }),
  get: (id) => api.get(`/notes/${id}`),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.patch(`/notes/${id}`, data),
  delete: (id) => api.delete(`/notes/${id}`),
  restore: (id) => api.post(`/notes/${id}/restore`),
  archive: (id) => api.post(`/notes/${id}/archive`),
  share: (id) => api.post(`/notes/${id}/share`),
  getBackups: (id) => api.get(`/notes/${id}/backups`),
  revertBackup: (id, backupId) => api.post(`/notes/${id}/backups/${backupId}/revert`)
};

export const aiAPI = {
  summary: (id, data, config) => api.post(`/notes/${id}/ai/summary`, data, config),
  actions: (id, data, config) => api.post(`/notes/${id}/ai/actions`, data, config),
  title: (id, data, config) => api.post(`/notes/${id}/ai/title`, data, config),
  suggestTag: (id, data, config) => api.post(`/notes/${id}/ai/tags`, data, config),
  linkPreview: (url) => api.get('/ai/link-preview', { params: { url } }),
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

export const sharedAPI = {
  getNote: (shareId) => api.get(`/shared/${shareId}`)
};

export const calendarAPI = {
  syncTodos: () => api.post('/calendar/sync')
};
