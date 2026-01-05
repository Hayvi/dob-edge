function stopLiveTracker() {
  const frame = document.getElementById('liveTrackerFrame');
  const statusEl = document.getElementById('liveTrackerStatus');
  if (statusEl) statusEl.textContent = '';
  if (frame) {
    delete frame.dataset.matchId;
    frame.src = 'about:blank';
  }
  liveTrackerSource = null;
  liveTrackerCurrentGameId = null;
}

function ensureLiveTracker(gameId) {
  const id = String(gameId || '');
  if (!id) return;
  const statusEl = document.getElementById('liveTrackerStatus');
  const frame = document.getElementById('liveTrackerFrame');

  const frameHasMatch = Boolean(frame && frame.dataset && frame.dataset.matchId === id);
  const frameSrcAttr = frame ? frame.getAttribute('src') : '';
  const frameHasSrc = Boolean(frameSrcAttr && frameSrcAttr !== 'about:blank');

  if (liveTrackerCurrentGameId === id && frameHasMatch && frameHasSrc) {
    return;
  }

  if (liveTrackerCurrentGameId !== id) {
    stopLiveTracker();
    liveTrackerCurrentGameId = id;
  }

  if (statusEl) statusEl.textContent = 'Loading...';

  if (!frame) {
    if (statusEl) statusEl.textContent = 'Unavailable';
    return;
  }

  const partnerID = 1777;
  const language = 'eng';
  const widgetUrl = `https://widget-iframe.wadua.io/?partnerID=${encodeURIComponent(String(partnerID))}&matchID=${encodeURIComponent(id)}&language=${encodeURIComponent(language)}&viewMode=single&header=false&timer=true&isAnalyticsOn=false&isLoggerOn=false`;

  frame.dataset.matchId = id;
  frame.onload = () => {
    if (statusEl) statusEl.textContent = 'Live';
  };
  frame.onerror = () => {
    if (statusEl) statusEl.textContent = 'Unavailable';
  };
  frame.src = widgetUrl;
}
