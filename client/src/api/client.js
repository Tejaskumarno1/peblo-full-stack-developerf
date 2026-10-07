import axios from 'axios';
import { getToken, clearToken } from './token';

// The desktop app serves the UI and the API from the same local server,
// so relative /api URLs always work. VITE_API_URL is only for unusual dev setups.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' }
});

// Every request says who it is with the sign-in token.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// An expired or rejected token signs the person out (the sign-in screen takes over).
// Wrong passwords at the sign-in form also answer 401; those are shown there instead.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthForm = /\/auth\/(login|signup)/.test(err.config?.url || '');
    if (err.response?.status === 401 && !isAuthForm) {
      clearToken();
      window.dispatchEvent(new Event('peblo:signed-out'));
    }
    return Promise.reject(err);
  }
);

export default api;
