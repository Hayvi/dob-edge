function snapshotDetailsUiStateFromDom(game, content) {
  const prevState = (game.__detailsUiState && typeof game.__detailsUiState === 'object')
    ? game.__detailsUiState
    : {};

  const domActiveBtn = content ? content.querySelector('.market-tab-btn.active') : null;
  const domActiveTab = domActiveBtn && domActiveBtn.dataset ? domActiveBtn.dataset.tab : null;

  const collapsedMarketIds = [];
  const expandedMarketIds = [];

  if (content) {
    content.querySelectorAll('.market-section[data-market-id]').forEach(el => {
      const mid = el.dataset ? el.dataset.marketId : null;
      if (!mid) return;
      if (el.classList.contains('collapsed')) collapsedMarketIds.push(String(mid));
      else expandedMarketIds.push(String(mid));
    });
  } else {
    if (Array.isArray(prevState.collapsedMarketIds)) collapsedMarketIds.push(...prevState.collapsedMarketIds.map(String));
    if (Array.isArray(prevState.expandedMarketIds)) expandedMarketIds.push(...prevState.expandedMarketIds.map(String));
  }

  const activeTab = game.__activeTab
    ? game.__activeTab
    : (domActiveTab || prevState.activeTab || null);
  const scrollTop = (typeof prevState.scrollTop === 'number' && Number.isFinite(prevState.scrollTop))
    ? prevState.scrollTop
    : (content ? content.scrollTop : 0);

  game.__detailsUiState = {
    activeTab: activeTab ? String(activeTab) : null,
    collapsedMarketIds,
    expandedMarketIds,
    scrollTop: Number(scrollTop) || 0
  };

  if (activeTab) game.__activeTab = String(activeTab);

  return game.__detailsUiState;
}

function restoreDetailsScrollFromState(game, content) {
  const st = (game.__detailsUiState && typeof game.__detailsUiState === 'object')
    ? game.__detailsUiState
    : null;
  if (st && typeof st.scrollTop === 'number' && Number.isFinite(st.scrollTop)) {
    content.scrollTop = st.scrollTop;
  }
}

function bindDetailsScrollPersist(game, content) {
  content.onscroll = () => {
    if (!game.__detailsUiState || typeof game.__detailsUiState !== 'object') game.__detailsUiState = {};
    game.__detailsUiState.scrollTop = Number(content.scrollTop) || 0;
  };
}
