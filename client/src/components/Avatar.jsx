import { useEffect, useState } from 'react';
import '../styles/profiles.css'; // keeps the picture's rounded look in sync with the app

// A person's picture, or their initial when they have none. Fills its parent (the parent sets size and shape).
// The size, fit and clipping are set inline on purpose: a stylesheet that is late, cached from an older
// build or overridden must never be able to draw a profile picture at its full size.
const FIT = { width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' };

export default function Avatar({ src, fallback, alt = '' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  if (src && !broken) {
    return <img className="pb-avatar-img" style={FIT} src={src} alt={alt} draggable="false" onError={() => setBroken(true)} />;
  }
  return <>{fallback}</>;
}