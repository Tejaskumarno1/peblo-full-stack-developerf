import api from './client';

export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken })
};

export const notesAPI = {
  getAll: (params) => api.get('/notes', { params }),
  get: (id) => api.get(`/notes/${id}`),
  create: (data) => api.post('/notes', data),
  update: (id, data) => api.patch(`/notes/${id}`, data),
  delete: (id) => api.delete(`/notes/${id}`),
  archive: (id) => api.post(`/notes/${id}/archive`),
  share: (id) => api.post(`/notes/${id}/share`),
  getBackups: (id) => api.get(`/notes/${id}/backups`),
  revertBackup: (id, backupId) => api.post(`/notes/${id}/backups/${backupId}/revert`)
};

export const aiAPI = {
  summary: (id, data, config) => api.post(`/notes/${id}/ai/summary`, data, config),
  actions: (id, data, config) => api.post(`/notes/${id}/ai/actions`, data, config),
  title: (id, data, config) => api.post(`/notes/${id}/ai/title`, data, config),
  chat: (data, config) => api.post('/ai/chat', data, config),
  smartIntake: (data, config) => api.post('/ai/smart-intake', data, config),
  smartIntakeUpload: (formData, config) => api.post('/ai/smart-intake-upload', formData, config),
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
  create: (data) => api.post('/todos', data),
  update: (id, data) => api.patch(`/todos/${id}`, data),
  delete: (id) => api.delete(`/todos/${id}`)
};

export const sharedAPI = {
  getNote: (shareId) => api.get(`/shared/${shareId}`)
};
