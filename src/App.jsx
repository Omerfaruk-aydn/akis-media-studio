import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  AtSign,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Globe,
  Headphones,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Menu,
  Music2,
  RotateCcw,
  ShieldCheck,
  ThumbsUp,
  Trash2,
  Waves,
  X as XIcon,
  Youtube,
  Zap,
} from 'lucide-react';

export const HISTORY_KEY = 'akis.history.v2';
const HISTORY_LIMIT = 30;
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, ''); // backend base URL injected at build time

const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', icon: Youtube, host: ['youtube.com', 'youtu.be'], hint: 'youtube.com/watch?v=…', color: '#ff0033' },
  { id: 'instagram', name: 'Instagram', icon: Camera, host: ['instagram.com'], hint: 'instagram.com/p/…', color: '#e1306c' },
  { id: 'twitter', name: 'X / Twitter', icon: AtSign, host: ['twitter.com', 'x.com'], hint: 'x.com/…/status/…', color: '#1d9bf0' },
  { id: 'facebook', name: 'Facebook', icon: ThumbsUp, host: ['facebook.com', 'fb.watch'], hint: 'facebook.com/watch/…', color: '#1877f2' },
];

const FAQS = [
  [
    'Hangi içerikleri indirebilirim?',
    'YouTube, Instagram, X / Twitter ve Facebook üzerindeki herkese açık ve indirme izniniz olan içerikleri analiz edebilirsiniz. Özel hesaplar, DRM korumalı içerikler ve canlı yayınlar desteklenmez.',
  ],
  [
    'Neden her videoda 1080p veya 60 FPS seçeneği yok?',
    'Akış yalnızca kaynağın gerçekten sunduğu çözünürlükleri ve kare hızlarını listeler; yapay olarak kalite veya kare üretmez. Kaynak 30 ya da 60 FPS sunmuyorsa o seçenek listede görünmez.',
  ],
  [
    'Albümdeki fotoğrafları nasıl kaydederim?',
    'Bağlantıyı inceledikten sonra albümden bir öğe seçin; her indirme işlemi seçili tek öğeyi hazırlar. Bir analiz en fazla 20 öğe içerir.',
  ],
  [
    'Video, ses ve fotoğraf formatları arasındaki fark nedir?',
    'MP4 geniş cihaz uyumluluğu sağlar, WebM alternatif bir video codec ailesidir. MP3 ve M4A ses çıkarma seçenekleridir. Daha yüksek bit hızı seçmek kaynağın ses kalitesini artırmaz.',
  ],
  [
    'Hazır dosyalar ve geçmişim ne kadar saklanır?',
    'Hazırlanan dosyalar sunucuda sınırlı bir süre tutulur ve sunucu yeniden başlatıldığında silinir. Bu tarayıcıdaki geçmiş, son 30 tamamlanan işlemin bağlantısını saklar; istediğiniz an temizleyebilirsiniz.',
  ],
  [
    'İndirme neden başarısız olabilir?',
    'Platform erişimi kısıtlıyor olabilir, bağlantı kaldırılmış olabilir veya seçilen kalite kaynakta artık bulunmuyor olabilir. Bağlantıyı yeniden inceleyip tekrar deneyebilirsiniz.',
  ],
];

function detectPlatform(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return PLATFORMS.find((platform) => platform.host.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) || null;
  } catch {
    return null;
  }
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === 'string' &&
          typeof entry.title === 'string' &&
          typeof entry.url === 'string' &&
          PLATFORMS.some((platform) => platform.id === entry.platform),
      )
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function safeSameOriginUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin === window.location.origin) return parsed.href;
    const apiBase = (API_BASE || '').replace(/\/$/, '');
    if (apiBase && parsed.origin === apiBase) return parsed.href;
    return null;
  } catch {
    return null;
  }
}

function safeDownloadUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let candidate = value;
  if (candidate.startsWith('/') && API_BASE) {
    candidate = `${API_BASE}${candidate}`;
  }
  try {
    const parsed = new URL(candidate, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function safeImageUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

async function request(path, body, signal) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Sunucu geçerli bir yanıt vermedi. Tekrar deneyin.');
  }
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'İşlem tamamlanamadı. Tekrar deneyin.');
  }
  return data;
}

function durationLabel(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [...(hours ? [hours] : []), String(minutes).padStart(hours ? 2 : 1, '0'), String(rest).padStart(2, '0')].join(':');
}

function statusLabel(status) {
  return (
    {
      queued: 'Sıraya alındı',
      downloading: 'Kaynak indiriliyor',
      processing: 'Dosya hazırlanıyor',
      completed: 'Dosyan hazır',
      failed: 'Hazırlama tamamlanamadı',
    }[status] || 'Durum alınıyor'
  );
}

