import axios from 'axios';

// The desktop app serves the UI and the API from the same local server,
// so relative /api URLs always work. VITE_API_URL is only for unusual dev setups.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' }
});

export default api;
