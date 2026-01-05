function refreshLiveOddsOnce() {
  if (currentMode !== 'live') return;
  const regionsTree = document.getElementById('regionsTree');
  if (!regionsTree) return;

  const containers = Array.from(regionsTree.querySelectorAll('.games-in-competition.expanded'));
  const now = Date.now();

  containers.forEach(container => {
    const last = Number(container.dataset?.lastHydrateAt) || 0;
    if (now - last < 6000) return;
    container.dataset.lastHydrateAt = String(now);
    if (typeof hydrateMainMarketsInContainer === 'function') {
      hydrateMainMarketsInContainer(container);
    }
  });
}

function refreshSelectedLiveGameDetailsOnce() {
  if (currentMode !== 'live') return;
  if (!selectedGame) return;
  if (isLiveGameStreamActive()) return;
  const serverGameId = getServerGameId(selectedGame);
  if (!serverGameId) return;

  if (typeof startLiveGameStream === 'function') {
    startLiveGameStream(serverGameId);
  }
}
