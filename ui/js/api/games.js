async function fetchAllCachedGames(sportName) {
  const limit = 500;
  const maxPages = 20;
  let skip = 0;
  let pages = 0;
  let lastUpdated = null;
  let pagination = null;
  const games = [];

  while (pages < maxPages) {
    const response = await fetch(`/api/sport-games?sportName=${encodeURIComponent(sportName)}&limit=${limit}&skip=${skip}&_=${Date.now()}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    lastUpdated = data.last_updated;
    pagination = data.pagination;
    const chunk = data.data || [];
    games.push(...chunk);

    if (!pagination?.hasMore) break;
    skip += limit;
    pages += 1;
  }

  return { games, lastUpdated, pagination };
}

function filterPrematchGames(games) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec + (5 * 60);
  return (Array.isArray(games) ? games : []).filter(g => {
    const ts = Number(g?.start_ts);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    return ts > cutoffSec;
  });
}

async function refreshCurrentSportPrematchGames() {
  if (cachedMode) return;
  if (!currentSport?.id || !currentSport?.name) return;

  try {
    const selectedServerGameId = selectedGame ? getServerGameId(selectedGame) : null;

    const typeParam = currentMode === 'live' ? 'live' : 'prematch';
    const url = `/api/sport-full-scrape?sportId=${currentSport.id}&sportName=${encodeURIComponent(currentSport.name)}&type=${typeParam}&_=${Date.now()}`;

    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();

    currentGames = data.data || [];
    if (currentMode === 'prematch') {
      currentGames = filterPrematchGames(currentGames);
    }

    currentGames.forEach((g, idx) => {
      g.__clientId = String(g.id ?? g.gameId ?? idx);
    });

    renderGames(currentSport.name, currentGames, data.last_updated);

    if (selectedServerGameId) {
      const refreshedSelected = currentGames.find(g => getServerGameId(g) && String(getServerGameId(g)) === String(selectedServerGameId));
      if (refreshedSelected) {
        selectedGame = refreshedSelected;
        showGameDetails(refreshedSelected);

        const row = document.querySelector(`.game-row[data-game-id="${CSS.escape(String(refreshedSelected.__clientId))}"]`);
        if (row) row.classList.add('selected');

        if (isMobileLayout()) {
          openMobileDetails();
        } else {
          gameDetailsPanel.classList.remove('hidden');
        }
      }
    }
  } catch (e) {
    console.error('Failed to refresh prematch games:', e);
  }
}

async function loadGames(sportId, sportName) {
  showLoading(`Loading ${sportName} games...`);
  currentSport = { id: sportId, name: sportName };

  if (currentMode === 'live' && typeof startLiveStream === 'function') {
    startLiveStream(sportId);
  }

  try {
    let data;
    if (cachedMode) {
      const result = await fetchAllCachedGames(sportName);
      data = { last_updated: result.lastUpdated, pagination: result.pagination };
      currentGames = result.games || [];
      currentGames.forEach((g, idx) => {
        g.__clientId = String(g.id ?? g.gameId ?? idx);
      });
      renderGames(sportName, currentGames, data.last_updated, data.pagination);
    } else {
      const typeParam = currentMode === 'live' ? 'live' : 'prematch';
      const url = `/api/sport-full-scrape?sportId=${sportId}&sportName=${encodeURIComponent(sportName)}&type=${typeParam}&_=${Date.now()}`;
      const response = await fetch(url, { cache: 'no-store' });
      data = await response.json();
      currentGames = data.data || [];
      if (currentMode === 'prematch') {
        currentGames = filterPrematchGames(currentGames);
      }

      currentGames.forEach((g, idx) => {
        g.__clientId = String(g.id ?? g.gameId ?? idx);
      });
      renderGames(sportName, currentGames, data.last_updated);
      showToast(`Fetched ${currentGames.length} ${currentMode} games`, 'success');
    }
  } catch (error) {
    showToast('Failed to load games: ' + error.message, 'error');
  }
  hideLoading();
}

async function loadLiveGames(sportId, sportName) {
  return loadGames(sportId, sportName);
}
