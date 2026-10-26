import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Maximize2, QrCode, X } from 'lucide-react';

/** A QR code for the share link: small in the owner's panel, and a big full-screen one for a room or a class. */
export function useQr(link, size) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    if (!link) { setSrc(''); return undefined; }
    QRCode.toDataURL(link, { margin: 1, width: size, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then((u) => { if (live) setSrc(u); }).catch(() => { if (live) setSrc(''); });
    return () => { live = false; };
  }, [link, size]);
  return src;
}

export default function ShareQr({ link }) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const small = useQr(open ? link : '', 168);
  const large = useQr(big ? link : '', 720);
  useEffect(() => {
    if (!big) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setBig(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [big]);
  if (!link) return null;
  const shown = link.replace(/^https?:\/\//, '');
  return (
    <div className="sq" data-testid="share-qr">
      <button type="button" className="sq-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="qr-toggle"><QrCode size={14} />{open ? 'Hide QR code' : 'Show QR code'}</button>
      {open && <div className="sq-card">
        {small ? <img src={small} alt="QR code for the share link" width={168} height={168} data-testid="qr-img" /> : <span className="sq-wait" />}
        <button type="button" className="sq-big" onClick={() => setBig(true)} data-testid="qr-big"><Maximize2 size={13} />Show big for a room</button>
      </div>}
      {big && <div className="sq-full" role="dialog" aria-label="Scan to open this note" data-testid="qr-full" onClick={() => setBig(false)}>
        <button type="button" className="sq-x" aria-label="Close" onClick={() => setBig(false)}><X size={22} /></button>
        <div className="sq-panel" onClick={(e) => e.stopPropagation()}>
          <h2>Scan to join</h2>
          {large ? <img src={large} alt="Large QR code for the share link" /> : <span className="sq-wait" />}
          <p data-testid="qr-url">{shown}</p>
        </div>
      </div>}
    </div>
  );
}

export const QR_CSS = `
.sq{margin-top:10px}
.sq-toggle,.sq-big{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#ddd);background:transparent;color:inherit;border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.sq-toggle:hover,.sq-big:hover{background:rgba(127,127,127,.12)}
.sq-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-top:8px}
.sq-card img{background:#fff;padding:6px;border-radius:10px;border:1px solid var(--line,#ddd)}
.sq-wait{display:block;width:168px;height:168px;border-radius:10px;background:rgba(127,127,127,.15)}
.sq-full{position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,14,.92);display:flex;align-items:center;justify-content:center;padding:24px}
.sq-panel{background:#fff;color:#111;border-radius:20px;padding:28px 32px;display:flex;flex-direction:column;align-items:center;gap:14px;max-width:min(92vw,720px)}
.sq-panel h2{margin:0;font-size:26px;font-weight:700}
.sq-panel img{width:min(70vh,80vw,560px);height:auto;aspect-ratio:1}
.sq-panel p{margin:0;font-size:18px;font-weight:600;word-break:break-all;text-align:center}
.sq-x{position:absolute;top:18px;right:18px;border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:50%;width:40px;height:40px;display:grid;place-items:center;cursor:pointer}
`;
