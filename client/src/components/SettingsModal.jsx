import React, { useState, memo } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, Settings, Shield, Bell, Palette, X, Monitor, Moon, Sun, AlertTriangle, LogOut, Key, Cpu, Zap, Sparkles, Bot, Rocket, Box, ChevronDown } from 'lucide-react';
import { authAPI } from '../api';
import { useGoogleLogin } from '@react-oauth/google';

function SettingsModal({ onClose, initialTab = 'profile' }) {
  const { user, updateProfile, theme, setTheme, settings, updateSettings, logout } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // Profile specific states (saved to user obj in DB ideally, mocked here)
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail] = useState(user?.email || '');
  const [profileJob, setProfileJob] = useState(settings?.jobTitle || '');
  const [profileBio, setProfileBio] = useState(settings?.bio || '');
  const [profileTimezone, setProfileTimezone] = useState(settings?.timezone || 'UTC');

  const [openAiKey, setOpenAiKey] = useState(settings?.openAiKey || '');
  const [geminiKey, setGeminiKey] = useState(settings?.geminiKey || '');
  const [groqKey, setGroqKey] = useState(settings?.groqKey || '');
  const [huggingFaceKey, setHuggingFaceKey] = useState(settings?.huggingFaceKey || '');
  const [defaultAiModel, setDefaultAiModel] = useState(settings?.defaultAiModel || 'auto');
  const [forceCustomModels, setForceCustomModels] = useState(settings?.forceCustomModels || false);
  const [isAiDropdownOpen, setIsAiDropdownOpen] = useState(false);

  const handleSaveApiKeys = (e) => {
    e.preventDefault();
    updateSettings({ openAiKey, geminiKey, groqKey, huggingFaceKey, defaultAiModel, forceCustomModels });
    setSaveSuccess('AI Settings saved successfully!');
    setTimeout(() => setSaveSuccess(''), 3000);
  };

  const [saveSuccess, setSaveSuccess] = useState('');

  const handleSaveProfile = (e) => {
    e.preventDefault();
    updateProfile({ name: profileName, email: profileEmail });
    updateSettings({ jobTitle: profileJob, bio: profileBio, timezone: profileTimezone });
    setSaveSuccess('Profile saved successfully!');
    setTimeout(() => setSaveSuccess(''), 3000);
  };

  const handleLogoutDevices = async () => {
    if (window.confirm('Are you sure you want to sign out of all other devices?')) {
      try {
        await authAPI.logoutAll();
        alert('All other active sessions have been terminated.');
      } catch (err) {
        alert('Failed to sign out of other devices.');
      }
    }
  };

  const handleChangePassword = async () => {
    const newPassword = window.prompt('Enter your new password (min 6 characters):');
    if (!newPassword) return;
    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }
    try {
      await authAPI.updatePassword({ newPassword });
      alert('Password updated successfully.');
    } catch (err) {
      alert('Failed to update password.');
    }
  };

  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const googleLinkAction = useGoogleLogin({
    flow: 'auth-code',
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
    onSuccess: async (tokenResponse) => {
      setLoadingGoogle(true);
      try {
        await authAPI.linkGoogle({ code: tokenResponse.code });
        updateSettings({ googleConnected: true });
        alert('Google Account linked successfully!');
      } catch (err) {
        console.error('Failed to link Google account', err);
        alert('Failed to link Google account');
      } finally {
        setLoadingGoogle(false);
      }
    },
    onError: () => alert('Google login failed')
  });

  const handleToggleGoogle = () => {
    if (settings.googleConnected) {
      if (window.confirm('Are you sure you want to disconnect your Google Account?')) {
        updateSettings({ googleConnected: false });
      }
    } else {
      googleLinkAction();
    }
  };

  return (
    <div className="settings-hub-overlay" onClick={onClose}>
      <div className="settings-hub-container" onClick={(e) => e.stopPropagation()}>
        
        {/* Sidebar Navigation */}
        <div className="settings-hub-sidebar">
          <h3>User Settings</h3>
          <button 
            className={`settings-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <User size={18} /> Profile
          </button>
          <button 
            className={`settings-tab-btn ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={18} /> Appearance
          </button>
          <button 
            className={`settings-tab-btn ${activeTab === 'preferences' ? 'active' : ''}`}
            onClick={() => setActiveTab('preferences')}
          >
            <Settings size={18} /> Preferences
          </button>
          
          <h3 style={{ marginTop: '1.5rem' }}>Workspace</h3>
          <button 
            className={`settings-tab-btn ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            <Bell size={18} /> Notifications
          </button>
          <button 
            className={`settings-tab-btn ${activeTab === 'ai-providers' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai-providers')}
          >
            <Cpu size={18} /> AI Providers
          </button>
          <button 
            className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <Shield size={18} /> Security
          </button>
        </div>

        {/* Main Content Area */}
        <div className="settings-hub-content">
          <button className="settings-hub-close" onClick={onClose}><X size={18} /></button>

          {activeTab === 'profile' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Public Profile</h2>
              
              <div className="settings-avatar-hero">
                <div className="settings-avatar-circle">{initial}</div>
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>Profile Picture</h4>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Avatar is currently generated from your display name.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSaveProfile}>
                <div className="settings-field-group">
                  <label className="settings-field-label">Display Name</label>
                  <input 
                    type="text" 
                    className="settings-field-input"
                    value={profileName} 
                    onChange={(e) => setProfileName(e.target.value)} 
                    required
                  />
                </div>
                
                <div className="settings-grid-2">
                  <div className="settings-field-group">
                    <label className="settings-field-label">Job Title / Role</label>
                    <input 
                      type="text" 
                      className="settings-field-input"
                      value={profileJob} 
                      onChange={(e) => setProfileJob(e.target.value)} 
                      placeholder="e.g. Senior Developer"
                    />
                  </div>
                  <div className="settings-field-group">
                    <label className="settings-field-label">Timezone</label>
                    <select 
                      className="settings-field-input"
                      value={profileTimezone}
                      onChange={(e) => setProfileTimezone(e.target.value)}
                    >
                      <option value="UTC">UTC (Universal Time)</option>
                      <option value="EST">EST (Eastern Standard Time)</option>
                      <option value="PST">PST (Pacific Standard Time)</option>
                      <option value="IST">IST (Indian Standard Time)</option>
                      <option value="CET">CET (Central European Time)</option>
                    </select>
                  </div>
                </div>

                <div className="settings-field-group">
                  <label className="settings-field-label">Short Bio</label>
                  <textarea 
                    className="settings-field-input"
                    rows="3"
                    value={profileBio}
                    onChange={(e) => setProfileBio(e.target.value)}
                    placeholder="Tell us a bit about yourself..."
                    style={{ resize: 'none' }}
                  ></textarea>
                </div>

                <div className="settings-field-group">
                  <label className="settings-field-label">Email Address</label>
                  <input 
                    type="email" 
                    className="settings-field-input"
                    value={profileEmail} 
                    disabled
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Contact support to change your primary email address.
                  </p>
                </div>
                
                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <button type="submit" className="btn btn-primary">Save Profile Changes</button>
                  {saveSuccess && <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 500 }}>{saveSuccess}</span>}
                </div>
              </form>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Appearance</h2>
              
              <div className="settings-field-group">
                <label className="settings-field-label">Theme Preference</label>
                <div className="settings-theme-grid">
                  <div className={`theme-card ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>
                    <div className="theme-preview light"></div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}><Sun size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> Light</span>
                  </div>
                  <div className={`theme-card ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>
                    <div className="theme-preview dark"></div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}><Moon size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> Dark</span>
                  </div>
                  <div className={`theme-card ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')}>
                    <div className="theme-preview system"></div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}><Monitor size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> System</span>
                  </div>
                </div>
              </div>

              <h3 style={{ marginTop: '2.5rem', marginBottom: '1rem', fontSize: '1.1rem' }}>Layout Settings</h3>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4>Compact Mode</h4>
                  <p>Reduces padding and margins across the interface to fit more content on screen.</p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={settings?.compactMode || false} 
                    onChange={(e) => updateSettings({ compactMode: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Editor Preferences</h2>
              
              <div className="settings-grid-2" style={{ marginBottom: '1rem' }}>
                <div className="settings-field-group">
                  <label className="settings-field-label">Editor Font Size</label>
                  <select 
                    className="settings-field-input"
                    value={settings.fontSize || 'medium'} 
                    onChange={(e) => updateSettings({ fontSize: e.target.value })}
                  >
                    <option value="small">Small (13px)</option>
                    <option value="medium">Medium (15px)</option>
                    <option value="large">Large (18px)</option>
                  </select>
                </div>
                
                <div className="settings-field-group">
                  <label className="settings-field-label">Note Language</label>
                  <select 
                    className="settings-field-input"
                    value={settings.language || 'en'} 
                    onChange={(e) => updateSettings({ language: e.target.value })}
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                  </select>
                </div>
              </div>

              <div className="settings-field-group">
                <label className="settings-field-label">Auto-save Interval</label>
                <select 
                  className="settings-field-input"
                  value={settings.autoSaveInterval || '5'} 
                  onChange={(e) => updateSettings({ autoSaveInterval: e.target.value })}
                >
                  <option value="1">Every 1 minute</option>
                  <option value="5">Every 5 minutes</option>
                  <option value="15">Every 15 minutes</option>
                  <option value="0">Never (Manual Save Only)</option>
                </select>
              </div>

              <h3 style={{ marginTop: '2.5rem', marginBottom: '1rem', fontSize: '1.1rem' }}>Behavior</h3>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4>Enable Word Wrap</h4>
                  <p>Wrap long lines of text to fit the editor width.</p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.wordWrap ?? true} 
                    onChange={(e) => updateSettings({ wordWrap: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4>Auto-suggest Titles (AI)</h4>
                  <p>Automatically generate titles for new drafts based on content.</p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.autoTitle ?? true} 
                    onChange={(e) => updateSettings({ autoTitle: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Notification Settings</h2>
              
              <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--text-primary)' }}>Email Notifications</h3>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4>Product Updates & Marketing</h4>
                  <p>Receive emails about new features, tips, and promotional offers.</p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.emailMarketing ?? false} 
                    onChange={(e) => updateSettings({ emailMarketing: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4>Weekly Activity Digest</h4>
                  <p>A summary of your notes, insights, and productivity stats every Monday.</p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.emailActivity ?? true} 
                    onChange={(e) => updateSettings({ emailActivity: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <h3 style={{ marginTop: '2.5rem', marginBottom: '1rem', fontSize: '1.1rem', color: 'var(--text-primary)' }}>Push Notifications</h3>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4>Task Reminders</h4>
                  <p>Get notified when a deadline from your To-Do list is approaching.</p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.pushReminders ?? true} 
                    onChange={(e) => updateSettings({ pushReminders: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Security & Access</h2>
              
              <div className="settings-toggle-row" style={{ borderColor: settings.twoFactor ? 'var(--success)' : '' }}>
                <div className="settings-toggle-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Shield size={16} style={{ color: settings.twoFactor ? 'var(--success)' : 'inherit' }} /> 
                    Two-Factor Authentication (2FA)
                  </h4>
                  <p>Add an extra layer of security to your account using an authenticator app.</p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={settings.twoFactor ?? false} 
                    onChange={(e) => updateSettings({ twoFactor: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <h3 style={{ marginTop: '2.5rem', marginBottom: '1rem', fontSize: '1.1rem' }}>Connected Accounts</h3>
              
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Google Account
                  </h4>
                  <p>Sign in quickly and sync contacts using your Google Account.</p>
                </div>
                <button 
                  type="button"
                  className={`btn ${settings.googleConnected ? 'btn-outline' : 'btn-primary'}`}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', opacity: loadingGoogle ? 0.7 : 1 }}
                  onClick={handleToggleGoogle}
                  disabled={loadingGoogle}
                >
                  {loadingGoogle ? 'Connecting...' : (settings.googleConnected ? 'Disconnect' : 'Connect Google')}
                </button>
              </div>

              <h3 style={{ marginTop: '2.5rem', marginBottom: '1rem', fontSize: '1.1rem' }}>Account Actions</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button 
                  className="settings-field-input" 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', fontWeight: 500 }}
                  onClick={handleChangePassword}
                >
                  <Key size={18} className="text-muted" /> Change Account Password
                </button>
                
                <button 
                  className="settings-field-input" 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', fontWeight: 500 }}
                  onClick={handleLogoutDevices}
                >
                  <Monitor size={18} className="text-muted" /> Sign out of all other devices
                </button>
              </div>

              <div style={{ marginTop: '3rem', padding: '1.5rem', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.05)' }}>
                <h4 style={{ color: '#ef4444', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={18} /> Danger Zone
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Permanently delete your account and all of your content. This action cannot be undone.
                </p>
                <button 
                  className="btn btn-outline" 
                  style={{ borderColor: '#ef4444', color: '#ef4444' }}
                  onClick={() => {
                    if(window.confirm('Are you absolutely sure you want to delete your account? This cannot be undone.')){
                      logout();
                      onClose();
                    }
                  }}
                >
                  <LogOut size={16} /> Delete Account
                </button>
              </div>
            </div>
          )}

          {activeTab === 'ai-providers' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">AI Providers & Models</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Connect your own API keys to use custom models. Keys are stored securely in your browser and are never sent to our servers except when proxying requests.
              </p>

              <form onSubmit={handleSaveApiKeys}>
                <div className="settings-field-group" style={{ background: 'var(--bg-elevated)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-strong)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                  <label className="settings-field-label" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: '0.75rem' }}>Default AI Agent</label>
                  <div style={{ position: 'relative' }}>
                    <div 
                      className="settings-field-input"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: 'var(--bg-surface)', border: '2px solid var(--border-subtle)', fontWeight: 500 }}
                      onClick={() => setIsAiDropdownOpen(!isAiDropdownOpen)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {defaultAiModel === 'auto' && <><Zap size={16} /> Auto-Detect (Uses best available key)</>}
                        {defaultAiModel === 'openai' && <><Bot size={16} /> OpenAI (GPT-4 / GPT-3.5)</>}
                        {defaultAiModel === 'gemini' && <><Sparkles size={16} /> Google Gemini</>}
                        {defaultAiModel === 'groq' && <><Rocket size={16} /> Groq (Llama 3)</>}
                        {defaultAiModel === 'huggingface' && <><Box size={16} /> Hugging Face</>}
                      </div>
                      <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    
                    {isAiDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '0.25rem', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden' }}>
                        {[
                          { id: 'auto', icon: Zap, label: 'Auto-Detect (Uses best available key)' },
                          { id: 'openai', icon: Bot, label: 'OpenAI (GPT-4 / GPT-3.5)' },
                          { id: 'gemini', icon: Sparkles, label: 'Google Gemini' },
                          { id: 'groq', icon: Rocket, label: 'Groq (Llama 3)' },
                          { id: 'huggingface', icon: Box, label: 'Hugging Face' }
                        ].map((option) => (
                          <div 
                            key={option.id}
                            style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: defaultAiModel === option.id ? 'var(--bg-hover)' : 'transparent', transition: 'background 0.2s' }}
                            onClick={() => { setDefaultAiModel(option.id); setIsAiDropdownOpen(false); }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = defaultAiModel === option.id ? 'var(--bg-hover)' : 'transparent'}
                          >
                            <option.icon size={16} style={{ color: 'var(--accent)' }} />
                            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>{option.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                    Peblo will automatically route requests to the selected AI model when you provide the corresponding key.
                  </p>
                </div>

                <div className="settings-toggle-row" style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
                  <div className="settings-toggle-info">
                    <h4>Force Custom Models Only</h4>
                    <p>Disable Peblo's fallback models. We will exclusively use your API keys across all features (including Voice Calls).</p>
                  </div>
                  <label className="toggle-switch">
                    <input 
                      type="checkbox" 
                      checked={forceCustomModels} 
                      onChange={(e) => setForceCustomModels(e.target.checked)} 
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="settings-field-group">
                  <label className="settings-field-label">OpenAI API Key {settings?.invalidKeys?.includes('openai') && <span style={{color: '#ef4444', marginLeft: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '4px'}}><AlertTriangle size={14} /> Limit Reached</span>}</label>
                  <input 
                    type="password" 
                    className="settings-field-input"
                    style={settings?.invalidKeys?.includes('openai') ? { borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.05)' } : {}}
                    value={openAiKey} 
                    onChange={(e) => setOpenAiKey(e.target.value)} 
                    placeholder="sk-..."
                  />
                  {settings?.invalidKeys?.includes('openai') ? (
                    <p style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.5rem', fontWeight: 500 }}>This API key has reached its usage limit or is invalid. Please replace or delete it.</p>
                  ) : (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Used for GPT-4, GPT-3.5, and DALL-E models.</p>
                  )}
                </div>

                <div className="settings-field-group">
                  <label className="settings-field-label">Google Gemini API Key {settings?.invalidKeys?.includes('gemini') && <span style={{color: '#ef4444', marginLeft: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '4px'}}><AlertTriangle size={14} /> Limit Reached</span>}</label>
                  <input 
                    type="password" 
                    className="settings-field-input"
                    style={settings?.invalidKeys?.includes('gemini') ? { borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.05)' } : {}}
                    value={geminiKey} 
                    onChange={(e) => setGeminiKey(e.target.value)} 
                    placeholder="AIza..."
                  />
                  {settings?.invalidKeys?.includes('gemini') ? (
                    <p style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.5rem', fontWeight: 500 }}>This API key has reached its usage limit or is invalid. Please replace or delete it.</p>
                  ) : (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Used for Gemini Pro and Ultra models.</p>
                  )}
                </div>

                <div className="settings-field-group">
                  <label className="settings-field-label">Groq API Key {settings?.invalidKeys?.includes('groq') && <span style={{color: '#ef4444', marginLeft: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '4px'}}><AlertTriangle size={14} /> Limit Reached</span>}</label>
                  <input 
                    type="password" 
                    className="settings-field-input"
                    style={settings?.invalidKeys?.includes('groq') ? { borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.05)' } : {}}
                    value={groqKey} 
                    onChange={(e) => setGroqKey(e.target.value)} 
                    placeholder="gsk_..."
                  />
                  {settings?.invalidKeys?.includes('groq') ? (
                    <p style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.5rem', fontWeight: 500 }}>This API key has reached its usage limit or is invalid. Please replace or delete it.</p>
                  ) : (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Used for ultra-fast Llama 3 inferences.</p>
                  )}
                </div>

                <div className="settings-field-group">
                  <label className="settings-field-label">Hugging Face Access Token {settings?.invalidKeys?.includes('huggingface') && <span style={{color: '#ef4444', marginLeft: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '4px'}}><AlertTriangle size={14} /> Limit Reached</span>}</label>
                  <input 
                    type="password" 
                    className="settings-field-input"
                    style={settings?.invalidKeys?.includes('huggingface') ? { borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.05)' } : {}}
                    value={huggingFaceKey} 
                    onChange={(e) => setHuggingFaceKey(e.target.value)} 
                    placeholder="hf_..."
                  />
                  {settings?.invalidKeys?.includes('huggingface') ? (
                    <p style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.5rem', fontWeight: 500 }}>This API key has reached its usage limit or is invalid. Please replace or delete it.</p>
                  ) : (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Used for open-source models.</p>
                  )}
                </div>
                
                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <button type="submit" className="btn btn-primary">Save AI Settings</button>
                  {saveSuccess && <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 500 }}>{saveSuccess}</span>}
                </div>
              </form>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default memo(SettingsModal);
