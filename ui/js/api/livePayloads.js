function applyLiveOddsPayload(payload) {
  if (!payload) return;
  if (!currentSport?.id) return;
  if (String(currentSport.id) !== String(payload?.sportId)) return;

  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  if (updates.length === 0) return;

  const selectedServerGameId = selectedGame ? getServerGameId(selectedGame) : null;
  const skipSelected = Boolean(selectedServerGameId && typeof isLiveGameStreamActive === 'function' && isLiveGameStreamActive());

  for (const u of updates) {
    const gid = u?.gameId;
    if (!gid) continue;

    const g = Array.isArray(currentGames)
      ? currentGames.find(x => {
        const sid = getServerGameId(x);
        return sid && String(sid) === String(gid);
      })
      : null;

    if (g) {
      if (Array.isArray(u?.odds)) g.__mainOdds = u.odds;
      if (typeof u?.markets_count === 'number') g.__mainMarketsCount = u.markets_count;
      g.__mainOddsUpdatedAt = Date.now();
    }

    if (skipSelected && selectedServerGameId && String(selectedServerGameId) === String(gid)) {
      continue;
    }

    if (typeof updateGameRowOdds === 'function') {
      updateGameRowOdds(gid, Array.isArray(u?.odds) ? u.odds : null, u?.markets_count);
    }
  }
}

function applyLiveCountsPayload(payload) {
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
  renderSportsList();

  const q = document.getElementById('sportSearch')?.value || '';
  if (q) filterSports(q);
}

function applyPrematchCountsPayload(payload) {
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
  // Only re-render if we're in prematch mode
  if (currentMode === 'prematch') {
    renderSportsList();
    const q = document.getElementById('sportSearch')?.value || '';
    if (q) filterSports(q);
  }
}

function applyLiveGamesPayload(payload) {
  if (!payload) return;
  if (!currentSport?.id) return;
  if (String(currentSport.id) !== String(payload?.sportId)) return;

  const contentEl = document.querySelector('.content');
  const scrollTop = contentEl ? contentEl.scrollTop : null;
  const treeState = typeof snapshotRegionsTreeState === 'function' ? snapshotRegionsTreeState() : null;

  const selectedServerGameId = selectedGame ? getServerGameId(selectedGame) : null;
  const previousSelected = selectedGame;

  const prevGamesByServerId = new Map();
  (Array.isArray(currentGames) ? currentGames : []).forEach(g => {
    const sid = getServerGameId(g);
    if (sid !== null && sid !== undefined) prevGamesByServerId.set(String(sid), g);
  });

  currentGames = Array.isArray(payload?.data) ? payload.data : [];
  currentGames.forEach((g, idx) => {
    g.__clientId = String(g.id ?? g.gameId ?? idx);
  });

  currentGames.forEach(g => {
    const sid = getServerGameId(g);
    if (!sid) return;
    const prev = prevGamesByServerId.get(String(sid));
    if (!prev) return;

    if (prev.__mainOdds && !g.__mainOdds) g.__mainOdds = prev.__mainOdds;
    if (typeof prev.__mainMarketsCount === 'number' && typeof g.__mainMarketsCount !== 'number') {
      g.__mainMarketsCount = prev.__mainMarketsCount;
    }
    if (prev.__mainOddsFlash && !g.__mainOddsFlash) g.__mainOddsFlash = prev.__mainOddsFlash;
    if (typeof prev.__mainOddsUpdatedAt === 'number' && typeof g.__mainOddsUpdatedAt !== 'number') {
      g.__mainOddsUpdatedAt = prev.__mainOddsUpdatedAt;
    }
  });

  if (selectedServerGameId) {
    const refreshedSelected = currentGames.find(g => {
      const sid = getServerGameId(g);
      return sid && String(sid) === String(selectedServerGameId);
    });
    if (refreshedSelected) {
      if (previousSelected && typeof previousSelected === 'object') {
        for (const k of Object.keys(previousSelected)) {
          if (k.startsWith('__')) {
            refreshedSelected[k] = previousSelected[k];
          }
        }
        if (previousSelected.market && !refreshedSelected.market) {
          refreshedSelected.market = previousSelected.market;
        }
        if (previousSelected.__marketFetchStarted && !refreshedSelected.__marketFetchStarted) {
          refreshedSelected.__marketFetchStarted = previousSelected.__marketFetchStarted;
        }
      }
      selectedGame = refreshedSelected;
    } else {
      selectedGame = null;
    }
  }

  renderGames(payload?.sportName || currentSport.name, currentGames, payload?.last_updated, null, {
    preserveDetails: Boolean(selectedGame),
    restoreState: treeState,
    selectedServerGameId,
    hydrateMainMarkets: false
  });

  if (contentEl && typeof scrollTop === 'number') {
    contentEl.scrollTop = scrollTop;

    if (typeof scheduleVirtualUpdate === 'function') {
      scheduleVirtualUpdate();
    }
  }

  if (!selectedGame && selectedServerGameId) {
    clearGameDetails();
  } else if (selectedGame) {
    const isLive = Number(selectedGame?.type) === 1;
    if (isLive && typeof getLiveMeta === 'function') {
      const meta = getLiveMeta(selectedGame);
      const parts = [meta?.scoreText, meta?.timeText].filter(Boolean);
      const timeText = `LIVE${parts.length ? ` ${parts.join(' ')}` : ''}`;
      const timeEl = document.querySelector('#detailsContent .match-time-detail');
      if (timeEl) timeEl.textContent = timeText;
    }
  }
}
