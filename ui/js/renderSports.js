// Rendering
function renderSportsList() {
  if (!hierarchy || !hierarchy.sport) {
    sportsList.innerHTML = '<div class="loading">No sports data available</div>';
    return;
  }

  let allowed = null;
  if (cachedMode) {
    allowed = (sportsWithCachedGames instanceof Set ? sportsWithCachedGames : null);
  } else if (currentMode === 'live') {
    allowed = (sportsWithLiveGames instanceof Set ? sportsWithLiveGames : null);
  } else if (currentMode === 'results') {
    allowed = (sportsWithResults instanceof Set ? sportsWithResults : null);
  } else {
    allowed = (sportsWithPrematchGames instanceof Set ? sportsWithPrematchGames : null);
  }

  const sports = Object.entries(hierarchy.sport).map(([id, sport]) => ({
    id,
    name: sport.name,
    alias: sport.alias,
    order: sport.order || 999
  }))
    .filter(sport => {
      if (currentSport && String(currentSport.id) === String(sport.id)) return true;
      if (!allowed) return true;
      return allowed.has(String(sport.name).toLowerCase());
    })
    .sort((a, b) => a.order - b.order);

  document.getElementById('totalSports').textContent = sports.length;

  let counts;
  if (cachedMode) {
    counts = sportsCountsCached;
  } else if (currentMode === 'live') {
    counts = sportsCountsLive;
  } else if (currentMode === 'results') {
    counts = sportsCountsResults;
  } else {
    counts = sportsCountsPrematch;
  }

  sportsList.innerHTML = sports.map(sport => {
    const isActive = Boolean(currentSport && String(currentSport.id) === String(sport.id));
    const count = counts instanceof Map ? counts.get(String(sport.name).toLowerCase()) : null;
    const countDisplay = count === null || count === undefined ? '' : count;
    return `
    <div class="sport-item ${isActive ? 'active' : ''}" data-id="${sport.id}" data-name="${sport.name}">
      <div class="sport-info">
        <span class="sport-icon">${sportIcons[sport.name] || sportIcons.default}</span>
        <span class="sport-name">${sport.name}</span>
      </div>
      <span class="sport-count">${countDisplay}</span>
    </div>
  `;
  }).join('');

  // Add click handlers
  sportsList.querySelectorAll('.sport-item').forEach(item => {
    item.addEventListener('click', () => {
      sportsList.querySelectorAll('.sport-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      if (currentMode === 'results') {
        loadResultGames(item.dataset.id, item.dataset.name);
      } else if (currentMode === 'prematch') {
        // Use subscription-based stream for prematch (instant!)
        currentSport = { id: item.dataset.id, name: item.dataset.name };
        if (typeof startPrematchStream === 'function') {
          startPrematchStream(item.dataset.id);
        }
        // Show loading state
        welcomeScreen.classList.add('hidden');
        gamesContainer.classList.remove('hidden');
        document.getElementById('selectedSportName').textContent = item.dataset.name;
      } else {
        loadGames(item.dataset.id, item.dataset.name);
      }
      closeMobileSidebar();
    });
  });
}

function filterSports(query) {
  const items = sportsList.querySelectorAll('.sport-item');
  const lowerQuery = query.toLowerCase();
  items.forEach(item => {
    const name = item.dataset.name.toLowerCase();
    item.style.display = name.includes(lowerQuery) ? 'flex' : 'none';
  });
}
