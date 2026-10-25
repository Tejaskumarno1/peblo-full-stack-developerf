import { useQueries } from '@tanstack/react-query';
import { aiConnectionsAPI } from '../../api';
import './aiConnections.css';

/** The models of one saved connection, asked of the provider (cached for a few minutes). */
export const connectionModelsQuery = (id) => ({
  queryKey: ['ai-conn-models', id],
  queryFn: () => aiConnectionsAPI.models(id).then((r) => r.data),
  staleTime: 5 * 60 * 1000,
  retry: false,
});

/**
 * The chat's model picker rows for the person's own AI connections: every model each key can use, grouped by connection.
 * `cloud` is the cloud list from /ai/hub/models; only 'conn:<id>' entries are shown here.
 * `open` keeps the provider calls from running until the picker is opened.
 */
export default function ConnectionModelOptions({ cloud, modelChoice, onPick, open, disabledFor }) {
  const conns = (cloud || []).filter((c) => c.provider?.startsWith('conn:') && c.configured);
  const results = useQueries({ queries: conns.map((c) => ({ ...connectionModelsQuery(c.provider.slice(5)), enabled: !!open })) });
  return conns.map((c, i) => {
    const listed = results[i]?.data?.models;
    const models = listed?.length ? listed : [c.model];
    const off = disabledFor?.(c) === true;
    return (
      <div key={c.provider} className="ac-group-wrap" role="group" aria-label={c.label}>
        <span className="ac-group">{c.label}{c.local ? ' · on this computer' : ''}{results[i]?.isFetching && !listed ? ' · loading models…' : ''}</span>
        {models.map((m) => (
          <button key={m} type="button" role="option" disabled={off}
            aria-selected={modelChoice ? (modelChoice.provider === c.provider && modelChoice.model === m) : false}
            onClick={() => onPick({ provider: c.provider, model: m })}>
            {m}{!modelChoice && m === c.model ? ' · default' : ''}
          </button>
        ))}
      </div>
    );
  });
}
