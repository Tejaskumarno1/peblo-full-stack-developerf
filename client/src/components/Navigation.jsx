import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState, useRef, useEffect } from 'react';
import { LogOut, Keyboard, Bell, User, Settings, Sparkles } from 'lucide-react';

export default function Navigation({ activeTab }) {
  const { 
    user, 
    logout, 
    updateProfile,
    theme,
    setTheme,
    settings,
    updateSettings,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications
  } = useAuth();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');

  const dropdownRef = useRef(null);
  const bellRef = useRef(null);

  useEffect(() => {
    if (user) {
      setProfileName(user.name || '');
      setProfileEmail(user.email || '');
    }
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSaveProfile = (e) => {
    e.preventDefault();
    updateProfile({ name: profileName, email: profileEmail });
    setProfileOpen(false);
  };

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <header className="floating-navbar-wrapper">
        <div className="floating-navbar">
          {/* Logo Section */}
          <div className="navbar-logo-section">
            <Link to="/" className="navbar-logo-link">
              <svg viewBox="0 0 24 24" className="navbar-logo-svg" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="navbar-logo-text">peblo</span>
            </Link>
          </div>

          {/* Tab Switcher */}
          <div className="navbar-tab-switcher">
            <Link 
              to="/" 
              className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            >
              Dashboard
            </Link>
            <Link 
              to="/notes" 
              className={`tab-btn ${activeTab === 'workspace' ? 'active' : ''}`}
            >
              Workspace
            </Link>
          </div>

          {/* App Controls */}
          <div className="navbar-controls-section">
            <button 
              className="navbar-icon-btn" 
              onClick={() => setShortcutsOpen(true)}
              title="Keyboard Shortcuts"
            >
              <Keyboard size={18} />
            </button>
            
            <div className="navbar-bell-container" ref={bellRef}>
              <button 
                className="navbar-icon-btn navbar-bell-btn" 
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                title="Notifications"
              >
                <Bell size={18} />
                {unreadCount > 0 && <span className="navbar-bell-dot">{unreadCount}</span>}
              </button>
              {notificationsOpen && (
                <div className="navbar-notifications-dropdown">
                  <div className="notifications-header">
                    <h4>Notifications</h4>
                    {unreadCount > 0 && (
                      <button onClick={markAllNotificationsRead} className="btn-text-xs">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="notifications-list">
                    {notifications.length === 0 ? (
                      <div className="notifications-empty">No notifications</div>
                    ) : (
                      notifications.map(n => (
                        <div 
                          key={n.id} 
                          className={`notification-item ${n.read ? 'read' : 'unread'}`} 
                          onClick={() => markNotificationRead(n.id)}
                        >
                          <p className="notification-text">{n.text}</p>
                          <span className="notification-time">{formatTime(n.time)}</span>
                        </div>
                      ))
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <div className="notifications-footer">
                      <button onClick={clearNotifications} className="btn-text-xs text-error">
                        Clear all
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="navbar-avatar-container" ref={dropdownRef} onClick={() => setDropdownOpen(!dropdownOpen)}>
              <div className="navbar-avatar-circle">{initial}</div>
              {dropdownOpen && (
                <div className="navbar-avatar-dropdown">
                  <div className="dropdown-header">
                    <span className="dropdown-name">{user?.name}</span>
                    <span className="dropdown-email">{user?.email}</span>
                  </div>
                  <button className="dropdown-item" onClick={(e) => { e.stopPropagation(); setDropdownOpen(false); setProfileOpen(true); }}>
                    <User size={14} /> Profile
                  </button>
                  <button className="dropdown-item" onClick={(e) => { e.stopPropagation(); setDropdownOpen(false); setSettingsOpen(true); }}>
                    <Settings size={14} /> Settings
                  </button>
                  <div className="dropdown-divider" />
                  <button className="dropdown-item text-error" onClick={handleLogout}>
                    <LogOut size={14} /> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Tab Bar */}
      <nav className="mobile-bottom-nav premium-bottom-nav">
        <Link to="/" className={`mobile-tab ${activeTab === 'dashboard' ? 'active' : ''}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
          <span>Dashboard</span>
        </Link>
        <Link to="/notes" className={`mobile-tab ${activeTab === 'workspace' ? 'active' : ''}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Workspace</span>
        </Link>
        <button className="mobile-tab" onClick={() => document.querySelector('.ai-chat-fab')?.click()}>
          <Sparkles size={24} />
          <span>AI Copilot</span>
        </button>
        <button className="profile-trigger" style={{display: 'none'}} onClick={() => setProfileOpen(true)}></button>
      </nav>


      {/* Keyboard Shortcuts Modal */}
      {shortcutsOpen && (
        <div className="shortcuts-overlay" onClick={() => setShortcutsOpen(false)}>
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal-header">
              <h3>Keyboard Shortcuts</h3>
              <button className="btn-icon-sm" onClick={() => setShortcutsOpen(false)}>×</button>
            </div>
            <div className="shortcuts-list">
              <div className="shortcut-row">
                <span className="shortcut-desc">Save note</span>
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
              </div>
              <div className="shortcut-row">
                <span className="shortcut-desc">Search notes</span>
                <kbd>Ctrl</kbd> + <kbd>K</kbd>
              </div>
              <div className="shortcut-row">
                <span className="shortcut-desc">New note</span>
                <kbd>Ctrl</kbd> + <kbd>N</kbd>
              </div>
              <div className="shortcut-row">
                <span className="shortcut-desc">Toggle preview</span>
                <kbd>Ctrl</kbd> + <kbd>P</kbd>
              </div>
              <div className="shortcut-row">
                <span className="shortcut-desc">Toggle AI panel</span>
                <kbd>Ctrl</kbd> + <kbd>J</kbd>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Profile Modal */}
      {profileOpen && (
        <div className="shortcuts-overlay" onClick={() => setProfileOpen(false)}>
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal-header">
              <h3>Profile Settings</h3>
              <button className="btn-icon-sm" onClick={() => setProfileOpen(false)}>×</button>
            </div>
            <form onSubmit={handleSaveProfile} className="shortcuts-list">
              <div className="avatar-section">
                <div className="avatar-large">{initial}</div>
                <div className="avatar-details">
                  <h4>{user?.name}</h4>
                  <p>{user?.email}</p>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={profileName} 
                  onChange={(e) => setProfileName(e.target.value)} 
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address (Read-only)</label>
                <input 
                  type="email" 
                  className="form-input"
                  value={profileEmail} 
                  disabled
                  title="Email address cannot be changed"
                  style={{ opacity: 0.6, cursor: 'not-allowed' }}
                />
              </div>
              <div className="setting-section" style={{ padding: '0.5rem 0', borderTop: '1px solid var(--border-subtle)' }}>
                <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>App Theme</label>
                <div className="theme-toggle-group">
                  <button 
                    type="button"
                    className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    Light
                  </button>
                  <button 
                    type="button"
                    className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    Dark
                  </button>
                  <button 
                    type="button"
                    className={`theme-toggle-btn ${theme === 'system' ? 'active' : ''}`}
                    onClick={() => setTheme('system')}
                  >
                    System
                  </button>
                </div>
              </div>
              <div className="modal-actions-row">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setProfileOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="shortcuts-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-modal-header">
              <h3>Preferences & Settings</h3>
              <button className="btn-icon-sm" onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <div className="shortcuts-list">
              <div className="setting-section">
                <h4 className="setting-section-title">Theme Settings</h4>
                <div className="theme-toggle-group">
                  <button 
                    type="button"
                    className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    Light Mode
                  </button>
                  <button 
                    type="button"
                    className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    Dark Mode
                  </button>
                </div>
              </div>

              <div className="setting-section">
                <h4 className="setting-section-title">Workspace Editor</h4>
                <div className="setting-row-flex">
                  <label htmlFor="font-size-select" className="form-label">Editor Font Size</label>
                  <select 
                    id="font-size-select"
                    className="form-select"
                    value={settings.fontSize} 
                    onChange={(e) => updateSettings({ fontSize: e.target.value })}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                <div className="setting-row-checkbox">
                  <input 
                    id="word-wrap-checkbox"
                    type="checkbox" 
                    checked={settings.wordWrap} 
                    onChange={(e) => updateSettings({ wordWrap: e.target.checked })}
                  />
                  <label htmlFor="word-wrap-checkbox" className="checkbox-label">Enable word wrap in editor</label>
                </div>
              </div>

              <div className="setting-section">
                <h4 className="setting-section-title">AI Configuration</h4>
                <div className="setting-row-checkbox">
                  <input 
                    id="auto-title-checkbox"
                    type="checkbox" 
                    checked={settings.autoTitle} 
                    onChange={(e) => updateSettings({ autoTitle: e.target.checked })}
                  />
                  <label htmlFor="auto-title-checkbox" className="checkbox-label">Auto-suggest titles for drafts</label>
                </div>
              </div>

              <div className="modal-actions-row">
                <button type="button" className="btn btn-primary btn-full btn-sm" onClick={() => setSettingsOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
