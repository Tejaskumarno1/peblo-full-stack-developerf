import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, HardDrive, MemoryStick, Download, Check, Sparkles, X, ExternalLink, Zap, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { aiAPI } from '../../api';
import './localModels.css';

/**
 * PEB-281: the local model store. Shows what this computer can run and downloads models through the person's own
 * Ollama, so nobody has to visit a website or use a terminal. Renders nothing on a shared (web) server.
 * `variant` is 'soft' | 'river' | 'orbit' and only changes how it looks.
 */
export default function LocalModels({ variant = 'soft' }) {
  const { settings, updateSettings } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const { data } = useQuery({
    queryKey: ['local-models'],
    queryFn: () => aiAPI.localStatus().then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.pulls?.some((j) => !j.done) || ['downloading', 'installing'].includes(q.state.data?.install?.status) ? 1200 : 5000),
  });
  if (!data || data.available === false) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['local-models'] });
  const hw = data.hardware || {};
  const pullOf = (id) => data.pulls?.find((j) => j.model === id);
  const chatModel = (settings?.ollamaModel || 'llama3.2').replace(/:latest$/, '');
  const embedModel = (settings?.ollamaEmbedModel || 'nomic-embed-text').replace(/:latest$/, '');
  const enabled = settings?.ollamaEnabled === true;

  const download = async (id) => {
    setError('');
    try { await aiAPI.localPull(id); } catch (e) { setError(e.response?.data?.error || 'Could not start the download.'); }
    refresh();
  };
  const startOllama = async () => {
    setError(''); setStarting(true);
    try { await aiAPI.localStart(); } catch (e) { setError(e.response?.data?.error || 'Could not start Ollama.'); }
    setStarting(false); refresh();
  };
  const install = async () => {
    setError('');
    try { await aiAPI.localInstall(); } catch (e) { setError(e.response?.data?.error || 'Could not start the install.'); }
    refresh();
  };
  const cancel = async (id) => { try { await aiAPI.localCancel(id); } catch { /* it ends on its own */ } refresh(); };
  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.name} from this computer? You can download it again later.`)) return;
    setError('');
    try { await aiAPI.localRemove(m.id); } catch (e) { setError(e.response?.data?.error || 'Could not remove it.'); }
    refresh();
  };
  const use = (m) => updateSettings(m.kind === 'search' ? { ollamaEnabled: true, ollamaEmbedModel: m.id } : { ollamaEnabled: true, ollamaModel: m.id });
  const setUp = async () => {
    setError('');
    for (const m of data.catalog.filter((x) => (x.id === data.recommendedChat || x.kind === 'search') && !x.installed)) {
      try { await aiAPI.localPull(m.id); } catch (e) { setError(e.response?.data?.error || 'Could not start the download.'); }
    }
    await updateSettings({ ollamaEnabled: true, ollamaModel: data.recommendedChat });
    refresh();
  };
  const busy = data.pulls?.some((j) => !j.done);
  const todo = data.catalog.filter((m) => (m.id === data.recommendedChat || m.kind === 'search') && !m.installed);

  const rec = data.catalog.find((m) => m.id === data.recommendedChat);
  const fmt = (n) => (n >= 10 ? Math.round(n) : n.toFixed(1));

  return (
    <section className={`lm lm-${variant}`} aria-labelledby="lm-title" data-testid="local-models">
      <header className="lm-head">
        <div>
          <h2 id="lm-title" className="lm-title">Model store</h2>
          <p className="lm-sub">Download AI models to this computer with one click. They run offline, and your notes never leave it.</p>
        </div>
        <span className={`lm-state ${data.running ? 'ok' : 'off'}`}>{data.running ? 'Ollama is running' : 'Ollama not found'}</span>
      </header>

      <ul className="lm-hw" aria-label="This computer">
        <li><MemoryStick size={16} /> <b>{fmt(hw.ramGb)} GB</b> memory</li>
        <li><Cpu size={16} /> <b>{hw.cpuCores}</b> processor cores</li>
        {hw.gpu && <li><Zap size={16} /> <b>{hw.gpu.name}</b>{hw.gpu.vramGb ? ` · ${fmt(hw.gpu.vramGb)} GB` : ''}</li>}
        {hw.freeDiskGb != null && <li><HardDrive size={16} /> <b>{fmt(hw.freeDiskGb)} GB</b> free space</li>}
      </ul>

      {!data.running && (
        <div className="lm-install" role="status">
          <div>
            <b>{data.onDisk ? 'Ollama is installed but not running.' : 'Peblo needs the free Ollama app to run models.'}</b>
            <span>{data.onDisk ? ' Start it here. No terminal needed.' : ' Install it once. This page notices by itself and unlocks the downloads.'}</span>
          </div>
          {data.onDisk
            ? <button type="button" className="lm-btn primary" onClick={startOllama} disabled={starting}>{starting ? 'Starting…' : 'Start Ollama'}</button>
            : ['downloading', 'installing'].includes(data.install?.status)
              ? (
                <div className="lm-act" style={{ flex: '1 1 220px', minWidth: 220 }}>
                  <div className="lm-bar" role="progressbar" aria-label="Installing Ollama" aria-valuenow={data.install.percent || 0} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${data.install.status === 'installing' ? 100 : data.install.percent}%` }} /></div>
                  <span className="lm-pct">{data.install.status === 'installing' ? 'Installing…' : `${data.install.percent}%`}</span>
                  {data.install.status === 'downloading' && <button type="button" className="lm-link" aria-label="Cancel install" onClick={() => aiAPI.localInstallCancel().then(refresh)}><X size={14} /></button>}
                </div>
              )
              : data.canInstall
                ? <div className="lm-act"><button type="button" className="lm-btn primary" onClick={install}><Download size={15} /> Install Ollama for me</button><a className="lm-btn" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Website <ExternalLink size={14} /></a></div>
                : <a className="lm-btn" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Get Ollama <ExternalLink size={14} /></a>}
        </div>
      )}

      {data.running && rec && todo.length > 0 && (
        <div className="lm-rec">
          <div>
            <b><Sparkles size={15} /> Recommended for this computer</b>
            <span>{rec.name} ({fmt(rec.sizeGb)} GB) for chat{todo.some((m) => m.kind === 'search') ? ', plus the small search model' : ''}. Total about {fmt(todo.reduce((s, m) => s + m.sizeGb, 0))} GB.</span>
          </div>
          <button type="button" className="lm-btn primary" onClick={setUp} disabled={busy}><Download size={15} /> Set it up for me</button>
        </div>
      )}
      {data.running && todo.length === 0 && enabled && <p className="lm-done"><Check size={15} /> Local AI is ready on this computer.</p>}

      {data.install?.status === 'failed' && !data.running && <p role="alert" className="lm-err">{data.install.error === 'Cancelled' ? 'Install cancelled.' : `Install failed: ${data.install.error}`}</p>}
      {error && <p role="alert" className="lm-err">{error}</p>}

      <ul className="lm-grid">
        {data.catalog.map((m) => {
          const job = pullOf(m.id);
          const pulling = job && !job.done;
          const failed = job?.done && job.error;
          const lowDisk = hw.freeDiskGb != null && hw.freeDiskGb < m.sizeGb * 1.2;
          const inUse = m.kind === 'search' ? embedModel === m.id : chatModel === m.id;
          return (
            <li key={m.id} className={`lm-card${m.installed ? ' on' : ''}${!m.fits ? ' dim' : ''}`} data-model={m.id}>
              <div className="lm-card-top">
                <span className={`lm-kind ${m.kind}`}>{m.kind === 'search' ? 'Search' : 'Chat'}</span>
                {m.gpuFast && <span className="lm-kind" title="Fits in your graphics card memory">Fast on GPU</span>}
                {m.id === data.recommendedChat && <span className="lm-pick">Best fit</span>}
              </div>
              <h3 className="lm-name">{m.name}</h3>
              <p className="lm-blurb">{m.blurb}</p>
              <p className="lm-meta">{fmt(m.sizeGb)} GB download · needs {m.minRamGb} GB memory</p>
              <div className="lm-act">
                {pulling ? (
                  <>
                    <div className="lm-bar" role="progressbar" aria-valuenow={job.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Downloading ${m.name}`}><i style={{ width: `${job.percent}%` }} /></div>
                    <span className="lm-pct">{job.total ? `${job.percent}%` : 'Starting…'}</span>
                    <button type="button" className="lm-link" onClick={() => cancel(m.id)} aria-label={`Cancel ${m.name}`}><X size={14} /></button>
                  </>
                ) : m.installed ? (
                  <>{inUse && enabled
                    ? <span className="lm-chip"><Check size={14} /> In use</span>
                    : <><span className="lm-chip soft"><Check size={14} /> Downloaded</span><button type="button" className="lm-btn small" onClick={() => use(m)}>{m.kind === 'search' ? 'Use for search' : 'Use for chat'}</button></>}
                    <button type="button" className="lm-link" onClick={() => remove(m)} aria-label={`Remove ${m.name}`} title="Remove from this computer"><Trash2 size={14} /></button></>
                ) : !m.fits ? (
                  <span className="lm-note">Needs more memory than this computer has</span>
                ) : lowDisk ? (
                  <span className="lm-note">Not enough free space</span>
                ) : (
                  <button type="button" className="lm-btn small" onClick={() => download(m.id)} disabled={!data.running}><Download size={14} /> Download</button>
                )}
              </div>
              {failed && <p className="lm-err small" role="alert">{job.error === 'Cancelled' ? 'Download cancelled.' : `Download failed: ${job.error}`}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
