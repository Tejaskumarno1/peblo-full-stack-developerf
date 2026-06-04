import { useState, useMemo } from 'react';
import { Calendar, Flame, TrendingUp } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getIntensity(count) {
  if (count <= 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

function formatTooltip(day) {
  if (!day?.date) return '';
  const date = new Date(day.date + 'T12:00:00');
  const label = date.toLocaleDateString('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (day.total === 0) return `${label} — No activity`;
  const parts = [`${label}`, `${day.total} edit${day.total === 1 ? '' : 's'}`];
  if (day.created > 0) parts.push(`${day.created} created`);
  if (day.updated > 0) parts.push(`${day.updated} updated`);
  return parts.join('\n');
}

function getMonthsBlocks(weeks) {
  if (!weeks || weeks.length === 0) return [];
  const monthsMap = new Map();

  weeks.forEach(week => {
    week.forEach((day, di) => {
      if (!day || !day.date) return;
      const dateObj = new Date(day.date + 'T12:00:00');
      const key = `${dateObj.getFullYear()}-${dateObj.getMonth()}`;
      
      if (!monthsMap.has(key)) {
        monthsMap.set(key, {
          label: MONTHS[dateObj.getMonth()],
          key,
          weeks: []
        });
      }
      
      const monthObj = monthsMap.get(key);
      
      // A new week is pushed if it's the start of the month or Sunday
      if (monthObj.weeks.length === 0 || di === 0) {
        monthObj.weeks.push(Array(7).fill(null));
      }
      
      const currentWeek = monthObj.weeks[monthObj.weeks.length - 1];
      currentWeek[di] = day;
    });
  });
  
  return Array.from(monthsMap.values());
}

export default function Heatmap({ activityHeatmap, streakStats, editsThisMonth, layout = 'default' }) {
  const [tooltip, setTooltip] = useState(null);
  const weeks = activityHeatmap?.length ? activityHeatmap : [];
  
  // We reverse so the newest month is rendered first in DOM, 
  // which works with flex-direction: row-reverse to gracefully overflow oldest months
  const monthBlocks = useMemo(() => {
    return getMonthsBlocks(weeks).reverse();
  }, [weeks]);

  const stats = streakStats || { current: 0, mostActiveDay: '—' };
  const streakLabel = stats.current === 1 ? '1 Day' : `${stats.current} Days`;

  return (
    <div className={`heatmap-layout ${layout}`}>
      <div className="heatmap-inline-stats">
        <div className="heatmap-inline-stat">
          <span className="heatmap-inline-icon primary">
            <Calendar size={15} />
          </span>
          <div>
            <span className="heatmap-inline-value">{stats.mostActiveDay}</span>
            <span className="heatmap-inline-label">Busiest Day</span>
          </div>
        </div>
        <div className="heatmap-inline-stat">
          <span className="heatmap-inline-icon accent">
            <Flame size={15} />
          </span>
          <div>
            <span className="heatmap-inline-value">{streakLabel}</span>
            <span className="heatmap-inline-label">Current Streak</span>
          </div>
        </div>
        <div className="heatmap-inline-stat">
          <span className="heatmap-inline-icon muted">
            <TrendingUp size={15} />
          </span>
          <div>
            <span className="heatmap-inline-value">{editsThisMonth ?? 0}</span>
            <span className="heatmap-inline-label">Edits This Month</span>
          </div>
        </div>
      </div>

      <div className="heatmap-container-new">
        <div className="heatmap-day-labels-new">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
            <span key={i} className="heatmap-day-label">{d}</span>
          ))}
        </div>

        <div className="heatmap-blocks-wrapper">
          {monthBlocks.map((month) => (
            <div key={month.key} className="heatmap-month-block">
              <div className="heatmap-month-name">{month.label}</div>
              <div className="heatmap-month-grid">
                {month.weeks.map((week, wi) => (
                  <div key={wi} className="heatmap-col">
                    {week.map((day, di) => {
                      if (!day) {
                        return <div key={di} className="heatmap-cell level-0" style={{ visibility: 'hidden' }} />;
                      }
                      
                      const intensity = getIntensity(day.total ?? 0);
                      return (
                        <div
                          key={di}
                          className={`heatmap-cell level-${intensity}`}
                          onMouseEnter={(e) => {
                            if (!day?.date) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTooltip({
                              text: formatTooltip(day),
                              x: rect.left + rect.width / 2,
                              y: rect.top,
                            });
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {tooltip && (
        <div className="heatmap-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text.split('\n').map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
      )}

      <div className="heatmap-legend">
        <span>Less</span>
        <div className="heatmap-cell level-0" />
        <div className="heatmap-cell level-1" />
        <div className="heatmap-cell level-2" />
        <div className="heatmap-cell level-3" />
        <div className="heatmap-cell level-4" />
        <span>More</span>
      </div>
    </div>
  );
}
