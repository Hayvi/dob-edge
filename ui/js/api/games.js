function filterPrematchGames(games) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec + (5 * 60);
  return (Array.isArray(games) ? games : []).filter(g => {
    const ts = Number(g?.start_ts);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    return ts > cutoffSec;
  });
}

async function loadGames(sportId, sportName) {
  if (typeof stopLiveGameStream === 'function') {
    stopLiveGameStream();
  }
  if (typeof clearGameDetails === 'function') {
    clearGameDetails();
  }
  selectedGame = null;

  showLoading(`Subscribing to ${sportName}...`);
  currentSport = { id: sportId, name: sportName };

  if (typeof stopAllCompetitionOddsStreams === 'function') {
    stopAllCompetitionOddsStreams();
  }

  try {
    // Show the content shell immediately; actual games come from SSE.
    welcomeScreen.classList.add('hidden');
    gamesContainer.classList.remove('hidden');
    document.getElementById('selectedSportName').textContent = sportName;
    document.getElementById('gamesCount').textContent = 'Loading games...';
    document.getElementById('lastUpdated').textContent = '';
    const regionsTree = document.getElementById('regionsTree');
    if (regionsTree) {
      regionsTree.innerHTML = '<div class="loading">Loading games...</div>';
    }

    if (currentMode === 'live' && typeof startLiveStream === 'function') {
      startLiveStream(sportId);
    }
    if (currentMode === 'prematch' && typeof startPrematchStream === 'function') {
      startPrematchStream(sportId);
    }
  } catch (error) {
    showToast('Failed to load games: ' + error.message, 'error');
  }
  hideLoading();
}

async function loadLiveGames(sportId, sportName) {
  return loadGames(sportId, sportName);
}
