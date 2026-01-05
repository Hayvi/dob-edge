async function loadHierarchy(forceRefresh = false) {
  showLoading('Loading sports hierarchy...');
  try {
    const url = forceRefresh ? '/api/hierarchy?refresh=true' : '/api/hierarchy';
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    hierarchy = data.data || data;

    if (typeof ensureResultsSportsLoaded === 'function') {
      await ensureResultsSportsLoaded(true);
    }

    renderSportsList();
    updateStats();
    showToast('Fetched fresh data', 'success');
  } catch (error) {
    showToast('Failed to load hierarchy: ' + error.message, 'error');
  }
  hideLoading();
}

function updateModeButtons() {
  const prematchEl = document.getElementById('modePrematch');
  const liveEl = document.getElementById('modeLive');
  const resultsEl = document.getElementById('modeResults');

  if (prematchEl) {
    prematchEl.textContent = Number.isFinite(totalGamesPrematch) ? `Prematch (${totalGamesPrematch})` : 'Prematch';
  }
  if (liveEl) {
    liveEl.textContent = Number.isFinite(totalGamesLive) ? `Live (${totalGamesLive})` : 'Live';
  }
  if (resultsEl) {
    resultsEl.textContent = Number.isFinite(totalGamesResults) ? `Results (${totalGamesResults})` : 'Results';
  }
}
