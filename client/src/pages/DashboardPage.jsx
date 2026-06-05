import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardAPI, todosAPI } from '../api/index';
import { FileText, Archive, Sparkles, Tag, Globe, Bell, Calendar, Sunrise, Sun, Moon, AlertTriangle, ChevronRight, PartyPopper } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import Heatmap from '../components/Heatmap';
import DonutChart from '../components/DonutChart';
import '../styles/dashboard.css';

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: insightsData, isLoading: loadingInsights } = useQuery({
    queryKey: ['insights'],
    queryFn: () => dashboardAPI.insights().then(res => res.data),
    staleTime: 60000
  });

  const { data: todayDataRes, isLoading: loadingToday } = useQuery({
    queryKey: ['todayTasks'],
    queryFn: () => todosAPI.getToday().then(res => res.data),
    staleTime: 60000
  });

  const { data: briefingData, isLoading: loadingBriefing } = useQuery({
    queryKey: ['dailyBriefing'],
    queryFn: () => dashboardAPI.dailyBriefing().then(res => res.data),
    staleTime: 60000
  });

  const { data: weeklyReportData, isLoading: loadingWeekly } = useQuery({
    queryKey: ['weeklyReport'],
    queryFn: () => dashboardAPI.weeklyReport().then(res => res.data),
    staleTime: 60000
  });

  const loading = loadingInsights || loadingToday || loadingBriefing || loadingWeekly;
  const insights = insightsData;
  const todayData = todayDataRes || { todayTasks: [], overdueTasks: [], upcomingTasks: [] };
  const briefing = briefingData;
  const weeklyReport = weeklyReportData;

  const toggleTaskMutation = useMutation({
    mutationFn: (task) => dashboardAPI.toggleTask({ id: task.id, completed: !task.completed }),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: ['todayTasks'] });
      const previousTodayData = queryClient.getQueryData(['todayTasks']);
      
      queryClient.setQueryData(['todayTasks'], old => {
        if (!old) return old;
        const toggleList = (list) => list.map(t => t.id === task.id ? { ...t, completed: !t.completed } : t);
        return {
          ...old,
          todayTasks: toggleList(old.todayTasks),
          overdueTasks: toggleList(old.overdueTasks),
          upcomingTasks: toggleList(old.upcomingTasks)
        };
      });

      return { previousTodayData };
    },
    onError: (err, newTask, context) => {
      queryClient.setQueryData(['todayTasks'], context.previousTodayData);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['todayTasks'] });
    }
  });

  const handleToggleTask = (task) => {
    toggleTaskMutation.mutate(task);
  };

  const { user } = useAuth();
  const data = insights || {};
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  const todaysFocusContent = (
    <>
      <div className="dash-card-title-row" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--dash-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h2 className="dash-card-title" style={{marginBottom: 0}}>Today's Focus</h2>
          {!loading && todayData.todayTasks?.length > 0 && (
            <span style={{ background: 'var(--dash-primary-dim)', color: 'var(--dash-primary)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700 }}>
              {todayData.todayTasks.length}
            </span>
          )}
        </div>
        <button className="dash-focus-link-pill" onClick={() => navigate('/todolist')}>
          All tasks <ChevronRight size={14} />
        </button>
      </div>
      <div className="dash-todo-list" style={{ paddingTop: '0.75rem' }}>
        {loading ? (
          <div style={{display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 0'}}>
            {[1, 2, 3].map((w, i) => (
              <div key={i} style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
                <div className="skeleton-block" style={{width:'20px', height:'20px', borderRadius:'6px'}} />
                <div className="skeleton-block" style={{width: '75%', height:'16px'}} />
              </div>
            ))}
          </div>
        ) : (
          <div className="data-morph-enter delay-5" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
            {/* Overdue Alert */}
            {todayData.overdueTasks.length > 0 && (
              <div className="overdue-alert-pulse">
                <AlertTriangle size={16} />
                <span style={{ flex: 1 }}>{todayData.overdueTasks.length} overdue task{todayData.overdueTasks.length > 1 ? 's' : ''}</span>
              </div>
            )}

            {/* Today's Tasks */}
            {todayData.todayTasks.length === 0 && todayData.overdueTasks.length === 0 ? (
              todayData.upcomingTasks.length > 0 ? (
                <div>
                  <p className="dash-empty-text" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>Nothing due today. Here’s what’s coming up:</p>
                  {todayData.upcomingTasks.slice(0, 3).map(task => (
                    <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', fontSize: '0.85rem', color: 'var(--dash-text-secondary)' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: task.priority === 'high' ? '#ef4444' : task.priority === 'low' ? '#22c55e' : '#f59e0b' }}></span>
                      <span style={{ flex: 1 }}>{task.text}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--dash-text-muted)' }}>
                        {new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                   <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem', color: 'var(--dash-primary)' }}>
                     <PartyPopper size={32} />
                   </div>
                   <p className="dash-empty-text">All caught up! <br/><span style={{cursor: 'pointer', color: 'var(--dash-primary)', fontWeight: 600}} onClick={() => navigate('/todolist')}>Add a task →</span></p>
                </div>
              )
            ) : (
              [...todayData.overdueTasks, ...todayData.todayTasks].map((task) => (
                <label key={task.id} className={`dash-todo-item premium-todo-item ${task.completed ? 'completed' : ''}`} style={{ 
                  borderLeft: `4px solid ${task.priority === 'high' ? '#ef4444' : task.priority === 'low' ? '#22c55e' : '#f59e0b'}` 
                }}>
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => handleToggleTask(task)}
                    className="dash-todo-checkbox mobile-large-checkbox"
                  />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                    <span className="dash-todo-text">{task.text}</span>
                    {task.priority === 'high' && <span className="premium-todo-urgent-badge">Urgent</span>}
                  </div>
                  {task.note && <div className="premium-todo-note-icon"><FileText size={14} /></div>}
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );

  const aiInsightsContent = (
    <>
      <h2 className="dash-card-title">AI Insights</h2>
      {loading ? (
        <div style={{display: 'flex', gap: '24px', alignItems: 'center', height: '180px'}}>
          <div className="skeleton-circle" style={{width:'120px', height:'120px', flexShrink:0}}></div>
          <div style={{display: 'flex', flexDirection: 'column', gap: '12px', width: '100%'}}>
             <div className="skeleton-block" style={{width:'80%', height:'12px'}}></div>
             <div className="skeleton-block" style={{width:'60%', height:'12px'}}></div>
             <div className="skeleton-block" style={{width:'75%', height:'12px'}}></div>
          </div>
        </div>
      ) : <div className="data-morph-enter delay-3"><DonutChart aiUsage={data.aiUsage} /></div>}
    </>
  );

  const dailyBriefingContent = (
    <>
      <h2 className="dash-card-title glow-amber" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Sunrise size={18} /> Daily Briefing
      </h2>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="skeleton-block" style={{ width: '100%', height: '16px' }} />
          <div className="skeleton-block" style={{ width: '80%', height: '16px' }} />
          <div className="skeleton-block" style={{ width: '90%', height: '16px' }} />
        </div>
      ) : briefing ? (
        <div className="data-morph-enter delay-2" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--dash-text-secondary)', lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, color: 'var(--dash-text)' }}>{briefing.greeting}</span>. You have <strong>{briefing.stats.dueToday}</strong> tasks due today and <strong>{briefing.stats.overdue}</strong> overdue tasks. 
            Yesterday you completed {briefing.stats.completedYesterday} tasks.
          </p>
          
          {briefing.recentNotes.length > 0 && (
            <div style={{ fontSize: '0.85rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--dash-text-muted)' }}>Recent notes:</span>
              <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: 'var(--dash-text-secondary)' }}>
                {briefing.recentNotes.slice(0, 2).map(note => (
                  <li key={note.id}><a style={{ color: 'inherit', textDecoration: 'none' }} href={`/notes/${note.id}`}>{note.title || 'Untitled'}</a></li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ padding: '10px 14px', background: 'var(--dash-bg-inset)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--dash-text-secondary)', fontStyle: 'italic', borderLeft: '3px solid var(--dash-primary)' }}>
            {briefing.tip}
          </div>
        </div>
      ) : (
        <p className="dash-empty-text">No briefing available today.</p>
      )}
    </>
  );

  const weeklyReportContent = (
    <>
      <h2 className="dash-card-title glow-purple" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Calendar size={18} /> Weekly Report
      </h2>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="skeleton-block" style={{ width: '100%', height: '16px' }} />
          <div className="skeleton-block" style={{ width: '100%', height: '16px' }} />
        </div>
      ) : weeklyReport ? (
        <div className="data-morph-enter delay-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <span style={{ fontSize: '0.85rem', color: 'var(--dash-text-secondary)' }}>Tasks Completed</span>
             <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--dash-primary)' }}>{weeklyReport.stats.tasksCompleted}</span>
           </div>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <span style={{ fontSize: '0.85rem', color: 'var(--dash-text-secondary)' }}>Completion Rate</span>
             <span style={{ fontSize: '1.2rem', fontWeight: 600, color: '#22c55e' }}>{weeklyReport.stats.completionRate}%</span>
           </div>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <span style={{ fontSize: '0.85rem', color: 'var(--dash-text-secondary)' }}>Notes Created</span>
             <span style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f59e0b' }}>{weeklyReport.stats.notesCreated}</span>
           </div>
        </div>
      ) : (
        <p className="dash-empty-text">Not enough data for a weekly report.</p>
      )}
    </>
  );

  return (
    <div className="dashboard-page">
      <Navigation activeTab="dashboard" />


      <main className="dash-main">
        {/* Desktop Page Header */}
        <header className="dash-page-header desktop-only premium-header-card">
          <div className="dash-greeting-content">
            <span className="dash-date-badge">
              <Calendar size={14} className="dash-date-icon" />
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            <h1 className="dash-greeting-h1">
              {(() => {
                const hour = new Date().getHours();
                if (hour < 12) return <>Good morning <Sunrise className="greeting-icon text-orange-400" size={32} strokeWidth={2.5} /></>;
                if (hour < 18) return <>Good afternoon <Sun className="greeting-icon text-yellow-500" size={32} strokeWidth={2.5} /></>;
                return <>Good evening <Moon className="greeting-icon text-indigo-400" size={32} strokeWidth={2.5} /></>;
              })()}, <span className="greeting-name">{user?.name?.split(' ')[0] || 'User'}</span>
            </h1>
            <p className="dash-header-subtitle">Here's your productivity overview at a glance.</p>
          </div>
        </header>

        {/* Organic Mobile Greeting */}
        <header className="mobile-organic-header mobile-only">
          <div className="mobile-greeting">
            <span className="mobile-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            <h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {user?.name?.split(' ')[0] || 'User'}</h1>
          </div>
          <div className="mobile-avatar-circle" onClick={() => document.querySelector('.profile-trigger')?.click()}>
            {initial}
          </div>
        </header>

        {/* Unified Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-purple">
              <FileText size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.totalNotes || 0}</span>}</span>
              <span className="stat-label">notes</span>
            </div>
          </div>
          <div className="stat-card desktop-only">
            <div className="stat-icon-wrapper glow-slate">
              <Archive size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.archivedNotes || 0}</span>}</span>
              <span className="stat-label">Archived</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-amber">
              <Sparkles size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.aiUsage?.total || 0}</span>}</span>
              <span className="stat-label">AI gens</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-teal">
              <Tag size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.uniqueTagCount ?? data.topTags?.length ?? 0}</span>}</span>
              <span className="stat-label">tags</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-emerald">
              <Globe size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.publicNotes ?? 0}</span>}</span>
              <span className="stat-label">public</span>
            </div>
          </div>
        </div>

        {/* Mobile-only Today's Focus */}
        <section className="dash-card mobile-only" style={{ marginBottom: "1.5rem", flexDirection: 'column' }}>
          {todaysFocusContent}
        </section>

        <div className="dash-mockup-grid">
          <section className="dash-card span-2 dash-card-dark">
            <h2 className="dash-card-title">Activity Heatmap</h2>
            {loading ? (
              <div style={{display: 'flex', gap: '3px', flexWrap: 'wrap', opacity: 0.7, padding: '10px 0', height: '140px', alignContent: 'flex-start'}}>
                {Array.from({length: 120}).map((_, i) => <div key={i} className="skeleton-block" style={{width:'12px', height:'12px', borderRadius:'3px'}} />)}
              </div>
            ) : (
              <div className="data-morph-enter delay-2">
                <Heatmap
                  activityHeatmap={data.activityHeatmap}
                  streakStats={data.streakStats}
                  editsThisMonth={data.editsThisMonth}
                  layout="dark"
                />
              </div>
            )}
          </section>

          <section className="dash-card desktop-only">
            {todaysFocusContent}
          </section>

          <section className="dash-card">
            {aiInsightsContent}
          </section>

          <section className="dash-card">
            {dailyBriefingContent}
          </section>

          <section className="dash-card">
            {weeklyReportContent}
          </section>

          <section className="dash-card">
            <h2 className="dash-card-title">Top Tags</h2>
            <div className="dash-tags-cloud">
              {loading ? (
                ['70px', '90px', '60px', '85px', '65px', '100px'].map((w, i) => (
                  <div key={i} className="skeleton-block" style={{width: w, height: '28px', borderRadius: '100px'}} />
                ))
              ) : data.topTags?.length > 0 ? (
                <div className="data-morph-enter delay-4" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {data.topTags.map((tag) => (
                    <button
                      key={tag.name}
                      type="button"
                      className="dash-tag-pill"
                      onClick={() => navigate(`/notes?tag=${encodeURIComponent(tag.name)}`)}
                    >
                      {tag.name} <span>{tag.count}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="dash-empty-text">No tags yet.</p>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
