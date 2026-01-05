function isLiveGameStreamActive() {
  return Boolean(liveGameSource && liveGameSource.readyState !== 2);
}

function stopLiveGameStream() {
  if (liveGameRetryTimeoutId) {
    clearTimeout(liveGameRetryTimeoutId);
    liveGameRetryTimeoutId = null;
  }
  if (liveGameSource) {
    liveGameSource.close();
  }
  liveGameSource = null;
  liveGameId = null;
}

function startLiveGameStream(gameId) {
  // Allow real-time updates for both live and prematch modes
  if (currentMode !== 'live' && currentMode !== 'prematch') return;
  const key = gameId ? String(gameId) : null;
  if (!key) return;

  if (liveGameSource && liveGameId === key && liveGameSource.readyState !== 2) {
    return;
  }

  stopLiveGameStream();
  liveGameId = key;

  const query = `?gameId=${encodeURIComponent(key)}&_=${Date.now()}`;
  const es = new EventSource(`/api/live-game-stream${query}`);
  liveGameSource = es;

  es.addEventListener('game', (evt) => {
    // Allow updates for both live and prematch modes
    if (currentMode !== 'live' && currentMode !== 'prematch') return;
    if (!selectedGame) return;
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    const payloadGameId = payload?.gameId;
    const serverGameId = getServerGameId(selectedGame);
    if (!serverGameId || String(payloadGameId) !== String(serverGameId)) return;

    const data = payload?.data || null;
    const marketsMap = data?.market || null;
    if (marketsMap && typeof marketsMap === 'object') {
      selectedGame.market = marketsMap;
    }
    if (typeof data?.markets_count === 'number') {
      selectedGame.markets_count = data.markets_count;
    }

    if (typeof updateGameRowOdds === 'function') {
      const mm = marketsMap ? pickMainMarketFromMap(marketsMap) : null;
      const odds = extract1X2Odds(mm, selectedGame.team1_name, selectedGame.team2_name);
      const marketsCount = typeof data?.market === 'object' ? Object.keys(data.market || {}).length : getMarketsCount(selectedGame);
      updateGameRowOdds(serverGameId, odds, marketsCount);
    }

    if (typeof showGameDetails === 'function') {
      showGameDetails(selectedGame);
    }
  });

  es.addEventListener('error', (evt) => {
    if (!evt || typeof evt.data !== 'string' || !evt.data) return;
    const payload = safeJsonParse(evt.data);
    const msg = payload?.error ? String(payload.error) : '';
    if (!msg) return;
    const now = Date.now();
    if (now - liveGameLastToastAt > 15000) {
      liveGameLastToastAt = now;
      showToast(msg, 'error');
    }
  });

  es.onerror = () => {
    // Stop if not in live or prematch mode
    if (currentMode !== 'live' && currentMode !== 'prematch') {
      stopLiveGameStream();
      return;
    }

    const gid = liveGameId;
    stopLiveGameStream();
    liveGameId = gid;

    const now = Date.now();
    if (now - liveGameLastToastAt > 15000) {
      liveGameLastToastAt = now;
      showToast('Game stream disconnected. Retrying...', 'info');
    }

    liveGameRetryTimeoutId = setTimeout(() => {
      liveGameRetryTimeoutId = null;
      if (currentMode === 'live' || currentMode === 'prematch') startLiveGameStream(gid);
    }, 5000);
  };
}
