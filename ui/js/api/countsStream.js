// Counts stream - always active, streams live and prematch counts
let countsStreamSource = null;
let countsStreamRetryTimeoutId = null;

function isCountsStreamActive() {
  return Boolean(countsStreamSource && countsStreamSource.readyState !== 2);
}

function stopCountsStream() {
  if (countsStreamRetryTimeoutId) {
    clearTimeout(countsStreamRetryTimeoutId);
    countsStreamRetryTimeoutId = null;
  }
  if (countsStreamSource) {
    countsStreamSource.close();
  }
  countsStreamSource = null;
}

function startCountsStream() {
  if (isCountsStreamActive()) return;
  
  stopCountsStream();
  
  const es = new EventSource(`/api/counts-stream?_=${Date.now()}`);
  countsStreamSource = es;
  
  es.addEventListener('live_counts', (evt) => {
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
  });
  
  es.addEventListener('prematch_counts', (evt) => {
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
  });
  
  es.onerror = () => {
    stopCountsStream();
    
    // Retry after 5 seconds
    countsStreamRetryTimeoutId = setTimeout(() => {
      countsStreamRetryTimeoutId = null;
      startCountsStream();
    }, 5000);
  };
}
