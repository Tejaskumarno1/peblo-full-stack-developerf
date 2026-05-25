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
  summary: (id, data) => api.post(`/notes/${id}/ai/summary`, data),
  actions: (id, data) => api.post(`/notes/${id}/ai/actions`, data),
  title: (id, data) => api.post(`/notes/${id}/ai/title`, data),
  chat: (data) => api.post('/ai/chat', data),
};

export const dashboardAPI = {
  insights: () => api.get('/dashboard/insights')
};

export const sharedAPI = {
  getNote: (shareId) => api.get(`/shared/${shareId}`)
};