function Thumbnail({ src, alt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const image = safeImageUrl(src);
  return (
    <div className="thumbnail">
      {image && !failed ? (
        <img src={image} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <Film size={28} aria-hidden="true" />
      )}
    </div>
  );
}

function Notice({ error, children }) {
  return (
    <div className={`notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}>
      <CircleHelp size={17} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function StepDots({ current }) {
  const steps = [
    { id: 1, label: 'Bağlantı' },
    { id: 2, label: 'İçerik' },
    { id: 3, label: 'İndir' },
  ];
  return (
    <ol className="step-dots" aria-label="İşlem adımları">
      {steps.map((step) => (
        <li key={step.id} className={current === step.id ? 'is-current' : current > step.id ? 'is-done' : ''}>
          <span className="step-dot" aria-hidden="true">
            {current > step.id ? <Check size={12} /> : step.id}
          </span>
          <span className="step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function FormatChip({ active, children, label, onClick }) {
  return (
    <button type="button" className={`format-chip ${active ? 'is-active' : ''}`} onClick={onClick} aria-pressed={active} aria-label={label}>
      {children}
    </button>
  );
}

export default function App() {
  const [platform, setPlatform] = useState('youtube');
  const [page, setPage] = useState('download');
  const [url, setUrl] = useState('');
  const [media, setMedia] = useState(null);
  const [itemId, setItemId] = useState('');
  const [mode, setMode] = useState('video');
  const [format, setFormat] = useState('mp4');
  const [height, setHeight] = useState('');
  const [fps, setFps] = useState('');
  const [bitrate, setBitrate] = useState('192');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [clipboardMessage, setClipboardMessage] = useState('');
  const [health, setHealth] = useState('checking');
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [job, setJob] = useState(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [history, setHistory] = useState(readHistory);
  const [storageError, setStorageError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const inspectController = useRef(null);
  const downloadController = useRef(null);
  const inspectVersion = useRef(0);
  const downloadVersion = useRef(0);
  const clipboardVersion = useRef(0);
  const mounted = useRef(true);
  const inputRef = useRef(null);
  const recordedJobs = useRef(new Set());
  const jobContext = useRef(null);

  const currentPlatform = PLATFORMS.find((entry) => entry.id === platform);
  const detectedPlatform = detectPlatform(url.trim());
  const item = media?.items.find((entry) => entry.id === itemId) || null;
  const videoFormats = item?.formats || [];
  const heights = [...new Set(videoFormats.map((entry) => Number(entry.height)).filter(Boolean))].sort((a, b) => b - a);
  const availableFps = [
    ...new Set(
      videoFormats
        .filter((entry) => !height || Number(entry.height) === Number(height))
        .map((entry) => Math.round(Number(entry.fps)))
        .filter((entry) => entry === 30 || entry === 60),
    ),
  ].sort((a, b) => a - b);
  const hasAudio = Boolean(item?.audioAvailable);
  const workingJob = Boolean(job && !['completed', 'failed'].includes(job.status));
  const locked = submitting || workingJob;
  const activePlatform = detectedPlatform || currentPlatform;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inspectController.current?.abort();
      downloadController.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setHealth('checking');
    request('/api/health', null, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setHealth(data.ready ? 'ready' : 'unavailable');
      })
      .catch((failure) => {
        if (failure.name !== 'AbortError' && !controller.signal.aborted) setHealth('offline');
      });
    return () => controller.abort();
  }, [healthAttempt]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
      setStorageError('');
    } catch {
      setStorageError('Tarayıcı geçmişi kaydedemedi. İndirmeye devam edebilirsin.');
    }
  }, [history]);

  useEffect(() => {
    if (!job?.id || ['completed', 'failed'].includes(job.status)) return undefined;
    const id = job.id;
    const controller = new AbortController();
    let cancelled = false;
    let timer;

    async function poll() {
      try {
        const data = await request(`/api/jobs/${encodeURIComponent(id)}`, null, controller.signal);
        if (cancelled) return;
        setJob((previous) => (previous?.id === id ? { ...previous, ...data, pollError: '' } : previous));
        if (!['completed', 'failed'].includes(data.status)) timer = window.setTimeout(poll, 1200);
      } catch (failure) {
        if (cancelled || failure.name === 'AbortError') return;
        setJob((previous) => (previous?.id === id ? { ...previous, pollError: failure.message } : previous));
      }
    }

    poll();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [job?.id, pollAttempt]);

  useEffect(() => {
    if (job?.status !== 'completed' || recordedJobs.current.has(job.id)) return;
    recordedJobs.current.add(job.id);
    const context = jobContext.current;
    const entry = {
      id: job.id,
      title: job.title || context?.title || 'Medya dosyası',
      platform: context?.platform || platform,
      url: context?.url || '',
      format: context?.format || '',
      downloadUrl: job.downloadUrl,
      filename: job.filename,
      date: new Date().toISOString(),
    };
    setHistory((previous) => [entry, ...previous.filter((saved) => saved.id !== entry.id)].slice(0, HISTORY_LIMIT));
  }, [job, platform]);

  function resetInspection() {
    inspectVersion.current += 1;
    inspectController.current?.abort();
    setMedia(null);
    setItemId('');
    setError('');
    setLoading(false);
  }

  function selectPlatform(next, target = 'download') {
    clipboardVersion.current += 1;
    resetInspection();
    setPlatform(next);
    setPage(target);
    setUrl('');
    setClipboardMessage('');
    setMenuOpen(false);
  }

  function updateUrl(value) {
    clipboardVersion.current += 1;
    resetInspection();
    setUrl(value);
    setClipboardMessage('');
  }

  function selectItem(selected) {
    setItemId(selected.id);
    const resolutions = (selected.formats || []).map((entry) => Number(entry.height)).filter(Boolean);
    const topHeight = resolutions.length ? Math.max(...resolutions) : '';
    const rates = (selected.formats || [])
      .filter((entry) => Number(entry.height) === topHeight)
      .map((entry) => Math.round(Number(entry.fps)))
      .filter((entry) => entry === 30 || entry === 60)
      .sort((a, b) => a - b);
    setHeight(topHeight ? String(topHeight) : '');
    setFps(rates.length ? String(rates[0]) : '');
    if (selected.type === 'image') {
      setMode('photo');
      setFormat('original');
    } else {
      setMode('video');
      setFormat('mp4');
    }
  }

  function selectMode(value) {
    setMode(value);
    setFormat(value === 'video' ? 'mp4' : value === 'audio' ? 'mp3' : 'original');
  }

  function selectHeight(value) {
    setHeight(value);
    const rates = videoFormats
      .filter((entry) => Number(entry.height) === Number(value))
      .map((entry) => Math.round(Number(entry.fps)))
      .filter((entry) => entry === 30 || entry === 60)
      .sort((a, b) => a - b);
    setFps(rates.includes(Number(fps)) ? fps : rates.length ? String(rates[0]) : '');
  }

  async function pasteUrl() {
    const version = ++clipboardVersion.current;
    setClipboardMessage('');
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported');
      const text = await navigator.clipboard.readText();
      if (!mounted.current || version !== clipboardVersion.current) return;
      if (!text.trim()) {
        setClipboardMessage('Panon boş. Bağlantıyı kopyalayıp tekrar dene.');
        return;
      }
      updateUrl(text.trim().slice(0, 2048));
      inputRef.current?.focus();
    } catch {
      if (!mounted.current || version !== clipboardVersion.current) return;
      setClipboardMessage('Panoya erişilemedi. Bağlantıyı alana elle yapıştır.');
      inputRef.current?.focus();
    }
  }

  async function inspect(event) {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    const targetPlatform = detectPlatform(value)?.id || platform;
    setPlatform(targetPlatform);
    inspectController.current?.abort();
    const controller = new AbortController();
    inspectController.current = controller;
    const version = ++inspectVersion.current;
    setLoading(true);
    setError('');
    setMedia(null);
    setClipboardMessage('');
    try {
      const data = await request('/api/inspect', { url: value, platform: targetPlatform }, controller.signal);
      if (version !== inspectVersion.current || controller.signal.aborted) return;
      const items = Array.isArray(data.items)
        ? data.items.filter((entry) => entry && entry.id && ['video', 'image'].includes(entry.type) && Array.isArray(entry.formats))
        : [];
      if (!items.length) throw new Error('Bu bağlantıda desteklenen içerik bulunamadı. Başka bir bağlantı dene.');
      setMedia({ ...data, items, sourceUrl: value, sourcePlatform: targetPlatform });
      selectItem(items[0]);
    } catch (failure) {
      if (failure.name !== 'AbortError' && version === inspectVersion.current) setError(failure.message);
    } finally {
      if (version === inspectVersion.current && !controller.signal.aborted) setLoading(false);
    }
  }

  async function startDownload() {
    if (!media || !item || locked) return;
    downloadController.current?.abort();
    const controller = new AbortController();
    downloadController.current = controller;
    const version = ++downloadVersion.current;
    setSubmitting(true);
    setError('');
    jobContext.current = { title: item.title || media.title, platform: media.sourcePlatform, url: media.sourceUrl, format };
    try {
      const data = await request(
        '/api/download',
        {
          mediaId: media.id,
          itemId: item.id,
          format,
          height: mode === 'video' && height ? Number(height) : null,
          fps: mode === 'video' && fps ? Number(fps) : null,
          bitrate: Number(bitrate),
        },
        controller.signal,
      );
      if (controller.signal.aborted || version !== downloadVersion.current) return;
      setJob({ id: data.id, status: data.status || 'queued', progress: 0, title: item.title || media.title });
    } catch (failure) {
      if (failure.name !== 'AbortError' && version === downloadVersion.current) setError(failure.message);
    } finally {
      if (!controller.signal.aborted && version === downloadVersion.current) setSubmitting(false);
    }
  }

  function reuse(entry) {
    selectPlatform(entry.platform);
    setUrl(entry.url);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function historyRows(entries, removable) {
    return entries.map((entry) => {
      const Icon = PLATFORMS.find((platformEntry) => platformEntry.id === entry.platform)?.icon || Film;
      const file = safeDownloadUrl(entry.downloadUrl);
      const validDate = !Number.isNaN(Date.parse(entry.date));
      return (
        <li className="history-row" key={entry.id}>
          <span className="history-icon">
            <Icon size={20} aria-hidden="true" />
          </span>
          <div className="history-copy">
            <h3>{entry.title}</h3>
            <p>
              {PLATFORMS.find((platformEntry) => platformEntry.id === entry.platform)?.name}
              {entry.format ? <span>· {entry.format.toUpperCase()}</span> : null}
              {validDate ? (
                <time dateTime={entry.date}>
                  · {new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(entry.date))}
                </time>
              ) : null}
            </p>
          </div>
          <div className="history-actions">
            <button type="button" className="icon-button" title="Kaynağı yeniden incele" aria-label={`${entry.title} bağlantısını yeniden kullan`} onClick={() => reuse(entry)}>
              <RotateCcw size={16} />
            </button>
            {file ? (
              <a className="icon-button" href={file} download={entry.filename || true} title="Dosyayı kaydet" aria-label={`${entry.title} dosyasını kaydet`}>
                <ArrowDownToLine size={16} />
              </a>
            ) : null}
            {removable ? (
              <button
                type="button"
                className="icon-button"
                title="Geçmişten kaldır"
                aria-label={`${entry.title} kaydını geçmişten kaldır`}
                onClick={() => setHistory((previous) => previous.filter((saved) => saved.id !== entry.id))}
              >
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </li>
      );
    });
  }

  const jobFileUrl = job?.status === 'completed' ? safeDownloadUrl(job.downloadUrl) : null;
  const currentStep = !media ? 1 : !job ? 2 : 3;

  return (
    <div className="workspace">
      <a href="#main" className="skip-link">
        İçeriğe geç
      </a>
      <header className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <button type="button" className="brand" onClick={() => selectPlatform('youtube')} aria-label="Akış ana sayfa">
          <Waves size={30} aria-hidden="true" />
          <span>
            akış<span className="brand-dot">.</span>
          </span>
        </button>
        <p className="sidebar-caption">İzinli medyayı, kaynağındaki kalitede kaydet.</p>
        <button type="button" className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Menüyü kapat">
          <XIcon size={20} />
        </button>
        <nav aria-label="Çalışma alanı">
          <button type="button" className={`nav-item ${page === 'download' ? 'active' : ''}`} aria-current={page === 'download' ? 'page' : undefined} onClick={() => setPage('download')}>
            <Download size={19} aria-hidden="true" />
            <span>İndir</span>
            {workingJob && <span className="activity-dot" aria-label="Devam eden iş var" />}
          </button>
          <button type="button" className={`nav-item ${page === 'library' ? 'active' : ''}`} aria-current={page === 'library' ? 'page' : undefined} onClick={() => setPage('library')}>
            <FolderOpen size={19} aria-hidden="true" />
            <span>Kitaplık</span>
          </button>
          <button type="button" className={`nav-item ${page === 'history' ? 'active' : ''}`} aria-current={page === 'history' ? 'page' : undefined} onClick={() => setPage('history')}>
            <Clock3 size={19} aria-hidden="true" />
            <span>Geçmiş</span>
          </button>
          <button type="button" className={`nav-item ${page === 'help' ? 'active' : ''}`} aria-current={page === 'help' ? 'page' : undefined} onClick={() => setPage('help')}>
            <CircleHelp size={19} aria-hidden="true" />
            <span>Yardım</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={18} aria-hidden="true" />
            <p>
              İçeriğe saygıyla.
              <span>Yalnızca izinli paylaşımlar.</span>
            </p>
          </div>
        </div>
      </header>
      {menuOpen && <button type="button" className="scrim" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)} />}

      <div className="main-shell">
        <header className="topbar">
          <button type="button" className="mobile-menu" aria-label="Menüyü aç" onClick={() => setMenuOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            <span>Akış</span>
            <span>/</span>
            <strong>{page === 'download' ? 'İndirme stüdyosu' : page === 'library' ? 'Kitaplık' : page === 'history' ? 'Geçmiş' : 'Yardım merkezi'}</strong>
          </div>
          <button type="button" className={`service-status ${health}`} onClick={() => setHealthAttempt((previous) => previous + 1)} disabled={health === 'checking'}>
            <span />
            {health === 'ready' ? 'Servis hazır' : health === 'checking' ? 'Servis kontrol ediliyor' : 'Servise bağlanılamadı'}
          </button>
        </header>

        <main id="main">
          {page === 'download' ? (
            <>
              <section className="hero">
                <div className="hero-meta">
                  <h1>
                    Bağlantıyı yapıştır.
                    <br />
                    <span className="hero-gradient">Seçenekleri gör.</span>
                  </h1>
                  <p>YouTube ve herkese açık sosyal medya gönderilerini analiz et; yalnızca kaynakta bulunan video, ses veya fotoğraf seçeneklerinden birini kaydet.</p>
                </div>
              </section>

              <StepDots current={currentStep} />

              <section className="composer" aria-label="İndirme bağlantısı">
                <div className="composer-head">
                  <div className={`composer-badge ${activePlatform.id}`} style={{ '--platform-color': activePlatform.color }}>
                    <activePlatform.icon size={22} aria-hidden="true" />
                  </div>
                  <div>
                    <h2>Bir içerik bağlantısı ekle</h2>
                    <p>
                      {detectedPlatform
                        ? `${detectedPlatform.name} bağlantısı algılandı. Devam etmek için incele.`
                        : `${currentPlatform.name} için bağlantı bekleniyor.`}
                    </p>
                  </div>
                </div>

                <form onSubmit={inspect} className="composer-form">
                  <label htmlFor="media-url" className="visually-hidden">
                    İçerik bağlantısı
                  </label>
                  <div className={`url-input ${error ? 'invalid' : ''}`}>
                    <Link2 size={19} aria-hidden="true" />
                    <input
                      ref={inputRef}
                      id="media-url"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck="false"
                      maxLength={2048}
                      placeholder={`https://${currentPlatform.hint}`}
                      value={url}
                      onChange={(event) => updateUrl(event.target.value)}
                      aria-invalid={Boolean(error)}
                    />
                    <button type="button" onClick={pasteUrl} aria-label="Panodan yapıştır" title="Panodan yapıştır">
                      <Clipboard size={18} />
                    </button>
                  </div>
                  <button type="submit" className="primary inspect-button" disabled={loading || !url.trim()}>
                    {loading ? <LoaderCircle size={18} className="spin" /> : <Zap size={18} />}
                    {loading ? 'Seçenekler getiriliyor' : 'Seçenekleri getir'}
                    {!loading && <ArrowRight size={18} />}
                  </button>
                </form>

                {clipboardMessage && <Notice error>{clipboardMessage}</Notice>}
                {error && <Notice error>{error}</Notice>}
                {health === 'unavailable' && <Notice>Sunucu araçları henüz hazır değil. Hazır olduğunda bağlantıyı yeniden incele.</Notice>}

                <div className="platform-strip" aria-label="Platformlar">
                  {PLATFORMS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`platform-pill ${platform === entry.id ? 'is-active' : ''}`}
                      style={{ '--platform-color': entry.color }}
                      onClick={() => selectPlatform(entry.id)}
                      aria-pressed={platform === entry.id}
                    >
                      <entry.icon size={16} aria-hidden="true" />
                      {entry.name}
                    </button>
                  ))}
                </div>
              </section>

              <div className="content-grid">
                <div className="work-column">
                  <section className="result-panel" aria-labelledby="result-heading">
                    <div className="panel-heading">
                      <h2 id="result-heading">İçerik önizlemesi</h2>
                      <span className="muted">{media ? `${media.items.length} öğe bulundu` : 'Henüz içerik yok'}</span>
                    </div>

                    <div className="source-content" aria-busy={loading}>
                      {loading ? (
                        <div className="empty loading" role="status">
                          <LoaderCircle size={32} className="spin" aria-hidden="true" />
                          <h3>Kaynağa göz atıyoruz.</h3>
                          <p>İçerik bilgileri ve kullanılabilir formatlar alınıyor.</p>
                        </div>
                      ) : !media ? (
                        <div className="empty">
                          <div className="empty-symbol">
                            <Link2 size={28} strokeWidth={1.5} aria-hidden="true" />
                          </div>
                          <h3>Seçenekler burada görünecek.</h3>
                          <p>Geçerli bir bağlantı eklediğinde içerik özeti ile kaynağın gerçekten sunduğu format, çözünürlük ve kare hızlarını göstereceğiz.</p>
                          <div className="supported-types">
                            <span>
                              <Film size={14} /> Video
                            </span>
                            <span>
                              <Headphones size={14} /> Ses
                            </span>
                            <span>
                              <ImageIcon size={14} /> Fotoğraf
                            </span>
                          </div>
                        </div>
                      ) : item ? (
                        <div className="media-result">
                          <div className="preview">
                            <div className="preview-image">
                              <Thumbnail src={item.thumbnail || media.thumbnail} alt={item.title} />
                              {durationLabel(media.duration) && <span className="duration">{durationLabel(media.duration)}</span>}
                            </div>
                            <div className="preview-copy">
                              <span className="media-type">{item.type === 'image' ? 'FOTOĞRAF' : 'VİDEO'}</span>
                              <h3>{item.title || media.title || 'Başlıksız içerik'}</h3>
                              {media.author && <p>{media.author}</p>}
                              <div className="preview-meta">
                                {durationLabel(media.duration) && (
                                  <span>
                                    <Clock3 size={13} /> {durationLabel(media.duration)}
                                  </span>
                                )}
                                <span>
                                  <ShieldCheck size={13} /> {currentPlatform.name}
                                </span>
                              </div>
                            </div>
                          </div>

                          {media.items.length > 1 && (
                            <fieldset className="album-fieldset" disabled={locked}>
                              <legend>
                                Albüm öğesi <span>({media.items.length})</span>
                              </legend>
                              <div className="album-list">
                                {media.items.map((entry, index) => (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    className={`album-item ${entry.id === itemId ? 'selected' : ''}`}
                                    aria-pressed={entry.id === itemId}
                                    aria-label={`${index + 1}. ${entry.type === 'image' ? 'fotoğraf' : 'video'} seç`}
                                    onClick={() => selectItem(entry)}
                                  >
                                    <Thumbnail src={entry.thumbnail} alt="" />
                                    <span>{index + 1}</span>
                                    {entry.id === itemId && <Check size={14} className="album-check" />}
                                  </button>
                                ))}
                              </div>
                            </fieldset>
                          )}

                          <fieldset className="output-fieldset" disabled={locked}>
                            <legend>Nasıl kaydetmek istersin?</legend>
                            {item.type === 'video' && (
                              <div className="mode-options" aria-label="İçerik türü">
                                <button type="button" className={mode === 'video' ? 'selected' : ''} aria-pressed={mode === 'video'} onClick={() => selectMode('video')}>
                                  <Film size={16} /> Video
                                </button>
                                <button type="button" className={mode === 'audio' ? 'selected' : ''} aria-pressed={mode === 'audio'} disabled={!hasAudio} title={!hasAudio ? 'Bu kaynakta ses bulunmuyor' : undefined} onClick={() => selectMode('audio')}>
                                  <Music2 size={16} /> Ses
                                </button>
                              </div>
                            )}

                            <div className="format-grid">
                              <label>
                                <span>Format</span>
                                <div className="format-chips">
                                  {(item.type === 'image' ? ['original', 'jpg', 'png'] : mode === 'audio' ? ['mp3', 'm4a'] : ['mp4', 'webm', 'original']).map((value) => (
                                    <FormatChip key={value} active={format === value} label={value === 'original' ? 'Orijinal' : value.toUpperCase()} onClick={() => setFormat(value)}>
                                      {value === 'original' ? 'Orijinal' : value.toUpperCase()}
                                    </FormatChip>
                                  ))}
                                </div>
                              </label>

                              {item.type === 'video' && mode === 'video' && (
                                <>
                                  <label>
                                    <span>Çözünürlük</span>
                                    <div className="format-chips">
                                      {!heights.length && <span className="chip-muted">Kaynakta yok</span>}
                                      {heights.map((value) => (
                                        <FormatChip key={value} active={String(value) === height} label={`${value}p`} onClick={() => selectHeight(String(value))}>
                                          {value}p
                                        </FormatChip>
                                      ))}
                                    </div>
                                  </label>
                                  <label>
                                    <span>Kare hızı</span>
                                    <div className="format-chips">
                                      {!availableFps.length && <span className="chip-muted">Kaynak FPS</span>}
                                      {availableFps.map((value) => (
                                        <FormatChip key={value} active={String(value) === fps} label={`${value} FPS`} onClick={() => setFps(String(value))}>
                                          {value} FPS
                                        </FormatChip>
                                      ))}
                                    </div>
                                  </label>
                                </>
                              )}

                              {item.type === 'video' && mode === 'audio' && (
                                <label>
                                  <span>Ses bit hızı</span>
                                  <div className="format-chips">
                                    {[128, 192, 320].map((value) => (
                                      <FormatChip key={value} active={bitrate === String(value)} label={`${value} kbps`} onClick={() => setBitrate(String(value))}>
                                        {value} kbps
                                      </FormatChip>
                                    ))}
                                  </div>
                                </label>
                              )}
                            </div>
                            <p className="field-hint">
                              {mode === 'video' ? 'Çözünürlük ve kare hızı doğrudan kaynaktan gelir.' : mode === 'audio' ? 'Daha yüksek bit hızı, kaynakta olmayan kaliteyi eklemez.' : 'Orijinal seçeneği fotoğrafın kaynak formatını korur.'}
                            </p>
                          </fieldset>

                          <button type="button" className="primary download-cta" onClick={startDownload} disabled={locked}>
                            {submitting ? <LoaderCircle size={18} className="spin" /> : <ArrowDownToLine size={18} />}
                            {submitting ? 'İş oluşturuluyor' : workingJob ? 'İndirme sürüyor' : 'İndirmeyi başlat'}
                          </button>
                          <p className="cta-note">
                            <ShieldCheck size={14} aria-hidden="true" /> Yalnızca sahibi olduğun veya indirme iznin olan içerikleri kaydet.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {job && (
                    <section className={`job ${job.status === 'completed' ? 'job-complete' : ''}`} role="status" aria-label="İndirme durumu">
                      <div className="job-heading">
                        <strong aria-live="polite">{statusLabel(job.status)}</strong>
                        <span className="job-percent">{Math.round(job.progress || 0)}%</span>
                      </div>
                      <p>{job.title}</p>
                      <div className="job-track" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, Math.max(0, job.progress || 0))}%` }} />
                      </div>
                      <progress max="100" value={Math.min(100, Math.max(0, job.progress || 0))} aria-label="İndirme ilerlemesi" />
                      {job.status === 'failed' && <Notice error>{job.error || 'Dosya hazırlanamadı. Yeniden deneyebilirsin.'}</Notice>}
                      {job.pollError && (
                        <div className="poll-error">
                          <Notice error>{job.pollError}</Notice>
                          <button type="button" className="text-button" onClick={() => setPollAttempt((previous) => previous + 1)}>
                            Durumu yeniden kontrol et
                          </button>
                        </div>
                      )}
                      {job.status === 'completed' &&
                        (jobFileUrl ? (
                          <a className="primary file-link" href={jobFileUrl} download={job.filename || true}>
                            <ArrowDownToLine size={18} /> Dosyayı kaydet
                          </a>
                        ) : (
                          <Notice error>Dosya bağlantısı alınamadı. Kaynağı yeniden inceleyip tekrar dene.</Notice>
                        ))}
                    </section>
                  )}

                  <section className="recent-section" aria-labelledby="recent-heading">
                    <div className="section-title">
                      <h2 id="recent-heading">Son kaydedilenler</h2>
                      <button type="button" className="text-button" onClick={() => setPage('history')}>
                        Tümünü gör <ArrowUpRight size={14} />
                      </button>
                    </div>
                    {history.length ? (
                      <ul className="history-list">{historyRows(history.slice(0, 3), false)}</ul>
                    ) : (
                      <div className="recent-empty">
                        <Clock3 size={19} />
                        <p>
                          Henüz bir indirme yok.
                          <span>Tamamlanan dosyaların burada yerini alacak.</span>
                        </p>
                      </div>
                    )}
                    {storageError && <Notice error>{storageError}</Notice>}
                  </section>
                </div>

                <aside className="guide" aria-labelledby="guide-heading">
                  <h2 id="guide-heading">
                    Üç adımda,
                    <br />
                    yanında.
                  </h2>
                  <ol className="workflow">
                    {[
                      ['Bağlantıyı ekle', 'Paylaşımın bağlantısını kopyala ve stüdyoya yapıştır.'],
                      ['Kendine göre seç', 'Video, ses veya fotoğraf; kaynağın sunduğu seçeneklerle.'],
                      ['Yanında götür', 'Dosyanı cihazına kaydet, ihtiyacın olduğunda aç.'],
                    ].map(([title, description], index) => (
                      <li key={title} className={currentStep === index + 1 ? 'current' : ''}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <h3>{title}</h3>
                          <p>{description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="guide-tip">
                    <span className="tip-dot" aria-hidden="true" />
                    <h3>Kaynağında ne varsa.</h3>
                    <p>Yapay kalite artışı yok. Çözünürlük ve kare hızı seçenekleri içeriğin gerçek özelliklerine göre belirlenir.</p>
                  </div>
                  <div className="guide-tip guide-tip-alt">
                    <Globe size={18} aria-hidden="true" />
                    <h3>Yerel erişim.</h3>
                    <p>Uygulama sunucusu yalnızca bu cihazdaki 127.0.0.1 adresinde dinler; platform erişimi internet bağlantısı gerektirir.</p>
                  </div>
                </aside>
              </div>
            </>
          ) : page === 'help' ? (
            <section className="secondary-page">
              <div className="page-header">
                <span className="hero-pill">
                  <CircleHelp size={14} aria-hidden="true" /> Yardım merkezi
                </span>
                <h1>Birlikte netleştirelim.</h1>
                <p className="page-description">Bağlantıdan dosyana kadar bilmen gerekenler.</p>
              </div>
              <div className="faq-list">
                {FAQS.map(([question, answer]) => (
                  <details key={question}>
                    <summary>
                      {question}
                      <ChevronDown size={18} aria-hidden="true" />
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
              <button type="button" className="primary" onClick={() => setPage('download')}>
                Çalışma alanına dön <ArrowRight size={18} />
              </button>
            </section>
          ) : (
            <section className="secondary-page">
              <div className="page-header">
                <span className="hero-pill">
                  {page === 'library' ? <FolderOpen size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
                  {page === 'library' ? 'Kitaplık' : 'Geçmiş'}
                </span>
                <h1>{page === 'library' ? 'Kaydettiklerin, bir arada.' : 'Arşivinin izinde.'}</h1>
                <p className="page-description">
                  {page === 'library' ? 'Devam eden işini takip et, hazır dosyalarını cihazına kaydet.' : 'Bu tarayıcıdaki son 30 tamamlanan indirme. İstediğin kaynağa yeniden dön.'}
                </p>
              </div>
              {page === 'library' && job && (
                <section className={`job ${job.status === 'completed' ? 'job-complete' : ''}`} role="status" aria-label="İndirme durumu">
                  <div className="job-heading">
                    <strong aria-live="polite">{statusLabel(job.status)}</strong>
                    <span className="job-percent">{Math.round(job.progress || 0)}%</span>
                  </div>
                  <p>{job.title}</p>
                  <div className="job-track" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.max(0, job.progress || 0))}%` }} />
                  </div>
                  <progress max="100" value={Math.min(100, Math.max(0, job.progress || 0))} aria-label="İndirme ilerlemesi" />
                  {job.status === 'completed' && jobFileUrl && (
                    <a className="primary file-link" href={jobFileUrl} download={job.filename || true}>
                      <ArrowDownToLine size={18} /> Dosyayı kaydet
                    </a>
                  )}
                </section>
              )}
              <div className="library-surface">
                <div className="section-title">
                  <h2>{page === 'library' ? 'Hazır dosyalar' : 'İndirme geçmişi'}</h2>
                  {page === 'history' && history.length > 0 && (
                    <button type="button" className="text-button danger-text" onClick={() => setHistory([])}>
                      <Trash2 size={16} /> Geçmişi temizle
                    </button>
                  )}
                </div>
                {history.length ? (
                  <ul className="history-list">{historyRows(history, page === 'history')}</ul>
                ) : (
                  <div className="library-empty">
                    <FolderOpen size={38} strokeWidth={1.4} aria-hidden="true" />
                    <h2>İlk içeriğine yer açtık.</h2>
                    <p>Tamamlanan indirmelerin burada görünecek.</p>
                    <button type="button" className="primary" onClick={() => setPage('download')}>
                      Bağlantı ekle <ArrowRight size={18} />
                    </button>
                  </div>
                )}
                {storageError && <Notice error>{storageError}</Notice>}
              </div>
            </section>
          )}

          <footer className="page-footer">
            <span>
              akış<span>.</span> İçeriğin, yanında.
            </span>
            <button type="button" onClick={() => setPage('help')}>
              Sorumlu kullanım <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}
