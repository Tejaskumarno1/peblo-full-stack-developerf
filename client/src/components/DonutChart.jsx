export default function DonutChart({ aiUsage }) {
  if (!aiUsage || !aiUsage.byType || Object.keys(aiUsage.byType).length === 0) {
    return <p className="dash-empty-text">No AI features used yet.</p>;
  }

  const data = aiUsage.byType;
  const total = Object.values(data).reduce((acc, val) => acc + val, 0);
  const size = 180;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let currentOffset = 0;

  const colors = {
    summary: '#4f46e5',
    action_items: '#0d9488',
    title: '#4338ca',
    chat: '#8b5cf6',
  };

  const labels = {
    summary: 'Summaries',
    action_items: 'Action Items',
    title: 'Titles',
    chat: 'AI Chat',
  };

  return (
    <div className="donut-chart-container">
      <div className="donut-svg-wrapper" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth={strokeWidth}
          />
          {Object.entries(data).map(([key, value]) => {
            const percentage = value / total;
            const dashArray = `${percentage * circumference} ${circumference}`;
            const dashOffset = -currentOffset * circumference;
            currentOffset += percentage;
            return (
              <circle
                key={key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="transparent"
                stroke={colors[key] || '#4f46e5'}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
          })}
        </svg>
        <div className="donut-center">
          <span className="donut-total">{total}</span>
          <span className="donut-label">Total</span>
        </div>
      </div>
      <div className="donut-legend donut-legend-table">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="legend-item">
            <span className="legend-dot" style={{ backgroundColor: colors[key] || '#4f46e5' }} />
            <span className="legend-text">{labels[key] || key}</span>
            <span className="legend-count">{value}</span>
            <span className="legend-pct">{Math.round((value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
