async function loadHierarchy(forceRefresh = false) {
  showLoading('Loading sports hierarchy...');
  try {
    const url = forceRefresh ? '/api/hierarchy?refresh=true' : '/api/hierarchy';
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    hierarchy = data.data || data;

    await ensureAllSportsLoaded(true);

    renderSportsList();
    updateStats();
    showToast(data.cached ? 'Loaded from cache' : 'Fetched fresh data', 'success');
  } catch (error) {
    showToast('Failed to load hierarchy: ' + error.message, 'error');
  }
  hideLoading();
}

async function ensureLiveSportsLoaded(forceRefresh = false) {
  if (!forceRefresh && sportsWithLiveGames instanceof Set) return;
  try {
    const sportsRes = await fetch(`/api/live-sports?_=${Date.now()}`, { cache: 'no-store' });
    if (!sportsRes.ok) {
      sportsWithLiveGames = null;
      sportsCountsLive = null;
      totalGamesLive = null;
      updateModeButtons();
      return;
    }

    const sportsData = await sportsRes.json();
    const sports = Array.isArray(sportsData?.sports) ? sportsData.sports : [];
    const names = [];
    const counts = new Map();
    for (const s of sports) {
      if (!s) continue;
      if (typeof s === 'string') {
        const name = String(s);
        names.push(name);
        counts.set(name.toLowerCase(), 0);
        continue;
      }
      const name = s?.name;
      if (!name) continue;
      names.push(String(name));
      counts.set(String(name).toLowerCase(), Number(s?.count) || 0);
    }
    sportsWithLiveGames = new Set(names.map(s => String(s).toLowerCase()));
    sportsCountsLive = counts;
    totalGamesLive = Number(sportsData?.total_games);
    if (!Number.isFinite(totalGamesLive)) {
      totalGamesLive = Array.from(counts.values()).reduce((sum, c) => sum + (Number(c) || 0), 0);
    }
    updateModeButtons();
  } catch (e) {
    sportsWithLiveGames = null;
    sportsCountsLive = null;
    totalGamesLive = null;
    updateModeButtons();
  }
}

async function ensurePrematchSportsLoaded(forceRefresh = false) {
  if (!forceRefresh && sportsWithPrematchGames instanceof Set) return;
  try {
    const sportsRes = await fetch(`/api/prematch-sports?_=${Date.now()}`, { cache: 'no-store' });
    if (!sportsRes.ok) {
      sportsWithPrematchGames = null;
      sportsCountsPrematch = null;
      totalGamesPrematch = null;
      updateModeButtons();
      return;
    }

    const sportsData = await sportsRes.json();
    const sports = Array.isArray(sportsData?.sports) ? sportsData.sports : [];
    const names = [];
    const counts = new Map();
    for (const s of sports) {
      if (!s) continue;
      if (typeof s === 'string') {
        const name = String(s);
        names.push(name);
        counts.set(name.toLowerCase(), 0);
        continue;
      }
      const name = s?.name;
      if (!name) continue;
      names.push(String(name));
      counts.set(String(name).toLowerCase(), Number(s?.count) || 0);
    }
    sportsWithPrematchGames = new Set(names.map(s => String(s).toLowerCase()));
    sportsCountsPrematch = counts;
    totalGamesPrematch = Number(sportsData?.total_games);
    if (!Number.isFinite(totalGamesPrematch)) {
      totalGamesPrematch = Array.from(counts.values()).reduce((sum, c) => sum + (Number(c) || 0), 0);
    }
    updateModeButtons();
  } catch (e) {
    sportsWithPrematchGames = null;
    sportsCountsPrematch = null;
    totalGamesPrematch = null;
    updateModeButtons();
  }
}

async function ensureCachedSportsLoaded(forceRefresh = false) {
  if (!forceRefresh && sportsWithCachedGames instanceof Set) return;
  try {
    const sportsRes = await fetch(`/api/cached-sports?_=${Date.now()}`, { cache: 'no-store' });
    if (!sportsRes.ok) {
      sportsWithCachedGames = null;
      sportsCountsCached = null;
      totalGamesCached = null;
      updateModeButtons();
      return;
    }

    const sportsData = await sportsRes.json();
    const sports = Array.isArray(sportsData?.sports) ? sportsData.sports : [];
    const names = [];
    const counts = new Map();
    for (const s of sports) {
      if (!s) continue;
      if (typeof s === 'string') {
        const name = String(s);
        names.push(name);
        counts.set(name.toLowerCase(), 0);
        continue;
      }
      const name = s?.name;
      if (!name) continue;
      names.push(String(name));
      counts.set(String(name).toLowerCase(), Number(s?.count) || 0);
    }

    sportsWithCachedGames = new Set(names.map(s => String(s).toLowerCase()));
    sportsCountsCached = counts;
    totalGamesCached = Number(sportsData?.total_games);
    if (!Number.isFinite(totalGamesCached)) {
      totalGamesCached = Array.from(counts.values()).reduce((sum, c) => sum + (Number(c) || 0), 0);
    }
    updateModeButtons();
  } catch (e) {
    sportsWithCachedGames = null;
    sportsCountsCached = null;
    totalGamesCached = null;
    updateModeButtons();
  }
}

async function ensureAllSportsLoaded(forceRefresh = false) {
  await Promise.all([
    ensureCachedSportsLoaded(forceRefresh),
    ensureLiveSportsLoaded(forceRefresh),
    ensurePrematchSportsLoaded(forceRefresh),
    ensureResultsSportsLoaded(forceRefresh)
  ]);
}

function updateModeButtons() {
  const prematchEl = document.getElementById('modePrematch');
  const liveEl = document.getElementById('modeLive');
  const cachedEl = document.getElementById('modeCached');
  const resultsEl = document.getElementById('modeResults');

  if (prematchEl) {
    prematchEl.textContent = Number.isFinite(totalGamesPrematch) ? `Prematch (${totalGamesPrematch})` : 'Prematch';
  }
  if (liveEl) {
    liveEl.textContent = Number.isFinite(totalGamesLive) ? `Live (${totalGamesLive})` : 'Live';
  }
  if (cachedEl) {
    cachedEl.textContent = Number.isFinite(totalGamesCached) ? `Cached (${totalGamesCached})` : 'Cached';
  }
  if (resultsEl) {
    resultsEl.textContent = Number.isFinite(totalGamesResults) ? `Results (${totalGamesResults})` : 'Results';
  }
}
