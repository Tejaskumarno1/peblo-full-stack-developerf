export default function RecentAiActivity({ items }) {
  if (!items?.length) {
    return <p className="dash-empty-text">No AI activity yet. Use AI in Workspace on any note.</p>;
  }

  return (
    <ul className="dash-ai-activity-list">
      {items.map((item) => (
        <li key={item.id} className="dash-ai-activity-item">
          <span className="dash-ai-dot" aria-hidden />
          <span className="dash-ai-message">{item.message}</span>
        </li>
      ))}
    </ul>
  );
}
