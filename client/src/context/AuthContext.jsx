import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { profileAPI } from '../api/index';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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

  // Desktop app: no login. Load the single local profile (and any settings saved in the database).
  useEffect(() => {
    profileAPI.me()
      .then(res => {
        const u = res.data.user;
        setUser(u);
        if (u?.settings && typeof u.settings === 'object') {
          setSettings(prev => {
            const merged = { ...u.settings, ...prev };
            localStorage.setItem('peblo-settings', JSON.stringify(merged));
            return merged;
          });
        }
      })
      .catch(err => console.error('Failed to load profile:', err))
      .finally(() => setLoading(false));
  }, []);

  // WebSockets for Real-Time Device Syncing
  useEffect(() => {
    if (!user) return;
    
    // Connect to backend server
    const socketURL = import.meta.env.VITE_API_URL 
      ? import.meta.env.VITE_API_URL.replace('/api', '') 
      : window.location.origin;
      
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
