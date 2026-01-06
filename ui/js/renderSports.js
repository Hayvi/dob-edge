// Rendering
function renderSportsList() {
  if (!hierarchy || !hierarchy.sport) {
    sportsList.innerHTML = '<div class="loading">No sports data available</div>';
    return;
  }

  const sports = Object.entries(hierarchy.sport).map(([id, sport]) => ({
    id: (sport && sport.id !== undefined && sport.id !== null && sport.id !== '') ? String(sport.id) : id,
    name: sport.name,
    alias: sport.alias,
    order: sport.order || 999
  }))
    .sort((a, b) => a.order - b.order);

  document.getElementById('totalSports').textContent = sports.length;

  let counts;
  if (currentMode === 'live') {
    counts = sportsCountsLive;
  } else if (currentMode === 'results') {
    counts = sportsCountsResults;
  } else {
    counts = sportsCountsPrematch;
  }

  sportsList.innerHTML = sports.map(sport => {
    const isActive = Boolean(currentSport && String(currentSport.id) === String(sport.id));
    const key = String(sport.name).toLowerCase();
    let count = counts instanceof Map ? counts.get(key) : null;
    if ((currentMode === 'live' || currentMode === 'prematch') && counts instanceof Map) {
      if (count === null || count === undefined) count = 0;
    }
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
