import React, { useState, memo } from 'react';
import { useAuth } from '../context/AuthContext';
import { aiAPI, transferAPI, authAPI } from '../api';
import { setToken } from '../api/token';
import { ROUTING_CHOICES, normalizeRouting } from '../utils/aiRouting';
import { unreadableKeyMessage } from '../utils/keyStatus';
import { authHeaders, signOutIfRejected } from '../api/token';
import { useQueryClient } from '@tanstack/react-query';
import { User, Settings, Shield, Palette, X, Monitor, Moon, Sun, AlertTriangle, LogOut, Key, Cpu } from 'lucide-react';

function SettingsModal({ onClose, initialTab = 'profile' }) {
  const { user, updateProfile, logout, theme, setTheme, uiStyle, setUiStyle, settings, updateSettings } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab === 'security' ? 'data' : initialTab);
  
  // Profile specific states (saved to user obj in DB ideally, mocked here)
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail] = useState(user?.email || '');
  const [profileJob, setProfileJob] = useState(settings?.jobTitle || '');
  const [profileBio, setProfileBio] = useState(settings?.bio || '');

  const [openAiKey, setOpenAiKey] = useState(settings?.openAiKey || '');
  const [geminiKey, setGeminiKey] = useState(settings?.geminiKey || '');
  const initialRouting = normalizeRouting(settings?.defaultAiModel);
  const [routing, setRouting] = useState(initialRouting);
  const [ollamaEnabled, setOllamaEnabled] = useState(settings?.ollamaEnabled || false);
  const [ollamaUrl, setOllamaUrl] = useState(settings?.ollamaUrl || 'http://127.0.0.1:11434');
  const [ollamaModel, setOllamaModel] = useState(settings?.ollamaModel || 'llama3.2');
  const [ollamaEmbedModel, setOllamaEmbedModel] = useState(settings?.ollamaEmbedModel || 'nomic-embed-text');
  const [ollamaStatus, setOllamaStatus] = useState(null); // { ok, models, error }
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { ok, text }

  // The export is a signed-in download, so it can't be a plain link: fetch it with the token, then save it.
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = signOutIfRejected(await fetch(`${import.meta.env.VITE_API_URL || '/api'}/export`, { headers: authHeaders() }));
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'peblo-notes.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setImportResult({ ok: false, text: 'Could not export your notes. Try again.' });
    } finally {
      setExporting(false);
    }
  };

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

  const [saveError, setSaveError] = useState('');
  const [settingError, setSettingError] = useState('');
  // Single setting changed on the spot (a select or toggle): tell the person if it did not reach their account.
  const saveSetting = async (patch) => {
    setSettingError('');
    const ok = await updateSettings(patch);
    if (!ok) setSettingError('Saved on this computer only. Could not reach your account, so it will not follow you to other devices.');
  };

  const handleSaveApiKeys = async (e) => {
    e.preventDefault();
    setSaveError('');
    const next = { openAiKey, geminiKey, ollamaEnabled, ollamaUrl: ollamaUrl.trim(), ollamaModel: ollamaModel.trim(), ollamaEmbedModel: ollamaEmbedModel.trim() };
    // Only touch the routing choice when it was changed here, so saving a key never overwrites a choice made on Your AI.
    if (routing !== initialRouting) next.defaultAiModel = routing;
    const ok = await updateSettings(next);
    if (ok) {
      setSaveSuccess('AI Settings saved successfully!');
      setTimeout(() => setSaveSuccess(''), 3000);
    } else {
      setSaveSuccess('');
      setSaveError('Could not save. Check your connection and try again.');
    }
  };

  const [saveSuccess, setSaveSuccess] = useState('');

  // ── Account security ──
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 8) return setPwMsg({ ok: false, text: 'The new password must be at least 8 characters.' });
    if (pw.next !== pw.again) return setPwMsg({ ok: false, text: 'The two new passwords do not match.' });
    setPwBusy(true);
    setPwMsg(null);
    try {
      const { data } = await authAPI.changePassword({ currentPassword: pw.current, newPassword: pw.next });
      setToken(data.token); // this device stays signed in; every other device is signed out
      setPw({ current: '', next: '', again: '' });
      setPwMsg({ ok: true, text: 'Password changed. Your other devices were signed out.' });
    } catch (err) {
      setPwMsg({ ok: false, text: err.response?.data?.error || 'Could not change the password. Try again.' });
    } finally {
      setPwBusy(false);
    }
  };
  const handleLogoutAll = async () => {
    try { await authAPI.logoutAll(); } catch { /* signing out here still happens */ }
    onClose();
    logout();
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaveError('');
    // The email is read-only, so only the name goes up with the profile fields.
    const okName = await updateProfile({ name: profileName });
    const okRest = await updateSettings({ jobTitle: profileJob, bio: profileBio });
    if (okName && okRest) {
      setSaveSuccess('Profile saved successfully!');
      setTimeout(() => setSaveSuccess(''), 3000);
    } else {
      setSaveSuccess('');
      setSaveError('Could not save your profile. Check your connection and try again.');
    }
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

          <h3 style={{ marginTop: '1.5rem' }}>Account</h3>
          <button
            className="settings-tab-btn"
            onClick={() => { onClose(); logout(); }}
          >
            <LogOut size={18} /> Sign out
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
                    <label className="settings-field-label">Time zone</label>
                    <p className="settings-field-input" style={{ margin: 0, opacity: 0.8 }}>{(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' '); } catch { return 'this computer'; } })()}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Peblo follows this computer's time zone for "today", deadlines and reminders.</p>
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
                  {saveError && <span role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: 500 }}>{saveError}</span>}
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
                    { id: 'studio', name: 'Studio', desc: 'Sidebar and calm serif headings', tags: ['Everyday', 'Writers'], tip: 'For most people. A familiar sidebar with lists and a big writing area, so there is nothing new to learn.' },
                    { id: 'console', name: 'Console', desc: 'Keyboard-first, command bar, dense', tags: ['Developers', 'Power users'], tip: 'For people who live on the keyboard. Dense lists and a command bar let you do everything without the mouse.' },
                    { id: 'soft', name: 'Soft Studio', desc: 'Friendly tiles and a floating dock', tags: ['Beginners', 'Visual'], tip: 'For people who like light, friendly screens. Big tiles show your day at a glance, with less to read.' },
                    { id: 'river', name: 'River', desc: 'Your day as one timeline, past to future', tags: ['Meetings', 'Planners'], tip: 'For days run by meetings and deadlines. Notes, meetings and tasks sit on one timeline where they happened, and Peblo finds promises made in meetings.' },
                    { id: 'orbit', name: 'Orbit', desc: 'A map of what you know, built for studying', tags: ['Students', 'Exams'], tip: 'For students preparing for exams. Topics become a map with mastery scores, and quizzes come from your own notes.' },
                  ].map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={uiStyle === o.id}
                      aria-describedby={`style-tip-${o.id}`}
                      className={`style-card${uiStyle === o.id ? ' active' : ''}`}
                      onClick={() => setUiStyle(o.id)}
                    >
                      <span className={`style-preview ${o.id}`} aria-hidden="true">
                        <i className="a" /><i className="b" /><i className="c" /><i className="d" /><i className="e" />
                      </span>
                      <span id={`style-tip-${o.id}`} className="style-tip" role="tooltip">{o.tip}</span>
                      <span className="style-name">{o.name}</span>
                      <span className="style-desc">{o.desc}</span>
                      <span className="style-tags">{o.tags.map((t) => <span key={t}>{t}</span>)}</span>
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
                    onChange={(e) => saveSetting({ compactMode: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Editor Preferences</h2>

              <div className="settings-field-group">
                <label className="settings-field-label" htmlFor="pref-font">Editor text size</label>
                <select
                  id="pref-font"
                  className="settings-field-input"
                  value={settings?.fontSize || 'medium'}
                  onChange={(e) => saveSetting({ fontSize: e.target.value })}
                >
                  <option value="small">Small (13px)</option>
                  <option value="medium">Default (your style's size)</option>
                  <option value="large">Large (18px)</option>
                </select>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  Changes the size of the text inside the note editor, in every style.
                </p>
              </div>

              {settingError && <p role="alert" style={{ color: '#ef4444', fontWeight: 500 }}>{settingError}</p>}

              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '1.5rem' }}>
                Notes save themselves a moment after you stop typing. Peblo does not send emails or push notifications, so there are no notification settings.
              </p>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">Your Data</h2>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Monitor size={16} /> Saved to your account
                  </h4>
                  <p>
                    Your notes, tasks and settings belong to your account{user?.email ? <> (<strong>{user.email}</strong>)</> : null} and
                    are saved in Peblo's database, so they follow you to any device you sign in on. Other people's accounts
                    can't see them. The export below gives you a copy any time.
                  </p>
                </div>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Key size={16} /> Your AI keys are yours
                  </h4>
                  <p>
                    API keys you add under AI Providers are saved with your account only. They are only sent to
                    OpenAI or Google when you use an AI feature.
                  </p>
                </div>
              </div>

              <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', fontSize: '1.05rem' }}>Password &amp; sessions</h3>
              <form onSubmit={handleChangePassword} className="settings-toggle-row" style={{ display: 'block' }}>
                <div className="settings-toggle-info" style={{ marginBottom: '0.75rem' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Shield size={16} /> Change password</h4>
                  <p>Changing it signs out every other device. There is no email reset yet, so keep your password somewhere safe.</p>
                </div>
                <div className="settings-grid-2">
                  <div className="settings-field-group">
                    <label className="settings-field-label" htmlFor="pw-current">Current password</label>
                    <input id="pw-current" type="password" autoComplete="current-password" className="settings-field-input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
                  </div>
                  <div className="settings-field-group" />
                  <div className="settings-field-group">
                    <label className="settings-field-label" htmlFor="pw-new">New password</label>
                    <input id="pw-new" type="password" autoComplete="new-password" minLength={8} className="settings-field-input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
                  </div>
                  <div className="settings-field-group">
                    <label className="settings-field-label" htmlFor="pw-again">Repeat new password</label>
                    <input id="pw-again" type="password" autoComplete="new-password" minLength={8} className="settings-field-input" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required />
                  </div>
                </div>
                {pwMsg && <p role="status" style={{ margin: '0.5rem 0', fontWeight: 500, color: pwMsg.ok ? 'var(--success)' : '#ef4444' }}>{pwMsg.text}</p>}
                <button type="submit" className="btn btn-primary" disabled={pwBusy}>{pwBusy ? 'Changing…' : 'Change password'}</button>
              </form>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><LogOut size={16} /> Sign out everywhere</h4>
                  <p>Ends your session on every device, including this one. Use it if you lost a device or signed in on a shared computer.</p>
                </div>
                <button type="button" className="btn btn-outline" onClick={handleLogoutAll} style={{ whiteSpace: 'nowrap' }}>Sign out everywhere</button>
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
                <button type="button" className="btn btn-outline" onClick={handleExport} disabled={exporting} style={{ whiteSpace: 'nowrap' }}>{exporting ? 'Preparing…' : 'Export .zip'}</button>
              </div>
            </div>
          )}

          {activeTab === 'ai-providers' && (
            <div className="settings-section fade-in">
              <h2 className="settings-section-title">AI Providers & Models</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Use your own OpenAI or Gemini key, or run AI completely on this computer with Ollama. Keys are stored encrypted in your Peblo account and only sent to the provider you use.
              </p>

              <form onSubmit={handleSaveApiKeys}>
                <div className="settings-field-group" style={{ background: 'var(--bg-elevated)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-strong)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                  <label className="settings-field-label" id="routing-label" style={{ color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: '0.75rem' }}>Where may your AI run?</label>
                  <div role="radiogroup" aria-labelledby="routing-label" style={{ display: 'grid', gap: '0.5rem' }}>
                    {ROUTING_CHOICES.map((o) => (
                      <label key={o.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)', cursor: 'pointer', background: routing === o.id ? 'var(--bg-hover)' : 'transparent' }}>
                        <input type="radio" name="settings-routing" checked={routing === o.id} onChange={() => setRouting(o.id)} />
                        <span><strong style={{ fontSize: '0.9rem' }}>{o.title}</strong><br /><span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{o.desc}</span></span>
                      </label>
                    ))}
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                    The same choice appears under Your AI, in every style.
                  </p>
                </div>


                {unreadableKeyMessage(settings) && <p role="alert" style={{ color: '#ef4444', fontWeight: 500 }}>{unreadableKeyMessage(settings)}</p>}
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
                  {saveError && <span role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: 500 }}>{saveError}</span>}
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
