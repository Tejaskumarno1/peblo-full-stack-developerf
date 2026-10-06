import React, { useState, memo } from 'react';
import { useAuth } from '../context/AuthContext';
import { aiAPI, transferAPI } from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { User, Settings, Shield, Bell, Palette, X, Monitor, Moon, Sun, AlertTriangle, LogOut, Key, Cpu, Zap, Sparkles, Bot, Rocket, Box, ChevronDown } from 'lucide-react';

function SettingsModal({ onClose, initialTab = 'profile' }) {
  const { user, updateProfile, theme, setTheme, uiStyle, setUiStyle, settings, updateSettings } = useAuth();
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
  const [ollamaEnabled, setOllamaEnabled] = useState(settings?.ollamaEnabled || false);
  const [ollamaUrl, setOllamaUrl] = useState(settings?.ollamaUrl || 'http://127.0.0.1:11434');
  const [ollamaModel, setOllamaModel] = useState(settings?.ollamaModel || 'llama3.2');
  const [ollamaEmbedModel, setOllamaEmbedModel] = useState(settings?.ollamaEmbedModel || 'nomic-embed-text');
  const [ollamaStatus, setOllamaStatus] = useState(null); // { ok, models, error }
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { ok, text }

  const handleImport = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const { data } = await transferAPI.importFiles(form);
      const extras = [];
      if (data.skippedImages) extras.push(`${data.skippedImages} image${data.skippedImages === 1 ? '' : 's'} skipped`);
      if (data.skippedFiles?.length) extras.push(`${data.skippedFiles.length} unsupported file${data.skippedFiles.length === 1 ? '' : 's'} skipped`);
      setImportResult({
        ok: true,
        text: `Imported ${data.imported} note${data.imported === 1 ? '' : 's'}${extras.length ? ` (${extras.join(', ')})` : ''}. They're tagged "imported".`,
      });
      queryClient.invalidateQueries();
    } catch (err) {
      setImportResult({ ok: false, text: err.response?.data?.error || 'Import failed. Make sure it is a Notion "Markdown & CSV" export or Markdown files.' });
    } finally {
      setImporting(false);
    }
  };

  const checkOllama = async () => {
    setOllamaChecking(true);
    try {
      const { data } = await aiAPI.ollamaCheck(ollamaUrl);
      setOllamaStatus(data);
    } catch {
      setOllamaStatus({ ok: false, models: [], error: 'Could not check Ollama.' });
    } finally {
      setOllamaChecking(false);
    }
  };

  const handleSaveApiKeys = (e) => {
    e.preventDefault();
    updateSettings({ openAiKey, geminiKey, defaultAiModel, ollamaEnabled, ollamaUrl: ollamaUrl.trim(), ollamaModel: ollamaModel.trim(), ollamaEmbedModel: ollamaEmbedModel.trim() });
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
                <label className="settings-field-label" id="style-label">Style</label>
                <p className="style-hint">Changes the layout, type and colours of the whole app. Light, dark and midnight work with every style.</p>
                <div className="style-grid" role="radiogroup" aria-labelledby="style-label">
                  {[
                    { id: 'studio', name: 'Studio', desc: 'Sidebar and calm serif headings' },
                    { id: 'console', name: 'Console', desc: 'Keyboard-first, command bar, dense' },
                    { id: 'soft', name: 'Soft Studio', desc: 'Friendly tiles and a floating dock' },
                    { id: 'river', name: 'River', desc: 'Your day as one timeline, past to future' },
                    { id: 'orbit', name: 'Orbit', desc: 'A map of what you know, built for studying' },
                  ].map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={uiStyle === o.id}
                      className={`style-card${uiStyle === o.id ? ' active' : ''}`}
                      onClick={() => setUiStyle(o.id)}
                    >
                      <span className={`style-preview ${o.id}`} aria-hidden="true">
                        <i className="a" /><i className="b" /><i className="c" /><i className="d" /><i className="e" />
                      </span>
                      <span className="style-name">{o.name}</span>
                      <span className="style-desc">{o.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="settings-field-group">
                <label className="settings-field-label">Theme</label>
                <div className="settings-theme-grid">
                  <div className={`theme-card ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>
                    <div className="theme-preview light"></div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}><Sun size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> Light</span>
                  </div>
                  <div className={`theme-card ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>
                    <div className="theme-preview dark"></div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}><Moon size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> Dark</span>
                  </div>
                  <div className={`theme-card ${theme === 'midnight' ? 'active' : ''}`} onClick={() => setTheme('midnight')}>
                    <div className="theme-preview dark" style={{ background: '#000' }}></div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}><Moon size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }}/> Midnight</span>
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

              <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', fontSize: '1.05rem' }}>Import</h3>
              <div className="settings-toggle-row" style={{ alignItems: 'flex-start' }}>
                <div className="settings-toggle-info">
                  <h4>From Notion, Obsidian or Markdown</h4>
                  <p>
                    In Notion: <strong>Settings → Export all workspace content</strong> (or <em>••• → Export</em> on a page), choose
                    <strong> Markdown &amp; CSV</strong>, then pick the downloaded <code>.zip</code> here. Obsidian vaults (zipped) and
                    loose <code>.md</code> files work too. Pages keep their titles and tags; databases become tables. Images aren't imported yet.
                  </p>
                  {importResult && (
                    <p style={{ marginTop: '0.5rem', fontWeight: 500, color: importResult.ok ? 'var(--success)' : '#ef4444' }}>{importResult.text}</p>
                  )}
                </div>
                <label className="btn btn-primary" style={{ whiteSpace: 'nowrap', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.7 : 1 }}>
                  {importing ? 'Importing…' : 'Choose files…'}
                  <input type="file" multiple accept=".zip,.md,.markdown,.txt,.csv" style={{ display: 'none' }} onChange={handleImport} disabled={importing} />
                </label>
              </div>

              <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', fontSize: '1.05rem' }}>Export</h3>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4>All notes as Markdown</h4>
                  <p>Download every note as a <code>.md</code> file in one <code>.zip</code>. It opens in any editor, Obsidian or Notion, so you're never locked in.</p>
                </div>
                <a className="btn btn-outline" href="/api/export" download style={{ whiteSpace: 'nowrap' }}>Export .zip</a>
              </div>
            </div>
          )}

          {activeTab === 'ai-providers' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">AI Providers & Models</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Use your own OpenAI or Gemini key, or run AI completely on this computer with Ollama. Keys are stored in Peblo's local database and only sent to the provider you use.
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
                        {defaultAiModel === 'auto' && <><Zap size={16} /> Auto (OpenAI → Gemini → Local)</>}
                        {defaultAiModel === 'openai' && <><Bot size={16} /> OpenAI (GPT-4 / GPT-3.5)</>}
                        {defaultAiModel === 'gemini' && <><Sparkles size={16} /> Google Gemini</>}
                        {defaultAiModel === 'ollama' && <><Cpu size={16} /> Local AI (Ollama): private, works offline</>}
                      </div>
                      <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    
                    {isAiDropdownOpen && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '0.25rem', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden' }}>
                        {[
                          { id: 'auto', icon: Zap, label: 'Auto (OpenAI → Gemini → Local)' },
                          { id: 'openai', icon: Bot, label: 'OpenAI (GPT-4 / GPT-3.5)' },
                          { id: 'gemini', icon: Sparkles, label: 'Google Gemini' },
                          { id: 'ollama', icon: Cpu, label: 'Local AI (Ollama): private, works offline' }
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
                    Peblo tries this provider first and falls back to any other one you've set up.
                  </p>
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
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Uses GPT-4o mini for chat and text-embedding-3-small for search.</p>
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
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Uses Gemini 2.5 Flash. Free keys are available at aistudio.google.com.</p>
                  )}
                </div>


                
                <div className="settings-field-group" style={{ marginTop: '1.5rem', background: 'var(--bg-elevated)', padding: '1.25rem', borderRadius: '12px', border: 'var(--border-subtle)' }}>
                  <div className="settings-toggle-row" style={{ border: 'none', padding: 0, margin: 0, background: 'transparent' }}>
                    <div className="settings-toggle-info">
                      <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Cpu size={16} /> Local AI (Ollama)</h4>
                      <p>Run AI models on this computer. Nothing is sent to the internet and it works offline. Install Ollama from ollama.com, then run <code>ollama pull {ollamaModel || 'llama3.2'}</code> and <code>ollama pull {ollamaEmbedModel || 'nomic-embed-text'}</code>.</p>
                    </div>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={ollamaEnabled} onChange={(e) => setOllamaEnabled(e.target.checked)} />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  {ollamaEnabled && (
                    <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                      <div>
                        <label className="settings-field-label">Ollama address</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input className="settings-field-input" value={ollamaUrl} onChange={(e) => { setOllamaUrl(e.target.value); setOllamaStatus(null); }} placeholder="http://127.0.0.1:11434" />
                          <button type="button" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }} onClick={checkOllama} disabled={ollamaChecking}>
                            {ollamaChecking ? 'Checking…' : 'Test connection'}
                          </button>
                        </div>
                        {ollamaStatus && (
                          <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: ollamaStatus.ok ? 'var(--success)' : '#ef4444' }}>
                            {ollamaStatus.ok
                              ? (ollamaStatus.models.length ? `Connected. Installed models: ${ollamaStatus.models.join(', ')}` : 'Connected, but no models are installed yet. Run "ollama pull llama3.2".')
                              : ollamaStatus.error}
                          </p>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div>
                          <label className="settings-field-label">Chat model</label>
                          <input className="settings-field-input" list="ollama-models" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} placeholder="llama3.2" />
                        </div>
                        <div>
                          <label className="settings-field-label">Search (embedding) model</label>
                          <input className="settings-field-input" list="ollama-models" value={ollamaEmbedModel} onChange={(e) => setOllamaEmbedModel(e.target.value)} placeholder="nomic-embed-text" />
                        </div>
                        <datalist id="ollama-models">
                          {(ollamaStatus?.models || []).map((m) => <option key={m} value={m} />)}
                        </datalist>
                      </div>
                    </div>
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
