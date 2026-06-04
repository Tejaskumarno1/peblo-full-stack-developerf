import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Calendar, ListTodo, ChevronRight, LayoutGrid } from 'lucide-react';
import Navigation from '../components/Navigation';
import { useAuth } from '../context/AuthContext';
import '../styles/dashboard.css';
import '../styles/workspace-hub.css';

export default function WorkspaceHubPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <div className="dashboard-page hub-layout">
      <Navigation activeTab="workspace" />
      
      <main className="hub-main">
        <div className="hub-container fade-in">
          
          {/* Mobile Only Organic Header to fill the void */}
          <header className="mobile-organic-header mobile-only" style={{ marginBottom: '2rem' }}>
            <div className="mobile-greeting">
              <span className="mobile-date" style={{ color: 'var(--primary)' }}>Productivity Hub</span>
              <h1>Your Workspace</h1>
            </div>
            <div className="mobile-avatar-circle" onClick={() => document.querySelector('.profile-trigger')?.click()}>
              {initial}
            </div>
          </header>

          <div className="hub-header desktop-only">
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', marginBottom: '1rem', color: 'var(--text-primary)' }}>
              <LayoutGrid size={32} />
            </div>
            <h1 className="hub-title">Workspace</h1>
            <p className="hub-subtitle">Select a tool to get started.</p>
          </div>

          <div className="hub-grid delay-1">
            
            {/* Notes Card */}
            <button 
              className="hub-card" 
              onClick={() => navigate('/notes')}
              aria-label="Open Notes"
            >
              <div className="hub-card-icon" style={{ color: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.1)' }}>
                <FileText size={24} />
              </div>
              <div className="hub-card-content">
                <h3>Notes</h3>
                <p>Create and edit markdown documents with AI assistance.</p>
              </div>
              <div className="hub-card-action">
                <ChevronRight size={20} />
              </div>
            </button>

            {/* Calendar Card */}
            <button 
              className="hub-card" 
              onClick={() => navigate('/calendar')}
              aria-label="Open Calendar"
            >
              <div className="hub-card-icon" style={{ color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
                <Calendar size={24} />
              </div>
              <div className="hub-card-content">
                <h3>Calendar</h3>
                <p>Track schedules, deadlines, and upcoming events.</p>
              </div>
              <div className="hub-card-action">
                <ChevronRight size={20} />
              </div>
            </button>

            {/* To-Do List Card */}
            <button 
              className="hub-card" 
              onClick={() => navigate('/todolist')}
              aria-label="Open To-Do List"
            >
              <div className="hub-card-icon" style={{ color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                <ListTodo size={24} />
              </div>
              <div className="hub-card-content">
                <h3>To-Do List</h3>
                <p>Organize daily tasks and stay on top of priorities.</p>
              </div>
              <div className="hub-card-action">
                <ChevronRight size={20} />
              </div>
            </button>

          </div>
        </div>
      </main>
    </div>
  );
}
