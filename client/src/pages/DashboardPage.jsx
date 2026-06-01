import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI } from '../api/index';
import { FileText, Archive, Sparkles, Tag, Globe, Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import Heatmap from '../components/Heatmap';
import DonutChart from '../components/DonutChart';
import WritingStreak from '../components/WritingStreak';
import RecentAiActivity from '../components/RecentAiActivity';
import '../styles/dashboard.css';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardAPI
      .insights()
      .then((res) => setInsights(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // The Dashboard will now load instantly and show skeleton states (if data is null) 
  // instead of blocking the entire UI with a massive full-screen spinner.

  const { user } = useAuth();
  const data = insights || {};
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <div className="dashboard-page">
      <Navigation activeTab="dashboard" />


      <main className="dash-main">
        {/* Desktop Page Header */}
        <header className="dash-page-header desktop-only">
          <h1>
            Dashboard <span className="dash-title-muted">— Your Productivity Overview at a Glance</span>
          </h1>
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
            <div className="stat-icon-wrapper glow-primary">
              <FileText size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.totalNotes || 0}</span>}</span>
              <span className="stat-label">notes</span>
            </div>
          </div>
          <div className="stat-card desktop-only">
            <div className="stat-icon-wrapper glow-muted">
              <Archive size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.archivedNotes || 0}</span>}</span>
              <span className="stat-label">Archived</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-accent">
              <Sparkles size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.aiUsage?.total || 0}</span>}</span>
              <span className="stat-label">AI gens</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-primary">
              <Tag size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.uniqueTagCount ?? data.topTags?.length ?? 0}</span>}</span>
              <span className="stat-label">tags</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-accent">
              <Globe size={20} />
            </div>
            <div className="stat-text-wrap">
              <span className="stat-value">{loading ? <div className="skeleton-block" style={{width:'40px', height:'32px', marginBottom:'4px'}}></div> : <span className="data-morph-enter delay-1" style={{display:'inline-block'}}>{data.publicNotes ?? 0}</span>}</span>
              <span className="stat-label">public</span>
            </div>
          </div>
        </div>



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

          <section className="dash-card">
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

          <section className="dash-card">
            <h2 className="dash-card-title">Recent AI Activity</h2>
            {loading ? (
               <div style={{display: 'flex', flexDirection: 'column', gap: '16px', padding: '10px 0'}}>
                 {['85%', '65%', '75%'].map((w, i) => (
                   <div key={i} style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
                     <div className="skeleton-circle" style={{width:'8px', height:'8px'}} />
                     <div className="skeleton-block" style={{width: w, height:'14px'}} />
                   </div>
                 ))}
               </div>
            ) : <div className="data-morph-enter delay-5"><RecentAiActivity items={data.recentAiActivity} /></div>}
          </section>

          <section className="dash-card dash-card-streak">
            {loading ? (
              <div style={{padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%'}}>
                 <div style={{display: 'flex', justifyContent: 'space-between'}}>
                   <div className="skeleton-block" style={{width:'100px', height:'20px'}}></div>
                   <div className="skeleton-block" style={{width:'24px', height:'24px', borderRadius:'50%'}}></div>
                 </div>
                 <div className="skeleton-block" style={{width:'40px', height:'32px'}}></div>
                 <div style={{marginTop: 'auto'}}>
                   <div className="skeleton-block" style={{width:'100%', height:'12px', borderRadius:'10px'}}></div>
                 </div>
              </div>
            ) : <div className="data-morph-enter delay-6" style={{height:'100%'}}><WritingStreak streakStats={data.streakStats} /></div>}
          </section>
        </div>
      </main>
    </div>
  );
}
