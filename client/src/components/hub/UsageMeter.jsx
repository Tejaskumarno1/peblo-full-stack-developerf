import { useQuery } from '@tanstack/react-query';
import { aiConnectionsAPI } from '../../api';

const nice = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const FEATURE = { ask: 'Chat', summary: 'Summaries', tasks: 'Tasks', organize: 'Organize', embed: 'Search', other: 'Other' };

/** Counts only: how many requests your connections answered. Never any text. */
export default function UsageMeter({ connections = [] }) {
  const nameOf = (p) => {
    if (!p.startsWith('conn:')) return p.charAt(0).toUpperCase() + p.slice(1);
    const c = connections.find((x) => `conn:${x.id}` === p);
    return c ? (c.label || c.provider) : 'Removed connection';
  };
  const { data } = useQuery({ queryKey: ['ai-usage'], queryFn: () => aiConnectionsAPI.usage().then((r) => r.data), staleTime: 30_000 });
  if (!data) return null;
  const max = Math.max(1, ...data.days.map((d) => d.count));
  const label = (d) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <section className="ac-usage" aria-label="AI usage" data-testid="ai-usage">
      <div className="ac-usage-top">
        <div><b>{nice(data.month)}</b><span>requests this month</span></div>
        <div><b>{nice(data.today)}</b><span>today</span></div>
      </div>
      {data.month === 0 ? (
        <p className="ac-sub">Nothing yet. Each answer from your AI is counted here. Only the number is kept, never what was asked.</p>
      ) : (
        <>
          <div className="ac-bars" role="img" aria-label={`Requests over the last 14 days, ${data.days.reduce((a, d) => a + d.count, 0)} in total`}>
            {data.days.map((d) => <i key={d.day} title={`${label(d.day)}: ${d.count}`} style={{ height: `${Math.max(d.count ? 12 : 4, (d.count / max) * 100)}%` }} className={d.count ? 'on' : ''} />)}
          </div>
          <div className="ac-split">
            {data.providers.map((p) => <span key={`p${p.provider}`}>{nameOf(p.provider)} <b>{nice(p.count)}</b></span>)}
            {data.features.map((f) => <span key={`f${f.feature}`} className="alt">{FEATURE[f.feature] || f.feature} <b>{nice(f.count)}</b></span>)}
          </div>
        </>
      )}
    </section>
  );
}
