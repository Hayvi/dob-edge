function groupGames(games) {
  const grouped = {};
  games.forEach(game => {
    const region = game.region || 'Other';
    const competition = game.competition || 'Other';
    if (!grouped[region]) grouped[region] = {};
    if (!grouped[region][competition]) grouped[region][competition] = [];
    grouped[region][competition].push(game);
  });
  return grouped;
}

function renderRegionsTree(grouped, options = {}) {
  const regionsTree = document.getElementById('regionsTree');
  const previousState = options && options.restoreState ? options.restoreState : null;

  competitionGamesByKey = new Map();
  virtualLastOptions = options || {};

  if (!virtualResizeBound) {
    virtualResizeBound = true;
    window.addEventListener('resize', () => {
      virtualRowHeightByKey.clear();
      scheduleVirtualUpdate();
    });
  }

  const escapeAttr = (v) => {
    const s = String(v ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  regionsTree.innerHTML = Object.entries(grouped).map(([region, competitions], regionIdx) => {
    const totalGames = Object.values(competitions).reduce((sum, games) => sum + games.length, 0);
    const regionNameAttr = escapeAttr(region);

    return `
      <div class="region-section">
        <div class="region-header" data-region="${regionIdx}" data-region-name="${regionNameAttr}">
          <div class="region-left">
            <span class="region-flag">${regionFlags[region] || regionFlags.default}</span>
            <span class="region-name">${region}</span>
          </div>
          <div class="region-right">
            <span class="region-count">${totalGames}</span>
            <span class="chevron">▼</span>
          </div>
        </div>
        <div class="competitions-container" data-region="${regionIdx}" data-region-name="${regionNameAttr}">
          ${Object.entries(competitions).map(([comp, games], compIdx) => {
      const compNameAttr = escapeAttr(comp);
      const vkey = `${region}|||${comp}`;
      const vkeyAttr = escapeAttr(vkey);
      competitionGamesByKey.set(vkey, games);
      return `
            <div class="competition-section">
              <div class="competition-header" data-comp="${regionIdx}-${compIdx}" data-region-name="${regionNameAttr}" data-comp-name="${compNameAttr}">
                <span>${comp}</span>
                <div class="region-right">
                  <span class="region-count">${games.length}</span>
                  <span class="chevron">▼</span>
                </div>
              </div>
              <div class="games-in-competition" data-comp="${regionIdx}-${compIdx}" data-region-name="${regionNameAttr}" data-comp-name="${compNameAttr}" data-vkey="${vkeyAttr}" data-virtual-start="0" data-virtual-end="0">
                <div class="virtual-spacer-top"></div>
                <div class="virtual-items"></div>
                <div class="virtual-spacer-bottom"></div>
              </div>
            </div>
          `;
    }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers for regions
  regionsTree.querySelectorAll('.region-header').forEach(header => {
    header.addEventListener('click', () => toggleRegion(header));
  });

  // Add click handlers for competitions
  regionsTree.querySelectorAll('.competition-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompetition(header);
    });
  });

  if (!regionsTree.__delegatedGameClick) {
    regionsTree.__delegatedGameClick = true;
    regionsTree.addEventListener('click', (e) => {
      const row = e.target && typeof e.target.closest === 'function' ? e.target.closest('.game-row') : null;
      if (!row || !regionsTree.contains(row)) return;
      e.stopPropagation();
      const gameId = row.dataset.gameId;
      const game = Array.isArray(currentGames) ? currentGames.find(g => String(g.__clientId) === String(gameId)) : null;
      if (game) selectGame(game, row);
    });
  }

  const scrollEl = getVirtualScrollEl();
  if (scrollEl && !virtualScrollBound) {
    virtualScrollBound = true;
    scrollEl.addEventListener('scroll', () => scheduleVirtualUpdate(), { passive: true });
  }

  restoreRegionsTreeState(previousState, options);

  updateAllVirtualCompetitions(options);
}

function toggleRegion(header) {
  const regionIdx = header.dataset.region;
  const container = document.querySelector(`.competitions-container[data-region="${regionIdx}"]`);

  if (!container) return;

  header.classList.toggle('expanded');
  container.classList.toggle('expanded');
}

function toggleCompetition(header) {
  const compIdx = header.dataset.comp;
  const container = document.querySelector(`.games-in-competition[data-comp="${compIdx}"]`);

  if (!container) return;

  header.classList.toggle('expanded');
  container.classList.toggle('expanded');

  if (container.classList.contains('expanded')) {
    ensureCompetitionVirtualized(container, virtualLastOptions);
    scheduleVirtualUpdate();
    const liveOddsSse = (typeof liveStreamHasOddsSse !== 'undefined') && Boolean(liveStreamHasOddsSse);
    const prematchOddsSse = (typeof prematchStreamHasOddsSse !== 'undefined') && Boolean(prematchStreamHasOddsSse);
    if (currentMode === 'live' && liveOddsSse) return;
    if (currentMode === 'prematch' && prematchOddsSse) return;
  }
}
