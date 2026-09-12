import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

const source = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'İzinli test videosu',
  author: 'Test hesabı',
  duration: 125,
  platform: 'youtube',
  items: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      type: 'video',
      title: 'İzinli test videosu',
      audioAvailable: true,
      formats: [
        { id: 'f1', ext: 'mp4', height: 1080, fps: 60, hasAudio: true },
        { id: 'f2', ext: 'mp4', height: 720, fps: 30, hasAudio: true },
        { id: 'f3', ext: 'webm', height: 480, fps: 24, hasAudio: true },
      ],
    },
  ],
};

function jsonResponse(data, ok = true) {
  return Promise.resolve({ ok, json: async () => data });
}

function mockApi(inspected = source) {
  const mock = vi.fn((path) => {
    if (path === '/api/health') return jsonResponse({ ready: true, tools: {} });
    if (path === '/api/inspect') return jsonResponse(inspected);
    if (path === '/api/download') return jsonResponse({ id: 'job-1', status: 'queued' });
    if (path === '/api/jobs/job-1') {
      return jsonResponse({
        id: 'job-1',
        status: 'completed',
        progress: 100,
        title: inspected.title,
        downloadUrl: '/api/jobs/job-1/file',
        filename: 'akis-video.mp4',
      });
    }
    return jsonResponse({ error: 'Bulunamadı' }, false);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function inspectSource(user, url = 'https://www.youtube.com/watch?v=test') {
  await user.type(screen.getByLabelText('İçerik bağlantısı'), url);
  await user.click(screen.getByRole('button', { name: 'Seçenekleri getir' }));
  await screen.findByRole('button', { name: 'İndirmeyi başlat' }, { timeout: 5000 });
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Akış workspace', () => {
  it('starts with an honest empty state and disabled inspect action', async () => {
    mockApi();
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bağlantıyı yapıştır');
    expect(screen.getByText('Seçenekler burada görünecek.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seçenekleri getir' })).toBeDisabled();
    expect(await screen.findByText('Servis hazır')).toBeInTheDocument();
  });

  it('inspects a source and only offers source-available resolutions and matching FPS', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<App />);
    await inspectSource(user);
    expect(screen.getByRole('button', { name: '1080p' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '60 FPS' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '2160p' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '30 FPS' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '720p' }));
    expect(screen.getByRole('button', { name: '30 FPS' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '60 FPS' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '480p' }));
    expect(await screen.findByText('Kaynak FPS')).toBeInTheDocument();
  });

  it('sends audio settings and records a completed job in history', async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await inspectSource(user);
    await user.click(screen.getByRole('button', { name: 'Ses', exact: true }));
    await user.click(screen.getByRole('button', { name: '320 kbps' }));
    await user.click(screen.getByRole('button', { name: 'İndirmeyi başlat' }));
    expect(await screen.findByText('Dosyan hazır')).toBeInTheDocument();
    const [, options] = fetchMock.mock.calls.find(([path]) => path === '/api/download');
    expect(JSON.parse(options.body)).toEqual({
      mediaId: source.id,
      itemId: source.items[0].id,
      format: 'mp3',
      height: null,
      fps: null,
      bitrate: 320,
    });
    expect(screen.getByRole('link', { name: 'Dosyayı kaydet' })).toHaveAttribute(
      'href',
      new URL('/api/jobs/job-1/file', window.location.origin).href,
    );
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('akis.history.v1'))).toHaveLength(1);
    });
  });

  it('supports album selection with a single image original download', async () => {
    const album = {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Fotoğraf albümü',
      platform: 'instagram',
      items: [
        { id: 'photo-1', type: 'image', title: 'Birinci fotoğraf', formats: [] },
        { id: 'photo-2', type: 'image', title: 'İkinci fotoğraf', formats: [] },
      ],
    };
    const fetchMock = mockApi(album);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Instagram' }));
    await inspectSource(user, 'https://www.instagram.com/p/test');
    await user.click(screen.getByRole('button', { name: '2. fotoğraf seç' }));
    expect(screen.getByRole('button', { name: '2. fotoğraf seç' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: 'Orijinal' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'İndirmeyi başlat' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === '/api/download')).toBe(true));
    const [, options] = fetchMock.mock.calls.find(([path]) => path === '/api/download');
    expect(JSON.parse(options.body)).toMatchObject({
      itemId: 'photo-2',
      format: 'original',
      height: null,
      fps: null,
    });
  });

  it('shows a real inspect error without fabricating a preview', async () => {
    mockApi();
    vi.mocked(fetch).mockImplementation((path) =>
      path === '/api/health'
        ? jsonResponse({ ready: true })
        : jsonResponse({ error: 'Bu içerik oturum gerektiriyor.' }, false),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('İçerik bağlantısı'), 'https://youtu.be/test');
    await user.click(screen.getByRole('button', { name: 'Seçenekleri getir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('oturum gerektiriyor');
    expect(screen.queryByText('İçerik bulundu')).not.toBeInTheDocument();
  });

  it('reports a clipboard denial in Turkish and refocuses the field', async () => {
    mockApi();
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Panodan yapıştır' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Panoya erişilemedi');
    expect(screen.getByLabelText('İçerik bağlantısı')).toHaveFocus();
  });

  it('ignores a stale inspection response after switching platforms', async () => {
    let resolveInspection;
    let signal;
    const fetchMock = mockApi();
    fetchMock.mockImplementation((path, options) => {
      if (path === '/api/health') return jsonResponse({ ready: true });
      if (path === '/api/inspect') {
        signal = options.signal;
        return new Promise((resolve) => {
          resolveInspection = resolve;
        });
      }
      return jsonResponse({});
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('İçerik bağlantısı'), 'https://youtu.be/test');
    await user.click(screen.getByRole('button', { name: 'Seçenekleri getir' }));
    await user.click(screen.getByRole('button', { name: 'Instagram' }));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveInspection({ ok: true, json: async () => source });
    });
    expect(screen.queryByText('İçerik bulundu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instagram', pressed: true })).toBeInTheDocument();
  });

  it('aborts job polling on unmount', async () => {
    const fetchMock = mockApi();
    let pollSignal;
    fetchMock.mockImplementation((path, options) => {
      if (path === '/api/health') return jsonResponse({ ready: true });
      if (path === '/api/inspect') return jsonResponse(source);
      if (path === '/api/download') return jsonResponse({ id: 'job-1', status: 'queued' });
      pollSignal = options.signal;
      return new Promise(() => {});
    });
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await inspectSource(user);
    await user.click(screen.getByRole('button', { name: 'İndirmeyi başlat' }));
    await waitFor(() => expect(pollSignal).toBeDefined());
    unmount();
    expect(pollSignal.aborted).toBe(true);
  });

  it('lets the user retry a failed status request', async () => {
    const fetchMock = mockApi();
    let polls = 0;
    fetchMock.mockImplementation((path) => {
      if (path === '/api/health') return jsonResponse({ ready: true });
      if (path === '/api/inspect') return jsonResponse(source);
      if (path === '/api/download') return jsonResponse({ id: 'job-1', status: 'queued' });
      polls += 1;
      return polls === 1
        ? Promise.reject(new Error('Offline'))
        : jsonResponse({ id: 'job-1', status: 'completed', progress: 100, title: source.title, downloadUrl: '/api/jobs/job-1/file' });
    });
    const user = userEvent.setup();
    render(<App />);
    await inspectSource(user);
    await user.click(screen.getByRole('button', { name: 'İndirmeyi başlat' }));
    await user.click(await screen.findByRole('button', { name: 'Durumu yeniden kontrol et' }));
    expect(await screen.findByText('Dosyan hazır')).toBeInTheDocument();
  });

  it('caps history, restores a source for reuse and clears saved entries', async () => {
    localStorage.setItem(
      'akis.history.v1',
      JSON.stringify(
        Array.from({ length: 35 }, (_, index) => ({
          id: `old-${index}`,
          title: `Video ${index}`,
          platform: 'youtube',
          url: `https://youtu.be/video${index}`,
          format: 'mp4',
          date: '2026-09-11T12:00:00.000Z',
        })),
      ),
    );
    mockApi();
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(JSON.parse(localStorage.getItem('akis.history.v1'))).toHaveLength(30));
    await user.click(screen.getAllByRole('button', { name: 'Geçmiş' })[0]);
    await user.click(screen.getByRole('button', { name: 'Video 0 bağlantısını yeniden kullan' }));
    expect(screen.getByLabelText('İçerik bağlantısı')).toHaveValue('https://youtu.be/video0');
    await user.click(screen.getAllByRole('button', { name: 'Geçmiş' })[0]);
    await user.click(screen.getByRole('button', { name: 'Geçmişi temizle' }));
    expect(screen.getByText('İlk içeriğine yer açtık.')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('akis.history.v1'))).toHaveLength(0));
  });

  it('opens the FAQ through native disclosure controls', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Yardım' }));
    const question = screen.getByText('Neden her videoda 1080p veya 60 FPS seçeneği yok?');
    await user.click(question);
    expect(question.closest('details')).toHaveAttribute('open');
  });
});
