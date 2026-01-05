// Prematch stream - subscription-based real-time updates
let prematchStreamSource = null;
let prematchStreamSportId = null;
let prematchStreamRetryTimeoutId = null;
let prematchStreamLastToastAt = 0;
let prematchStreamHasOddsSse = false;

function isPrematchStreamActive() {
  return Boolean(prematchStreamSource && prematchStreamSource.readyState !== 2);
}

function stopPrematchStream() {
  if (prematchStreamRetryTimeoutId) {
    clearTimeout(prematchStreamRetryTimeoutId);
    prematchStreamRetryTimeoutId = null;
  }
  if (prematchStreamSource) {
    prematchStreamSource.close();
  }
  prematchStreamSource = null;
  prematchStreamSportId = null;
  prematchStreamHasOddsSse = false;
}

function startPrematchStream(sportId) {
  if (currentMode !== 'prematch') return;
  
  const key = sportId ? String(sportId) : null;
  if (!key) return;

  // Reuse existing stream if same sport
  if (prematchStreamSource && prematchStreamSportId === key && prematchStreamSource.readyState !== 2) {
    return;
  }

  stopPrematchStream();
  prematchStreamSportId = key;
  prematchStreamHasOddsSse = false;

  const sportName = currentSport?.name ? String(currentSport.name) : '';
  const query = `?sportId=${encodeURIComponent(key)}&sportName=${encodeURIComponent(sportName)}&_=${Date.now()}`;
  const es = new EventSource(`/api/prematch-stream${query}`);
  prematchStreamSource = es;

  es.addEventListener('games', (evt) => {
    if (currentMode !== 'prematch') return;
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    
    applyPrematchGamesPayload(payload);
  });

  es.addEventListener('odds', (evt) => {
    if (currentMode !== 'prematch') return;
    prematchStreamHasOddsSse = true;
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    if (typeof applyLiveOddsPayload === 'function') {
      applyLiveOddsPayload(payload);
    }
  });

  es.addEventListener('error', (evt) => {
    if (!evt || typeof evt.data !== 'string' || !evt.data) return;
    const payload = safeJsonParse(evt.data);
    const msg = payload?.error ? String(payload.error) : '';
    if (!msg) return;
    const now = Date.now();
    if (now - prematchStreamLastToastAt > 15000) {
      prematchStreamLastToastAt = now;
      showToast(msg, 'error');
    }
  });

  es.onerror = () => {
    if (currentMode !== 'prematch') {
      stopPrematchStream();
      return;
    }

    const sid = prematchStreamSportId;
    stopPrematchStream();
    prematchStreamSportId = sid;

    const now = Date.now();
    if (now - prematchStreamLastToastAt > 15000) {
      prematchStreamLastToastAt = now;
      showToast('Prematch stream disconnected. Retrying...', 'info');
    }

    prematchStreamRetryTimeoutId = setTimeout(() => {
      prematchStreamRetryTimeoutId = null;
      if (currentMode === 'prematch') startPrematchStream(sid);
    }, 5000);
  };
}

function applyPrematchGamesPayload(payload) {
  if (!payload) return;
  if (!currentSport?.id) return;
  if (String(currentSport.id) !== String(payload?.sportId)) return;

  const contentEl = document.querySelector('.content');
  const scrollTop = contentEl ? contentEl.scrollTop : null;
  const treeState = typeof snapshotRegionsTreeState === 'function' ? snapshotRegionsTreeState() : null;

  const selectedServerGameId = selectedGame ? getServerGameId(selectedGame) : null;
  const previousSelected = selectedGame;

  // Preserve previous game data for odds continuity
  const prevGamesByServerId = new Map();
  (Array.isArray(currentGames) ? currentGames : []).forEach(g => {
    const sid = getServerGameId(g);
    if (sid !== null && sid !== undefined) prevGamesByServerId.set(String(sid), g);
  });

  currentGames = Array.isArray(payload?.data) ? payload.data : [];
  currentGames.forEach((g, idx) => {
    g.__clientId = String(g.id ?? g.gameId ?? idx);
  });

  // Carry over ephemeral state from previous games
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

  // Preserve selected game
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
    }
  }

  renderGames(payload?.sportName || currentSport.name, currentGames, payload?.last_updated, null, {
    preserveDetails: Boolean(selectedGame),
    restoreState: treeState,
    selectedServerGameId,
    hydrateMainMarkets: true
  });

  if (contentEl && typeof scrollTop === 'number') {
    contentEl.scrollTop = scrollTop;
    if (typeof scheduleVirtualUpdate === 'function') {
      scheduleVirtualUpdate();
    }
  }
}
