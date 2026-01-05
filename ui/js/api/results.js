// Results API - fetch finished games and settlements

// Results date range state
let resultsDateFrom = null;
let resultsDateTo = null;

function initResultsDateRange() {
  // Default to today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  resultsDateFrom = Math.floor(today.getTime() / 1000);
  resultsDateTo = resultsDateFrom + 86400;
}

function getResultsDateParams() {
  if (!resultsDateFrom || !resultsDateTo) {
    initResultsDateRange();
  }
  return `from=${resultsDateFrom}&to=${resultsDateTo}`;
}

function formatDateForInput(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toISOString().split('T')[0];
}

function onResultsDateChange() {
  const fromInput = document.getElementById('resultsDateFrom');
  const toInput = document.getElementById('resultsDateTo');
  
  if (fromInput && toInput) {
    const fromDate = new Date(fromInput.value);
    fromDate.setHours(0, 0, 0, 0);
    resultsDateFrom = Math.floor(fromDate.getTime() / 1000);
    
    const toDate = new Date(toInput.value);
    toDate.setHours(23, 59, 59, 999);
    resultsDateTo = Math.floor(toDate.getTime() / 1000);
    
    // Refresh sports list with new date range
    if (currentMode === 'results') {
      // Force refresh the results sports to get updated counts
      sportsWithResults = null;
      ensureResultsSportsLoaded(true).then(() => {
        renderSportsList();
      });
      
      // Reload results if a sport is selected
      if (currentSport) {
        loadResultGames(currentSport.id, currentSport.name);
      }
    }
  }
}

function renderResultsDatePicker() {
  if (!resultsDateFrom || !resultsDateTo) {
    initResultsDateRange();
  }
  
  const fromValue = formatDateForInput(resultsDateFrom);
  const toValue = formatDateForInput(resultsDateTo - 1); // -1 to show the actual day, not next day
  
  return `
    <div class="results-date-picker">
      <label>
        <span>From:</span>
        <input type="date" id="resultsDateFrom" value="${fromValue}" onchange="onResultsDateChange()">
      </label>
      <label>
        <span>To:</span>
        <input type="date" id="resultsDateTo" value="${toValue}" onchange="onResultsDateChange()">
      </label>
      <button class="btn btn-small" onclick="setResultsQuickRange('today')">Today</button>
      <button class="btn btn-small" onclick="setResultsQuickRange('yesterday')">Yesterday</button>
      <button class="btn btn-small" onclick="setResultsQuickRange('week')">Last 7 days</button>
    </div>
  `;
}

function setResultsQuickRange(range) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayStart = Math.floor(now.getTime() / 1000);
  
  switch (range) {
    case 'today':
      resultsDateFrom = todayStart;
      resultsDateTo = todayStart + 86400;
      break;
    case 'yesterday':
      resultsDateFrom = todayStart - 86400;
      resultsDateTo = todayStart;
      break;
    case 'week':
      resultsDateFrom = todayStart - (7 * 86400);
      resultsDateTo = todayStart + 86400;
      break;
  }
  
  // Update input fields
  const fromInput = document.getElementById('resultsDateFrom');
  const toInput = document.getElementById('resultsDateTo');
  if (fromInput) fromInput.value = formatDateForInput(resultsDateFrom);
  if (toInput) toInput.value = formatDateForInput(resultsDateTo - 1);
  
  // Refresh sports list with new date range to update sidebar counts
  if (currentMode === 'results') {
    sportsWithResults = null;
    ensureResultsSportsLoaded(true).then(() => {
      renderSportsList();
    });
    
    // Reload results if a sport is selected
    if (currentSport) {
      loadResultGames(currentSport.id, currentSport.name);
    }
  }
}

