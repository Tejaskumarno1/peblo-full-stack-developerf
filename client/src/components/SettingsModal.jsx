import React, { useState, memo } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, Settings, Shield, Bell, Palette, X, Monitor, Moon, Sun, AlertTriangle, LogOut, Key, Cpu, Zap, Sparkles, Bot, Rocket, Box, ChevronDown } from 'lucide-react';

function SettingsModal({ onClose, initialTab = 'profile' }) {
  const { user, updateProfile, theme, setTheme, settings, updateSettings } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab === 'security' ? 'data' : initialTab);
  
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

  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

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
            className={`settings-tab-btn ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => setActiveTab('data')}
          >
            <Shield size={18} /> Your Data
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

          {activeTab === 'data' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Your Data</h2>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Monitor size={16} /> Stored on this computer
                  </h4>
                  <p>
                    Peblo has no accounts and no cloud sync. Your notes, tasks and settings are saved in a
                    local database on this computer. To back them up, open <strong>Help → Open Data Folder</strong> from
                    the menu bar and copy the <code>peblo.db</code> file.
                  </p>
                </div>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Key size={16} /> AI keys stay local
                  </h4>
                  <p>
                    API keys you add under AI Providers are kept in the same local database. They are only sent to
                    OpenAI or Google when you use an AI feature.
                  </p>
                </div>
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
