import { Flame } from 'lucide-react';

export default function WritingStreak({ streakStats }) {
  const streak = streakStats || { current: 0, longest: 0, activeDays: 0, recentActiveDates: [] };
  const progress = Math.min(100, (streak.current / 7) * 100);
  const dayLabel = streak.current === 1 ? '1 Day' : `${streak.current} Days`;

  return (
    <div className="writing-streak-container dash-streak-card">
      <div className="streak-glow" aria-hidden />

      <div className="streak-header">
        <h3>
          <Flame size={20} className="streak-flame-icon" /> Writing Streak
        </h3>
        <span className="streak-current">{dayLabel}</span>
      </div>

      <div className="streak-progress">
        <div className="progress-labels">
          <span>Current Progress</span>
          <span>Next Milestone: 7 days</span>
        </div>
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {streak.recentActiveDates?.length > 0 && (
        <div className="streak-timeline">
          {streak.recentActiveDates.map((d) => (
            <span key={d.date} className="streak-timeline-dot" title={d.date}>
              {d.label}
            </span>
          ))}
        </div>
      )}

      <p className="streak-motivation">
        {streak.current > 0
          ? "You're on a roll! Keep writing to reach your next milestone."
          : 'Start writing today to build your streak!'}
      </p>
    </div>
  );
}