async function ensureResultsSportsLoaded(forceRefresh = false) {
  if (!forceRefresh && sportsWithResults instanceof Set) return;
  try {
    // Use competitions endpoint for fast initial load (counts will update when sport is clicked)
    const res = await fetch(`/api/results/competitions?${getResultsDateParams()}&_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      sportsWithResults = null;
      sportsCountsResults = null;
      totalGamesResults = null;
      updateModeButtons();
      return;
    }

    const data = await res.json();
    const sports = Array.isArray(data?.data) ? data.data : [];
    
    const names = [];
    const counts = new Map();
    
    for (const sport of sports) {
      if (!sport?.Name) continue;
      const name = String(sport.Name);
      names.push(name);
      // Don't show count initially - will update when sport is clicked
      counts.set(name.toLowerCase(), null);
    }
    
    sportsWithResults = new Set(names.map(s => s.toLowerCase()));
    sportsCountsResults = counts;
    totalGamesResults = null;
    updateModeButtons();
  } catch (e) {
    console.error('Failed to load results sports:', e);
    sportsWithResults = null;
    sportsCountsResults = null;
    totalGamesResults = null;
    updateModeButtons();
  }
}

async function loadResultGames(sportId, sportName) {
  showLoading(`Loading ${sportName} results...`);
  currentSport = { id: sportId, name: sportName };

  try {
    const response = await fetch(`/api/results/games/${sportId}?${getResultsDateParams()}&_=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to load results');
    }

    const games = data.games || [];
    
    // Update sidebar count with actual game count
    if (sportsCountsResults instanceof Map) {
      sportsCountsResults.set(sportName.toLowerCase(), games.length);
      renderSportsList();
    }
    
    // Transform results data to match game structure for rendering
    currentGames = games.map((g, idx) => ({
      __clientId: String(g.game_id || idx),
      id: g.game_id,
      gameId: g.game_id,
      team1_name: g.team1_name,
      team2_name: g.team2_name,
      start_ts: g.date,
      region: g.region_name,
      competition: g.competition_name,
      sport: sportName,
      type: 3, // Results type
      scores: g.scores,
      __isResult: true
    }));

    renderResultGames(sportName, currentGames, data.timestamp);
    showToast(`Loaded ${currentGames.length} finished games`, 'success');
  } catch (error) {
    showToast('Failed to load results: ' + error.message, 'error');
  }
  hideLoading();
}

