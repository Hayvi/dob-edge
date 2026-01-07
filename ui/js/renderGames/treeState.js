function snapshotRegionsTreeState() {
  const regionsTree = document.getElementById('regionsTree');
  const expandedRegions = new Set();
  const expandedCompetitions = new Set();
  if (!regionsTree) return { expandedRegions, expandedCompetitions };

  const pickRegionName = (header) => {
    if (!header) return '';
    const dn = header.dataset ? header.dataset.regionName : '';
    if (dn) return dn;
    const el = header.querySelector('.region-name');
    return el ? String(el.textContent || '').trim() : '';
  };

  const pickCompName = (header) => {
    if (!header) return '';
    const dn = header.dataset ? header.dataset.compName : '';
    if (dn) return dn;
    const span = header.querySelector('span');
    return span ? String(span.textContent || '').trim() : '';
  };

  regionsTree.querySelectorAll('.region-header.expanded').forEach(header => {
    const name = pickRegionName(header);
    if (name) expandedRegions.add(name);
  });

  regionsTree.querySelectorAll('.competition-header.expanded').forEach(header => {
    const regionName = header.dataset ? header.dataset.regionName : '';
    const compName = pickCompName(header);
    if (regionName && compName) expandedCompetitions.add(`${regionName}|||${compName}`);
  });

  return { expandedRegions, expandedCompetitions };
}

function resolveCompetitionIdFromContainer(container) {
  if (!container) return null;
  const existing = container.dataset ? container.dataset.competitionId : null;
  if (existing) return existing;
  const vkey = container.dataset ? container.dataset.vkey : null;
  if (!vkey) return null;
  const games = typeof competitionGamesByKey !== 'undefined' && competitionGamesByKey ? competitionGamesByKey.get(String(vkey)) : null;
  if (!Array.isArray(games) || games.length === 0) return null;
  const g = games.find(x => x && (x.competition_id || x.competitionId || (x.competition && x.competition.id))) || games[0];
  const cid = g ? (g.competition_id || g.competitionId || (g.competition && g.competition.id)) : null;
  if (!cid) return null;
  const idStr = String(cid);
  if (container.dataset) container.dataset.competitionId = idStr;
  return idStr;
}

function maybeStartCompetitionOddsForContainer(container) {
  if (!container) return;
  if (typeof startCompetitionOddsStream !== 'function') return;
  if (!currentSport?.id) return;
  const competitionId = resolveCompetitionIdFromContainer(container);
  if (!competitionId) return;
  startCompetitionOddsStream({
    competitionId,
    sportId: currentSport.id,
    sportName: currentSport?.name || '',
    mode: currentMode
  });
}

function maybeStopCompetitionOddsForContainer(container) {
  if (!container) return;
  if (typeof stopCompetitionOddsStream !== 'function') return;
  const competitionId = container.dataset ? container.dataset.competitionId : null;
  if (!competitionId) return;
  stopCompetitionOddsStream(competitionId, currentMode);
}

function restoreRegionsTreeState(state, options = {}) {
  const regionsTree = document.getElementById('regionsTree');
  if (!regionsTree || !state) return;
  const liveOddsSse = (typeof liveStreamHasOddsSse !== 'undefined') && Boolean(liveStreamHasOddsSse);
  const prematchOddsSse = (typeof prematchStreamHasOddsSse !== 'undefined') && Boolean(prematchStreamHasOddsSse);
  const oddsSseActive = (currentMode === 'live' && liveOddsSse) || (currentMode === 'prematch' && prematchOddsSse);
  const shouldHydrate = Boolean(options && options.hydrateMainMarkets) && !oddsSseActive;

  const esc = (v) => {
    const s = String(v ?? '');
    try {
      return CSS.escape(s);
    } catch (e) {
      return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }
  };

  const expandedRegions = state.expandedRegions instanceof Set ? state.expandedRegions : new Set();
  const expandedCompetitions = state.expandedCompetitions instanceof Set ? state.expandedCompetitions : new Set();

  expandedRegions.forEach(regionName => {
    const header = regionsTree.querySelector(`.region-header[data-region-name="${esc(regionName)}"]`);
    const container = regionsTree.querySelector(`.competitions-container[data-region-name="${esc(regionName)}"]`);
    if (header) header.classList.add('expanded');
    if (container) container.classList.add('expanded');
  });

  expandedCompetitions.forEach(key => {
    const [regionName, compName] = String(key).split('|||');
    if (!regionName || !compName) return;
    const header = regionsTree.querySelector(`.competition-header[data-region-name="${esc(regionName)}"][data-comp-name="${esc(compName)}"]`);
    const container = regionsTree.querySelector(`.games-in-competition[data-region-name="${esc(regionName)}"][data-comp-name="${esc(compName)}"]`);
    if (header) header.classList.add('expanded');
    if (container) {
      container.classList.add('expanded');
      ensureCompetitionVirtualized(container, options);
      maybeStartCompetitionOddsForContainer(container);
      if (shouldHydrate && typeof hydrateMainMarketsInContainer === 'function') {
        hydrateMainMarketsInContainer(container);
      }
    }
  });

  const selectedServerGameId = options ? options.selectedServerGameId : null;
  if (selectedServerGameId) {
    const row = regionsTree.querySelector(`.game-row[data-server-game-id="${esc(selectedServerGameId)}"]`);
    if (row) row.classList.add('selected');
  }
}
