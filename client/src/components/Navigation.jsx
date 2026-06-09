import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState, useRef, useEffect } from 'react';
import { LogOut, Keyboard, Bell, User, Settings, Phone } from 'lucide-react';
import SettingsModal from './SettingsModal';
import AnimatedTabBar from './AnimatedTabBar';
import { MAIN_NAV_TABS, MOBILE_NAV_TABS } from '../config/navTabs';

export default function Navigation() {
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
          <AnimatedTabBar tabs={MAIN_NAV_TABS} variant="navbar" className="navbar-tab-switcher" />

          {/* App Controls */}
          <div className="navbar-controls-section">
            <button 
              className="navbar-icon-btn" 
              onClick={() => window.dispatchEvent(new CustomEvent('trigger_ai_call'))}
              title="Test AI Call"
              style={{ color: '#22c55e' }}
            >
              <Phone size={18} />
            </button>
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
        <AnimatedTabBar tabs={MOBILE_NAV_TABS} variant="mobile" />
        <button className="profile-trigger" style={{ display: 'none' }} onClick={() => setProfileOpen(true)} type="button" aria-hidden="true" />
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
      {/* Unified Settings Hub */}
      {(profileOpen || settingsOpen) && (
        <SettingsModal 
          initialTab={profileOpen ? 'profile' : 'appearance'} 
          onClose={() => {
            setProfileOpen(false);
            setSettingsOpen(false);
          }} 
        />
      )}
    </>
  );
}
