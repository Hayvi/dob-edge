const HIERARCHY_CACHE_KEY = 'dob_hierarchy_cache_v1';
const HIERARCHY_CACHE_TTL_MS = 5 * 60 * 1000;

function readHierarchyCache() {
  try {
    const raw = localStorage.getItem(HIERARCHY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const cachedAtMs = Number(parsed.cachedAtMs);
    if (!Number.isFinite(cachedAtMs)) return null;
    if (Date.now() - cachedAtMs > HIERARCHY_CACHE_TTL_MS) return null;
    const data = parsed.data;
    if (!data) return null;
    return data;
  } catch {
    return null;
  }
}

function writeHierarchyCache(data) {
  try {
    localStorage.setItem(HIERARCHY_CACHE_KEY, JSON.stringify({ cachedAtMs: Date.now(), data }));
  } catch {
    return;
  }
}

async function loadHierarchy(forceRefresh = false) {
  const cached = !forceRefresh ? readHierarchyCache() : null;
  if (cached) {
    hierarchy = cached.data || cached;
    renderSportsList();
    updateStats();
    hideLoading();
  } else {
    showLoading('Loading sports hierarchy...');
  }

  try {
    const url = forceRefresh ? '/api/hierarchy?refresh=true' : '/api/hierarchy';
    const response = await fetch(apiUrl(url), { cache: 'no-store' });
    const data = await response.json();
    const nextHierarchy = data.data || data;
    const h = nextHierarchy && typeof nextHierarchy === 'object' ? (nextHierarchy.data || nextHierarchy) : null;
    const sportsNode = h && typeof h === 'object' ? h.sport : null;
    const sportsCount = sportsNode && typeof sportsNode === 'object'
      ? (Array.isArray(sportsNode) ? sportsNode.length : Object.keys(sportsNode).length)
      : 0;

    if (!sportsCount) {
      if (cached) {
        hierarchy = cached.data || cached;
        renderSportsList();
        updateStats();
      }
      if (typeof showToast === 'function') {
        showToast('Failed to load hierarchy (0 sports). Try refresh.', 'error');
      }
      hideLoading();
      return;
    }

    hierarchy = nextHierarchy;
    writeHierarchyCache(hierarchy);

    if (typeof ensureResultsSportsLoaded === 'function') {
      if (currentMode === 'results') {
        await ensureResultsSportsLoaded(true);
      }
    }

    renderSportsList();
    updateStats();
    if (forceRefresh && typeof showToast === 'function') {
      showToast('Fetched fresh data', 'success');
    }
  } catch (error) {
    if (!cached && typeof showToast === 'function') {
      showToast('Failed to load hierarchy: ' + error.message, 'error');
    }
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
