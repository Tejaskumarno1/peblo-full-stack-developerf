import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI } from '../api/index';
import { FileText, Archive, Sparkles, Tag, Globe } from 'lucide-react';
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

  if (loading) {
    return (
      <div className="dashboard-page">
        <Navigation activeTab="dashboard" />
        <div className="page-loader"><div className="spinner" /></div>
      </div>
    );
  }

  const data = insights || {};

  return (
    <div className="dashboard-page">
      <Navigation activeTab="dashboard" />

      <main className="dash-main">
        <header className="dash-page-header">
          <h1>
            Dashboard <span className="dash-title-muted">— Your Productivity Overview at a Glance</span>
          </h1>
        </header>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-primary">
              <FileText size={20} />
            </div>
            <span className="stat-value">{data.totalNotes || 0}</span>
            <span className="stat-label">Total Notes</span>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-muted">
              <Archive size={20} />
            </div>
            <span className="stat-value">{data.archivedNotes || 0}</span>
            <span className="stat-label">Archived</span>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-accent">
              <Sparkles size={20} />
            </div>
            <span className="stat-value">{data.aiUsage?.total || 0}</span>
            <span className="stat-label">AI Generations</span>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-primary">
              <Tag size={20} />
            </div>
            <span className="stat-value">{data.uniqueTagCount ?? data.topTags?.length ?? 0}</span>
            <span className="stat-label">Tags Used</span>
          </div>
          <div className="stat-card">
            <div className="stat-icon-wrapper glow-accent">
              <Globe size={20} />
            </div>
            <span className="stat-value">{data.publicNotes ?? 0}</span>
            <span className="stat-label">Public Notes</span>
          </div>
        </div>

        <div className="dash-mockup-grid">
          <section className="dash-card span-2 dash-card-dark">
            <h2 className="dash-card-title">Activity Heatmap</h2>
            <Heatmap
              activityHeatmap={data.activityHeatmap}
              streakStats={data.streakStats}
              editsThisMonth={data.editsThisMonth}
              layout="dark"
            />
          </section>

          <section className="dash-card">
            <h2 className="dash-card-title">AI Insights</h2>
            <DonutChart aiUsage={data.aiUsage} />
          </section>

          <section className="dash-card">
            <h2 className="dash-card-title">Top Tags</h2>
            <div className="dash-tags-cloud">
              {data.topTags?.length > 0 ? (
                data.topTags.map((tag) => (
                  <button
                    key={tag.name}
                    type="button"
                    className="dash-tag-pill"
                    onClick={() => navigate(`/notes?tag=${encodeURIComponent(tag.name)}`)}
                  >
                    {tag.name} <span>{tag.count}</span>
                  </button>
                ))
              ) : (
                <p className="dash-empty-text">No tags yet.</p>
              )}
            </div>
          </section>

          <section className="dash-card">
            <h2 className="dash-card-title">Recent AI Activity</h2>
            <RecentAiActivity items={data.recentAiActivity} />
          </section>

          <section className="dash-card dash-card-streak">
            <WritingStreak streakStats={data.streakStats} />
          </section>
        </div>
      </main>
    </div>
  );
}
