function isLiveStreamActive() {
  return Boolean(liveStreamSource && liveStreamSource.readyState !== 2);
}

function stopLiveStream() {
  if (liveStreamRetryTimeoutId) {
    clearTimeout(liveStreamRetryTimeoutId);
    liveStreamRetryTimeoutId = null;
  }
  if (liveStreamOddsIntervalId) {
    clearInterval(liveStreamOddsIntervalId);
    liveStreamOddsIntervalId = null;
  }
  if (liveStreamDetailsIntervalId) {
    clearInterval(liveStreamDetailsIntervalId);
    liveStreamDetailsIntervalId = null;
  }
  if (liveStreamSource) {
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
  if (liveStreamSource && liveStreamSportId === key && liveStreamSource.readyState !== 2) {
    return;
  }

  stopLiveStream();
  liveStreamSportId = key;

  const query = key ? `?sportId=${encodeURIComponent(key)}&_=${Date.now()}` : `?_=${Date.now()}`;
  const es = new EventSource(`/api/live-stream${query}`);
  liveStreamSource = es;

  es.addEventListener('counts', (evt) => {
    if (currentMode !== 'live') return;
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyLiveCountsPayload(payload);
  });

  es.addEventListener('prematch_counts', (evt) => {
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyPrematchCountsPayload(payload);
  });

  es.addEventListener('games', (evt) => {
    if (currentMode !== 'live') return;
    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyLiveGamesPayload(payload);
  });

  es.addEventListener('odds', (evt) => {
    if (currentMode !== 'live') return;
    liveStreamHasOddsSse = true;
    if (liveStreamOddsIntervalId) {
      clearInterval(liveStreamOddsIntervalId);
      liveStreamOddsIntervalId = null;
    }

    const payload = safeJsonParse(evt?.data);
    if (!payload) return;
    applyLiveOddsPayload(payload);
  });

  es.addEventListener('error', (evt) => {
    if (!evt || typeof evt.data !== 'string' || !evt.data) return;
    const payload = safeJsonParse(evt.data);
    const msg = payload?.error ? String(payload.error) : '';
    if (!msg) return;
    const now = Date.now();
    if (now - liveStreamLastToastAt > 15000) {
      liveStreamLastToastAt = now;
      showToast(msg, 'error');
    }
  });

  es.onerror = () => {
    if (currentMode !== 'live') {
      stopLiveStream();
      return;
    }

    const sid = liveStreamSportId;
    stopLiveStream();
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