async function loadGameSettlements(gameId) {
  try {
    const response = await fetch(`/api/results/game/${gameId}?_=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to load settlements');
    }
    
    return data.settlements || [];
  } catch (error) {
    console.error('Failed to load settlements:', error);
    return [];
  }
}

function renderResultGames(sportName, games, timestamp) {
  welcomeScreen.classList.add('hidden');
  gamesContainer.classList.remove('hidden');

  document.getElementById('selectedSportName').innerHTML = `
    ${sportIcons[sportName] || sportIcons.default} ${sportName} - Results
  `;

  document.getElementById('gamesCount').textContent = `${games.length} finished games`;
  document.getElementById('lastUpdated').textContent = timestamp ?
    `Updated: ${new Date(timestamp).toLocaleString()}` : '';

  // Add date picker above the tree
  const regionsTree = document.getElementById('regionsTree');
  
  // Group by region and competition
  const grouped = groupResultGames(games);
  
  // Render date picker + results tree
  regionsTree.innerHTML = renderResultsDatePicker() + renderResultsTreeHTML(grouped);
  document.getElementById('gamesList').innerHTML = '';
  clearGameDetails();
}

function groupResultGames(games) {
  const grouped = {};
  
  for (const game of games) {
    const region = game.region || 'Unknown';
    const competition = game.competition || 'Unknown';
    
    if (!grouped[region]) {
      grouped[region] = { name: region, competitions: {} };
    }
    if (!grouped[region].competitions[competition]) {
      grouped[region].competitions[competition] = { name: competition, games: [] };
    }
    grouped[region].competitions[competition].games.push(game);
  }
  
  return grouped;
}

function renderResultsTreeHTML(grouped) {
  // Sort regions alphabetically
  const sortedRegions = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));
  
  let html = '';
  
  for (const region of sortedRegions) {
    const regionFlag = regionFlags[region.name] || regionFlags.default;
    const competitions = Object.values(region.competitions).sort((a, b) => a.name.localeCompare(b.name));
    const regionGameCount = competitions.reduce((sum, c) => sum + c.games.length, 0);
    
    html += `
      <div class="region-group" data-region="${region.name}">
        <div class="region-header" onclick="toggleResultRegion(this)">
          <span class="region-toggle">▼</span>
          <span class="region-flag">${regionFlag}</span>
          <span class="region-name">${region.name}</span>
          <span class="region-count">${regionGameCount}</span>
        </div>
        <div class="region-content">
    `;
    
    for (const comp of competitions) {
      html += `
        <div class="competition-group" data-competition="${comp.name}">
          <div class="competition-header" onclick="toggleResultCompetition(this)">
            <span class="competition-toggle">▼</span>
            <span class="competition-name">${comp.name}</span>
            <span class="competition-count">${comp.games.length}</span>
          </div>
          <div class="competition-content">
      `;
      
      for (const game of comp.games) {
        const gameDate = new Date(game.start_ts * 1000);
        const dateStr = gameDate.toLocaleDateString();
        const timeStr = gameDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        html += `
          <div class="game-row result-row" data-game-id="${game.__clientId}" onclick="showResultDetails('${game.gameId}', this)">
            <div class="game-teams">
              <span class="team-name">${game.team1_name}</span>
              <span class="vs">vs</span>
              <span class="team-name">${game.team2_name}</span>
            </div>
            <div class="game-score">${game.scores || '-'}</div>
            <div class="game-time">${dateStr} ${timeStr}</div>
          </div>
        `;
      }
      
      html += `
          </div>
        </div>
      `;
    }
    
    html += `
        </div>
      </div>
    `;
  }
  
  return html;
}

function renderResultsTree(grouped) {
  const regionsTree = document.getElementById('regionsTree');
  const gamesList = document.getElementById('gamesList');
  
  regionsTree.innerHTML = renderResultsTreeHTML(grouped);
  gamesList.innerHTML = '';
}

async function showResultDetails(gameId, rowEl) {
  // Highlight selected row
  document.querySelectorAll('.game-row').forEach(r => r.classList.remove('selected'));
  if (rowEl) rowEl.classList.add('selected');
  
  const detailsPanel = document.getElementById('gameDetails');
  const detailsContent = document.getElementById('detailsContent');
  
  // Handle mobile - use openMobileDetails if available
  if (typeof isMobileLayout === 'function' && isMobileLayout()) {
    if (typeof openMobileDetails === 'function') {
      openMobileDetails();
    }
  } else {
    detailsPanel.classList.remove('hidden');
  }
  
  detailsContent.innerHTML = '<div class="loading">Loading settlements...</div>';
  
  const settlements = await loadGameSettlements(gameId);
  
  // Find game info
  const game = currentGames.find(g => String(g.gameId) === String(gameId));
  
  let html = `
    <div class="result-details">
      <div class="result-header">
        <div class="result-teams">
          <span class="team">${game?.team1_name || 'Team 1'}</span>
          <span class="result-score">${game?.scores || '-'}</span>
          <span class="team">${game?.team2_name || 'Team 2'}</span>
        </div>
        <div class="result-meta">
          ${game?.competition || ''} • ${game?.region || ''}
        </div>
      </div>
      <div class="settlements-list">
        <h4>Market Settlements</h4>
  `;
  
  if (settlements.length === 0) {
    html += '<p class="no-settlements">No settlement data available</p>';
  } else {
    // Group settlements by market name
    const grouped = {};
    for (const s of settlements) {
      if (!grouped[s.market]) {
        grouped[s.market] = [];
      }
      grouped[s.market].push(...s.winners);
    }
    
    for (const [market, winners] of Object.entries(grouped)) {
      html += `
        <div class="settlement-item">
          <div class="settlement-market">${market}</div>
          <div class="settlement-winners">
            ${winners.map(w => `<span class="winner-badge">✓ ${w}</span>`).join('')}
          </div>
        </div>
      `;
    }
  }
  
  html += `
      </div>
    </div>
  `;
  
  detailsContent.innerHTML = html;
}

// Helper functions for results tree toggle (separate from main tree toggles)
function toggleResultRegion(header) {
  const group = header.parentElement;
  const content = group.querySelector('.region-content');
  const toggle = header.querySelector('.region-toggle');
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    content.style.display = 'none';
    toggle.textContent = '▶';
  }
}

function toggleResultCompetition(header) {
  const group = header.parentElement;
  const content = group.querySelector('.competition-content');
  const toggle = header.querySelector('.competition-toggle');
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    content.style.display = 'none';
    toggle.textContent = '▶';
  }
}
