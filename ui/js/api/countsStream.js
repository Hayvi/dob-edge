// Counts stream - always active, streams live and prematch counts
let countsStreamSource = null;
let countsStreamRetryTimeoutId = null;
let countsStreamListeners = []; // Track listeners for proper cleanup

function isCountsStreamActive() {
  return Boolean(countsStreamSource && countsStreamSource.readyState !== 2);
}

function stopCountsStream() {
  if (countsStreamRetryTimeoutId) {
    clearTimeout(countsStreamRetryTimeoutId);
    countsStreamRetryTimeoutId = null;
  }
  if (countsStreamSource) {
    // Remove all listeners before closing to prevent memory leaks
    for (const { type, listener } of countsStreamListeners) {
      countsStreamSource.removeEventListener(type, listener);
    }
    countsStreamListeners = [];
    countsStreamSource.close();
  }
  countsStreamSource = null;
}

function startCountsStream() {
  if (isCountsStreamActive()) return;
  
  stopCountsStream();
  
  const es = new EventSource(apiUrl(`/api/counts-stream?_=${Date.now()}`));
  countsStreamSource = es;
  
  const liveCountsListener = (evt) => {
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    
    const sports = Array.isArray(payload?.sports) ? payload.sports : [];
    const names = [];
    const counts = new Map();
    let totalGames = 0;
    
    for (const s of sports) {
      const name = s?.name;
      if (!name) continue;
      const c = Number(s?.count) || 0;
      names.push(String(name));
      counts.set(String(name).toLowerCase(), c);
      totalGames += c;
    }
    
    sportsWithLiveGames = new Set(names.map(s => String(s).toLowerCase()));
    sportsCountsLive = counts;
    totalGamesLive = Number(payload?.total_games);
    if (!Number.isFinite(totalGamesLive)) {
      totalGamesLive = totalGames;
    }
    
    updateModeButtons();
    if (currentMode === 'live') {
      renderSportsList();
      const q = document.getElementById('sportSearch')?.value || '';
      if (q) filterSports(q);
    }
  };
  
  const prematchCountsListener = (evt) => {
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    
    const sports = Array.isArray(payload?.sports) ? payload.sports : [];
    const names = [];
    const counts = new Map();
    let totalGames = 0;
    
    for (const s of sports) {
      const name = s?.name;
      if (!name) continue;
      const c = Number(s?.count) || 0;
      names.push(String(name));
      counts.set(String(name).toLowerCase(), c);
      totalGames += c;
    }
    
    sportsWithPrematchGames = new Set(names.map(s => String(s).toLowerCase()));
    sportsCountsPrematch = counts;
    totalGamesPrematch = Number(payload?.total_games);
    if (!Number.isFinite(totalGamesPrematch)) {
      totalGamesPrematch = totalGames;
    }
    
    updateModeButtons();
    if (currentMode === 'prematch') {
      renderSportsList();
      const q = document.getElementById('sportSearch')?.value || '';
      if (q) filterSports(q);
    }
  };

  const errorListener = () => {
    stopCountsStream();
    
    // Retry after 5 seconds
    countsStreamRetryTimeoutId = setTimeout(() => {
      countsStreamRetryTimeoutId = null;
      startCountsStream();
    }, 5000);
  };
  
  // Add listeners and track them for cleanup
  es.addEventListener('live_counts', liveCountsListener);
  countsStreamListeners.push({ type: 'live_counts', listener: liveCountsListener });
  
  es.addEventListener('prematch_counts', prematchCountsListener);
  countsStreamListeners.push({ type: 'prematch_counts', listener: prematchCountsListener });
  
  es.addEventListener('error', errorListener);
  countsStreamListeners.push({ type: 'error', listener: errorListener });
}