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
