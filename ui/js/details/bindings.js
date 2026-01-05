function bindDetailsTabHandlers(game, content) {
  content.querySelectorAll('.market-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      game.__activeTab = btn.dataset.tab;
      if (!game.__detailsUiState || typeof game.__detailsUiState !== 'object') game.__detailsUiState = {};
      game.__detailsUiState.activeTab = String(game.__activeTab);
      game.__detailsUiState.scrollTop = 0;
      showGameDetails(game);
    });
  });
}

function bindDetailsMarketAccordionHandlers(game, content, allMarkets) {
  content.querySelectorAll('.market-header').forEach(header => {
    header.addEventListener('click', () => {
      const marketId = header.dataset.marketId;
      if (!marketId) return;
      const section = content.querySelector(`.market-section[data-market-id="${CSS.escape(String(marketId))}"]`);
      if (!section) return;
      const market = allMarkets.find(m => String(m?.id) === String(marketId));
      if (!market) return;

      const isCollapsed = section.classList.contains('collapsed');
      if (isCollapsed) {
        section.classList.remove('collapsed');
        if (!game.__detailsUiState || typeof game.__detailsUiState !== 'object') game.__detailsUiState = {};
        const st = game.__detailsUiState;
        if (!Array.isArray(st.collapsedMarketIds)) st.collapsedMarketIds = [];
        if (!Array.isArray(st.expandedMarketIds)) st.expandedMarketIds = [];
        const mid = String(marketId);
        st.collapsedMarketIds = st.collapsedMarketIds.filter(x => String(x) !== mid);
        if (!st.expandedMarketIds.some(x => String(x) === mid)) st.expandedMarketIds.push(mid);
      } else {
        section.classList.add('collapsed');
        if (!game.__detailsUiState || typeof game.__detailsUiState !== 'object') game.__detailsUiState = {};
        const st = game.__detailsUiState;
        if (!Array.isArray(st.collapsedMarketIds)) st.collapsedMarketIds = [];
        if (!Array.isArray(st.expandedMarketIds)) st.expandedMarketIds = [];
        const mid = String(marketId);
        st.expandedMarketIds = st.expandedMarketIds.filter(x => String(x) !== mid);
        if (!st.collapsedMarketIds.some(x => String(x) === mid)) st.collapsedMarketIds.push(mid);
      }
    });
  });
}
