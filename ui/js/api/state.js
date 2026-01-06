let liveStreamSource = null;
let liveStreamSportId = null;
let liveStreamRetryTimeoutId = null;
let liveStreamLastToastAt = 0;
let liveStreamOddsIntervalId = null;
let liveStreamDetailsIntervalId = null;
let liveStreamHasOddsSse = false;

const API_BASE = (() => {
  const configured = typeof window !== 'undefined' ? window.DOB_API_BASE : null;
  if (configured && typeof configured === 'string') return configured.replace(/\/+$/, '');

  const host = typeof window !== 'undefined' ? String(window.location?.hostname || '') : '';
  if (host && host.includes('dob-edge') && host.endsWith('.pages.dev')) {
    return 'https://dob-edge.ghzwael.workers.dev';
  }
  return '';
})();

function apiUrl(path) {
  const p = String(path || '');
  if (!API_BASE) return p;
  if (!p.startsWith('/')) return `${API_BASE}/${p}`;
  return `${API_BASE}${p}`;
}

let liveGameSource = null;
let liveGameId = null;
let liveGameRetryTimeoutId = null;
let liveGameLastToastAt = 0;
