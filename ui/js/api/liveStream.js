let liveStreamListeners = []; // Track listeners for proper cleanup

// Add global cleanup function for intervals
function clearLiveStreamIntervals() {
  if (liveStreamOddsIntervalId) {
    clearInterval(liveStreamOddsIntervalId);
    liveStreamOddsIntervalId = null;
  }
  if (liveStreamDetailsIntervalId) {
    clearInterval(liveStreamDetailsIntervalId);
    liveStreamDetailsIntervalId = null;
  }
}

function isLiveStreamActive() {
  return Boolean(liveStreamSource && liveStreamSource.readyState !== 2);
}

function stopLiveStream() {
  if (liveStreamRetryTimeoutId) {
    clearTimeout(liveStreamRetryTimeoutId);
    liveStreamRetryTimeoutId = null;
  }
  
  // Clear intervals using the dedicated function
  clearLiveStreamIntervals();
  
  if (liveStreamSource) {
    // Remove all listeners before closing to prevent memory leaks
    for (const { type, listener } of liveStreamListeners) {
      liveStreamSource.removeEventListener(type, listener);
    }
    liveStreamListeners = [];
    liveStreamSource.close();
  }
  liveStreamSource = null;
  liveStreamSportId = null;
  liveStreamHasOddsSse = false;

  stopLiveGameStream();
}

function startLiveStream(sportId) {
  if (currentMode !== 'live') return;

  const key = sportId ? String(sportId) : null;
  if (!key) {
    stopLiveStream();
    return;
  }
  if (liveStreamSource && liveStreamSportId === key && liveStreamSource.readyState !== 2) {
    return;
  }

  stopLiveStream();
  liveStreamSportId = key;

  const query = `?sportId=${encodeURIComponent(key)}&_=${Date.now()}`;
  const es = new EventSource(apiUrl(`/api/live-stream${query}`));
  liveStreamSource = es;

  const countsListener = (evt) => {
    if (currentMode !== 'live') return;
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyLiveCountsPayload(payload);
  };

  const prematchCountsListener = (evt) => {
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyPrematchCountsPayload(payload);
  };

  const gamesListener = (evt) => {
    if (currentMode !== 'live') return;
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyLiveGamesPayload(payload);
  };

  const oddsListener = (evt) => {
    if (currentMode !== 'live') return;
    liveStreamHasOddsSse = true;
    if (liveStreamOddsIntervalId) {
      clearInterval(liveStreamOddsIntervalId);
      liveStreamOddsIntervalId = null;
    }

    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyLiveOddsPayload(payload);
  };

  const errorListener = (evt) => {
    if (!evt || typeof evt.data !== 'string' || !evt.data) return;
    const payload = safeJsonParse(evt.data);
    const msg = payload?.error ? String(payload.error) : '';
    if (!msg) return;
    const now = Date.now();
    if (now - liveStreamLastToastAt > 15000) {
      liveStreamLastToastAt = now;
      showToast(msg, 'error');
    }
  };

  const onerrorHandler = () => {
    if (currentMode !== 'live') {
      stopLiveStream();
      return;
    }

    const sid = liveStreamSportId;
    stopLiveStream(); // This will clear intervals via clearLiveStreamIntervals()
    liveStreamSportId = sid;

    const now = Date.now();
    if (now - liveStreamLastToastAt > 15000) {
      liveStreamLastToastAt = now;
      showToast('Live stream disconnected. Falling back to polling...', 'info');
    }

    liveStreamRetryTimeoutId = setTimeout(() => {
      liveStreamRetryTimeoutId = null;
      if (currentMode === 'live') startLiveStream(sid);
    }, 5000);
  };

  // Add listeners and track them for cleanup
  es.addEventListener('counts', countsListener);
  liveStreamListeners.push({ type: 'counts', listener: countsListener });

  es.addEventListener('prematch_counts', prematchCountsListener);
  liveStreamListeners.push({ type: 'prematch_counts', listener: prematchCountsListener });

  es.addEventListener('games', gamesListener);
  liveStreamListeners.push({ type: 'games', listener: gamesListener });

  es.addEventListener('odds', oddsListener);
  liveStreamListeners.push({ type: 'odds', listener: oddsListener });

  es.addEventListener('error', errorListener);
  liveStreamListeners.push({ type: 'error', listener: errorListener });

  // Note: onerror is a property, not an event listener, so it doesn't need tracking
  es.onerror = onerrorHandler;

  liveStreamOddsIntervalId = setInterval(() => {
    if (currentMode !== 'live' || !isLiveStreamActive()) return;
    if (liveStreamHasOddsSse) return;
    refreshLiveOddsOnce();
  }, 6000);

  liveStreamDetailsIntervalId = setInterval(() => {
    if (currentMode !== 'live' || !isLiveStreamActive()) return;
    refreshSelectedLiveGameDetailsOnce();
  }, 30000);
}