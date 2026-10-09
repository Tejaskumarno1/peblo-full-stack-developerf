import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { profileAPI, authAPI } from '../api/index';
import { getToken, setToken, clearToken } from '../api/token';

const AuthContext = createContext(null);

// Things kept on this computer that are about the *device*, not the account that just left (PEB-60).
const DEVICE_KEYS = new Set([
  'peblo-theme', 'peblo-style', 'peblo-sidebar-collapsed', 'peblo-river-zoom', 'peblo-river-notes-view',
  'peblo_call_gender', 'peblo_call_rate', 'peblo_call_ringtone',
]);

// Remove everything else Peblo stored for the previous account: cached notes, settings (which held API keys),
// AI Hub chats, notifications, reminder state. Covers both the `peblo-` and `peblo_` key styles.
export function clearAccountData() {
  try {
    Object.keys(localStorage)
      .filter(k => /^peblo[-_]/.test(k) && !DEVICE_KEYS.has(k))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // 'offline' when the Peblo server can't be reached (so we don't mistake it for being signed out)
  const [connectError, setConnectError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const queryClient = useQueryClient();

  const [theme, setThemeState] = useState(() => localStorage.getItem('peblo-theme') || 'light');
  // Style: 'studio' (sidebar), 'console' (keyboard-first) or 'soft' (friendly, with a dock).
  const [uiStyle, setUiStyleState] = useState(() => {
    try { return localStorage.getItem('peblo-style') || 'studio'; } catch { return 'studio'; }
  });
  
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('peblo-settings');
      return saved ? JSON.parse(saved) : { fontSize: 'medium', wordWrap: true, autoTitle: true };
    } catch {
      return { fontSize: 'medium', wordWrap: true, autoTitle: true };
    }
  });

  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('peblo-notifications');
      return saved ? JSON.parse(saved) : [
        { id: '1', text: 'Welcome to Peblo Notes! 🎉 Capture ideas, extract AI insights, and organize with tags.', read: false, time: new Date().toISOString() },
        { id: '2', text: 'Need a summary? Try the AI Assistant by clicking the Sparkles button in the editor.', read: false, time: new Date().toISOString() },
        { id: '3', text: 'Tip: Use Ctrl + K to quickly focus the search bar.', read: true, time: new Date().toISOString() }
      ];
    } catch {
      return [];
    }
  });

  // Apply the theme: light (Paper), dark (Graphite), midnight (pure black) or follow the system.
  useEffect(() => {
    const apply = () => {
      const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
      for (const el of [document.body, document.documentElement]) {
        el.classList.toggle('theme-dark', resolved === 'dark' || resolved === 'midnight');
        el.classList.toggle('theme-midnight', resolved === 'midnight');
      }
    };
    apply();
    if (theme !== 'system' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    for (const el of [document.body, document.documentElement]) el.setAttribute('data-style', uiStyle);
  }, [uiStyle]);

  // Merge the settings saved on the account into this device's settings.
  const adoptProfile = useCallback((u) => {
    setUser(u);
    if (u?.settings && typeof u.settings === 'object') {
      setSettings(prev => {
        const merged = { ...u.settings, ...prev };
        try { localStorage.setItem('peblo-settings', JSON.stringify(merged)); } catch { /* ignore */ }
        return merged;
      });
    }
  }, []);

  // On start: if this device has a sign-in token, load that account. Otherwise show the sign-in screen.
  useEffect(() => {
    if (!getToken()) { setUser(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    setConnectError(null);
    profileAPI.me()
      .then(res => { if (!cancelled) adoptProfile(res.data.user); })
      .catch(err => {
        if (cancelled) return;
        // A 401 already cleared the token (the interceptor); anything else is a connection problem.
        if (!err.response) setConnectError('offline');
        else if (err.response.status !== 401) setConnectError('error');
        console.error('Failed to load profile:', err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [adoptProfile, reloadKey]);

  // Signed out from anywhere (an expired token, or another window): back to the sign-in screen.
  useEffect(() => {
    const out = () => { clearAccountData(); setUser(null); queryClient.clear(); };
    window.addEventListener('peblo:signed-out', out);
    // Signing in or out in another window (e.g. quick capture) changes the shared token.
    const onStorage = (e) => { if (e.key === 'peblo-token') setReloadKey(k => k + 1); };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('peblo:signed-out', out); window.removeEventListener('storage', onStorage); };
  }, [queryClient]);

  const signIn = useCallback(async (mode, form) => {
    const call = mode === 'signup' ? authAPI.signup : authAPI.login;
    const res = await call(form);
    queryClient.clear();
    setToken(res.data.token);
    setConnectError(null);
    adoptProfile(res.data.user);
    return res.data.user;
  }, [adoptProfile, queryClient]);

  const logout = useCallback(() => {
    clearToken();
    clearAccountData();
    setSettings({ fontSize: 'medium', wordWrap: true, autoTitle: true });
    setNotifications([]);
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const retryConnect = useCallback(() => setReloadKey(k => k + 1), []);

  // WebSockets for Real-Time Device Syncing
  useEffect(() => {
    if (!user) return;
    
    // Connect to backend server
    const socketURL = import.meta.env.VITE_API_URL 
      ? import.meta.env.VITE_API_URL.replace('/api', '') 
      : window.location.origin;
      
    // The server reads who we are from the token and puts us in our own room.
    const socket = io(socketURL, { auth: (cb) => cb({ token: getToken() }) });

    socket.on('todos_changed', () => {
      queryClient.invalidateQueries(['todos']);
    });

    socket.on('notes_changed', () => {
      queryClient.invalidateQueries(['notes']);
    });

    return () => {
      socket.disconnect();
    };
  }, [user, queryClient]);

  const updateProfile = useCallback(async (updatedUser) => {
    // Optimistic UI update
    setUser((prev) => ({ ...prev, ...updatedUser }));
    
    try {
      await profileAPI.updateProfile(updatedUser);
    } catch (err) {
      console.error('Failed to update profile to DB:', err);
    }
  }, []);

  const setUiStyle = useCallback((style) => {
    setUiStyleState(style);
    try { localStorage.setItem('peblo-style', style); } catch { /* ignore */ }
  }, []);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('peblo-theme', newTheme);
  }, []);

  const updateSettings = useCallback(async (newSettings) => {
    // Optimistic UI update
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('peblo-settings', JSON.stringify(updated));
      return updated;
    });

    try {
      const payload = {};
      if ('jobTitle' in newSettings) payload.jobTitle = newSettings.jobTitle;
      if ('bio' in newSettings) payload.bio = newSettings.bio;
      if ('timezone' in newSettings) payload.timezone = newSettings.timezone;
      
      const pureSettings = { ...newSettings };
      delete pureSettings.jobTitle;
      delete pureSettings.bio;
      delete pureSettings.timezone;
      
      if (Object.keys(pureSettings).length > 0) {
        payload.settings = pureSettings;
      }
      
      if (Object.keys(payload).length > 0) {
        // Fire and forget, no await to prevent UI blocking if network is slow
        profileAPI.updateProfile(payload).catch(err => {
          console.error('Failed to sync settings to DB:', err);
        });
      }
    } catch (err) {
      console.error('Error in settings sync payload construction:', err);
    }
  }, []);

  const addNotification = useCallback((text) => {
    setNotifications((prev) => {
      const updated = [
        { id: Date.now().toString(), text, read: false, time: new Date().toISOString() },
        ...prev
      ];
      localStorage.setItem('peblo-notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const markNotificationRead = useCallback((id) => {
    setNotifications((prev) => {
      const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
      localStorage.setItem('peblo-notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map(n => ({ ...n, read: true }));
      localStorage.setItem('peblo-notifications', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    localStorage.removeItem('peblo-notifications');
  }, []);

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      connectError,
      signIn,
      logout,
      retryConnect,
      updateProfile,
      theme,
      setTheme,
      uiStyle,
      setUiStyle,
      settings,
      updateSettings,
      notifications,
      addNotification,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotifications
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
