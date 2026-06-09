import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { authAPI } from '../api/index';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const [theme, setThemeState] = useState(() => localStorage.getItem('peblo-theme') || 'light');
  
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

  // Apply theme class to document
  useEffect(() => {
    if (theme === 'dark') {
      document.body.classList.add('theme-dark');
      document.documentElement.classList.add('theme-dark');
    } else {
      document.body.classList.remove('theme-dark');
      document.documentElement.classList.remove('theme-dark');
    }
  }, [theme]);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      authAPI.me()
        .then(res => setUser(res.data.user))
        .catch(() => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // WebSockets for Real-Time Device Syncing
  useEffect(() => {
    if (!user) return;
    
    // Connect to backend server
    const socketURL = import.meta.env.VITE_API_URL 
      ? import.meta.env.VITE_API_URL.replace('/api', '') 
      : 'http://localhost:3001';
      
    const socket = io(socketURL);
    
    socket.on('connect', () => {
      socket.emit('join', user.id);
    });

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

  // Silent background token refresh
  useEffect(() => {
    if (!user) return;
    
    const interval = setInterval(async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const res = await authAPI.refresh(refreshToken);
          localStorage.setItem('accessToken', res.data.accessToken);
        } catch (err) {
          console.error('Silent token refresh failed:', err);
        }
      }
    }, 5 * 60 * 1000); // refresh every 5 minutes
    
    return () => clearInterval(interval);
  }, [user]);

  const login = useCallback(async (email, password) => {
    const { data } = await authAPI.login({ email, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const googleLogin = useCallback(async (payload) => {
    const { data } = await authAPI.googleLogin(payload);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (name, email, password) => {
    const { data } = await authAPI.signup({ name, email, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  }, []);
  const updateProfile = useCallback(async (updatedUser) => {
    // Optimistic UI update
    setUser((prev) => ({ ...prev, ...updatedUser }));
    
    try {
      await authAPI.updateProfile(updatedUser);
    } catch (err) {
      console.error('Failed to update profile to DB:', err);
    }
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
        authAPI.updateProfile(payload).catch(err => {
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
      login, 
      googleLogin,
      signup, 
      logout, 
      updateProfile,
      theme,
      setTheme,
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
