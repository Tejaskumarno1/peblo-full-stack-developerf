import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';

/** Says so when the computer loses its connection, and clears itself when it is back. */
export default function OfflineBar() {
  const [off, setOff] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [back, setBack] = useState(false);
  useEffect(() => {
    const down = () => { setOff(true); setBack(false); };
    const up = () => { setOff(false); setBack(true); setTimeout(() => setBack(false), 3000); };
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    return () => { window.removeEventListener('offline', down); window.removeEventListener('online', up); };
  }, []);
  if (!off && !back) return null;
  return (
    <div className="s-offline" role="status" aria-live="polite" data-testid="offline-bar">
      <CloudOff size={16} aria-hidden="true" />
      <span className="grow">{off ? 'You are offline. Peblo will reconnect on its own. Changes made now may not be saved.' : 'You are back online.'}</span>
      {off && <span className="pill">Reconnecting</span>}
    </div>
  );
}
