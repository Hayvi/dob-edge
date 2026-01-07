let competitionOddsSources = new Map();

function compOddsKey(mode, competitionId) {
  return `${String(mode || '')}:${String(competitionId || '')}`;
}

function stopCompetitionOddsStream(competitionId, mode = null) {
  try {
    const m = mode || currentMode;
    const key = compOddsKey(m, competitionId);
    const es = competitionOddsSources.get(key);
    if (es) {
      try {
        es.close();
      } catch {
        // ignore
      }
      competitionOddsSources.delete(key);
    }
  } catch {
    return;
  }
}

function stopAllCompetitionOddsStreams() {
  try {
    for (const es of competitionOddsSources.values()) {
      try {
        es.close();
      } catch {
        // ignore
      }
    }
    competitionOddsSources.clear();
  } catch {
    return;
  }
}

function startCompetitionOddsStream(params) {
  try {
    if (!params) return;
    if (currentMode !== 'live' && currentMode !== 'prematch') return;

    const competitionId = params.competitionId;
    const sportId = params.sportId;
    const sportName = params.sportName || '';
    const mode = params.mode || currentMode;

    if (!competitionId || !sportId) return;

    const key = compOddsKey(mode, competitionId);
    const existing = competitionOddsSources.get(key);
    if (existing && existing.readyState !== 2) return;

    stopCompetitionOddsStream(competitionId, mode);

    const query = `?competitionId=${encodeURIComponent(String(competitionId))}` +
      `&sportId=${encodeURIComponent(String(sportId))}` +
      `&sportName=${encodeURIComponent(String(sportName))}` +
      `&mode=${encodeURIComponent(String(mode))}` +
      `&_=${Date.now()}`;

    const es = new EventSource(apiUrl(`/api/competition-odds-stream${query}`));
    competitionOddsSources.set(key, es);

    es.addEventListener('odds', (evt) => {
      if (currentMode !== mode) return;
      if (!evt || typeof evt.data !== 'string') return;
      const payload = safeJsonParse(evt.data);
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
      if (typeof showToast === 'function') {
        showToast(msg, 'error');
      }
    });

    es.onerror = () => {
      if (currentMode !== mode) {
        stopCompetitionOddsStream(competitionId, mode);
      }
    };
  } catch {
    return;
  }
}
