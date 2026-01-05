function clearGameDetails() {
  stopLiveTracker();
  if (typeof stopLiveGameStream === 'function') {
    stopLiveGameStream();
  }
  const content = document.getElementById('detailsContent');
  content.innerHTML = `
    <div class="empty-details">
      <div class="empty-icon">🎯</div>
      <p>Select a game to view details</p>
    </div>
  `;

  content.scrollTop = 0;
}

function showGameDetails(game) {
  const content = document.getElementById('detailsContent');

  if (typeof snapshotDetailsUiStateFromDom === 'function') {
    snapshotDetailsUiStateFromDom(game, content);
  }
  const startTime = game.start_ts ? new Date(game.start_ts * 1000) : null;
  const team1 = game.team1_name || game.name || 'Team 1';
  const team2 = game.team2_name || (game.team1_name ? 'Team 2' : '-');

  // Team shirt colors
  const info = game.info || {};
  const shirt1 = info.shirt1_color || '';
  const shirt2 = info.shirt2_color || '';
  const renderTeamColor = (color) => {
    if (!color || color === '000000') return '';
    return `<span class="team-color-lg" style="background-color: #${color}"></span>`;
  };
  
  // Game-level blocked state
  const isGameBlocked = game.is_blocked === true || game.is_blocked === 1;

  const isLive = Number(game?.type) === 1;
  const liveMeta = isLive && typeof getLiveMeta === 'function' ? getLiveMeta(game) : null;
  const liveParts = liveMeta ? [liveMeta.scoreText, liveMeta.timeText].filter(Boolean) : [];
  
  // Add period scores to the header if available
  let periodScoresText = '';
  if (liveMeta?.periodScores && liveMeta.periodScores.length > 0) {
    periodScoresText = liveMeta.periodScores.map(p => `(${p.home}:${p.away})`).join(' ');
  }
  
  const suspendedBadge = isGameBlocked ? '<span class="suspended-badge">🔒 SUSPENDED</span>' : '';
  const headerTimeText = isLive
    ? `LIVE${liveParts.length ? ` ${liveParts.join(' ')}` : ''}${periodScoresText ? `<br><span class="period-scores">${periodScoresText}</span>` : ''}${suspendedBadge ? `<br>${suspendedBadge}` : ''}`
    : (startTime ? startTime.toLocaleString() : '-') + (isGameBlocked ? `<br>${suspendedBadge}` : '');

  const hasMarkets = Boolean(game.market && Object.keys(game.market).length > 0);
  const serverGameId = game.id || game.gameId;
  if (!hasMarkets && serverGameId) {
    const liveTrackerHtml = isLive ? `
      <div class="live-tracker" id="liveTracker">
        <div class="live-tracker-head">
          <div class="live-tracker-title">Live Tracker</div>
          <div class="live-tracker-meta">
            <span id="liveTrackerStatus" class="live-tracker-status">Loading...</span>
          </div>
        </div>
        <iframe
          id="liveTrackerFrame"
          class="live-tracker-iframe"
          src="about:blank"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          allowfullscreen
        ></iframe>
      </div>
    ` : '';

    content.innerHTML = `
      <div class="match-header">
        <div class="match-competition">${game.competition || '-'}</div>
        <div class="match-teams-detail">
          <span class="detail-team">${renderTeamColor(shirt1)}${team1}</span>
          <span class="vs-text">vs</span>
          <span class="detail-team">${renderTeamColor(shirt2)}${team2}</span>
        </div>
        <div class="match-time-detail">
          ${headerTimeText}
        </div>
      </div>
      ${liveTrackerHtml}
      <div class="loading">Loading markets...</div>
    `;

    if (isLive) {
      ensureLiveTracker(serverGameId);
    } else {
      stopLiveTracker();
    }

    if (typeof startLiveGameStream === 'function') {
      startLiveGameStream(serverGameId);
    }
    return;
  }

  const marketsMap = game.market || {};
  const allMarkets = Object.values(marketsMap).slice().sort(sortByOrderAsc);
  const mainMarket = pickMainMarketFromMap(marketsMap);
  const mainId = mainMarket?.id;

  const prevEventPrices = game.__prevEventPrices instanceof Map ? game.__prevEventPrices : new Map();
  const nextEventPrices = new Map();
  const getMoveMeta = (marketId, eventKey, rawPrice) => {
    const key = `${String(marketId ?? '')}:${String(eventKey ?? '')}`;
    const prev = prevEventPrices.get(key);
    const prevNum = Number.parseFloat(String(prev ?? ''));
    const nextNum = Number.parseFloat(String(rawPrice ?? ''));
    if (Number.isFinite(nextNum)) nextEventPrices.set(key, nextNum);
    if (Number.isFinite(prevNum) && Number.isFinite(nextNum) && prevNum !== nextNum) {
      const up = nextNum > prevNum;
      return { cls: up ? 'odd-up' : 'odd-down', arrow: up ? '▲' : '▼' };
    }
    return { cls: '', arrow: '' };
  };

  // --- Helper Functions ---
  const norm = (v) => String(v || '').trim().toLowerCase();
  const isOver = (e) => {
    const n = norm(e?.name);
    const t = norm(e?.type);
    return n === 'over' || n === 'o' || n.includes('over') || t.includes('over');
  };
  const isUnder = (e) => {
    const n = norm(e?.name);
    const t = norm(e?.type);
    return n === 'under' || n === 'u' || n.includes('under') || t.includes('under');
  };
  const isOverUnderLineMarket = (market) => {
    if (!market) return false;
    if (market?.col_count && Number(market.col_count) !== 2) return false;
    const events = market?.event ? Object.values(market.event) : [];
    if (events.length < 2) return false;
    const hasBase = events.some(e => e?.base !== undefined && e?.base !== null && e?.base !== '');
    if (!hasBase) return false;
    const hasOU = events.some(isOver) && events.some(isUnder);
    return hasOU;
  };

  // --- Market Categorization ---
  // We'll group markets into tabs: All, Match, Totals, Handicaps, Combos/Others
  // Note: "All" is a virtual tab that shows everything (or filtered). 
  // For now, let's just make specific tabs.

  const categories = {
    'All': [],
    'Match': [],
    'Totals': [],
    'Handicaps': [],
    'Halves': []
  };

  // Helper to categorize
  const categorizeMarket = (m) => {
    const name = norm(m?.name);
    const type = norm(m?.type);

    // Always add to All
    categories['All'].push(m);

    // Match - 1X2, DC, BTTS, DNB, Scores
    if (name.includes('1x2') || name.includes('winner') || name.includes('double chance') || name.includes('draw no bet') || name.includes('both teams to score') || name.includes('correct score') || name.includes('match result')) {
      categories['Match'].push(m);
      return;
    }

    // Handicaps
    if (name.includes('handicap') || type.includes('handicap')) {
      categories['Handicaps'].push(m);
      return;
    }

    // Totals
    if (name.includes('total') || name.includes('over') || name.includes('under') || name.includes('goal')) {
      categories['Totals'].push(m);
      return;
    }

    // Halves
    if (name.includes('half') || name.includes('1st') || name.includes('2nd')) {
      categories['Halves'].push(m);
    }
  };

  allMarkets.forEach(categorizeMarket);

  const tabKeys = Object.keys(categories);

  if (game.__activeTab && !tabKeys.includes(String(game.__activeTab))) {
    game.__activeTab = 'All';
  }

  if (!game.__activeTab) game.__activeTab = 'All';

  if (!game.__detailsUiState || typeof game.__detailsUiState !== 'object') game.__detailsUiState = {};
  game.__detailsUiState.activeTab = String(game.__activeTab);

  // Render Tabs
  const renderTabs = () => {
    const tabs = Object.keys(categories).filter(k => k === 'All' || categories[k].length > 0 || String(game.__activeTab) === String(k));
    return `
      <div class="market-tabs">
        ${tabs.map(tab => `
          <button class="market-tab-btn ${game.__activeTab === tab ? 'active' : ''}" data-tab="${tab}">
            ${tab} <span class="tab-count">${categories[tab].length}</span>
          </button>
        `).join('')}
      </div>
    `;
  };

  // --- Merge Logic ---
  const mergeMarkets = (marketList) => {
    const mergedMap = new Map();
    marketList.forEach(m => {
      const key = String(m.name || '').trim();
      if (!mergedMap.has(key)) {
        mergedMap.set(key, { ...m, event: { ...m.event } });
      } else {
        const existing = mergedMap.get(key);
        Object.assign(existing.event, m.event);
      }
    });
    return Array.from(mergedMap.values());
  };

  const visibleMarketsRaw = categories[game.__activeTab] || allMarkets;
  const visibleMarkets = mergeMarkets(visibleMarketsRaw);

  // --- Specialized Renderers ---

  const renderMarketEventsHtml = (market) => {
    return renderDetailsMarketEventsHtml(market, {
      team1,
      team2,
      norm,
      sortByOrderAsc,
      getMoveMeta,
      formatOddValue,
      isOverUnderLineMarket,
      isOver,
      isUnder,
      isGameBlocked
    });
  };

  const renderMarketSection = (market) => {
    const isMain = String(market.id) === String(mainId);
    const defaultExpanded = isMain || game.__activeTab !== 'All';
    let expanded = defaultExpanded;

    const st = (game.__detailsUiState && typeof game.__detailsUiState === 'object')
      ? game.__detailsUiState
      : null;
    const mid = String(market?.id ?? '');
    const expandedIds = st && Array.isArray(st.expandedMarketIds) ? st.expandedMarketIds : null;
    const collapsedIds = st && Array.isArray(st.collapsedMarketIds) ? st.collapsedMarketIds : null;
    if (expandedIds && expandedIds.some(x => String(x) === mid)) expanded = true;
    if (collapsedIds && collapsedIds.some(x => String(x) === mid)) expanded = false;

    return `
      <div class="market-section ${expanded ? '' : 'collapsed'}" data-market-id="${market?.id}">
        <div class="market-header" data-market-id="${market?.id}">
          <span>${market?.name || 'Market'}</span>
          <span class="market-arrow">▼</span>
        </div>
        <div class="market-events-container">
            ${renderMarketEventsHtml(market)}
        </div>
      </div>
    `;
  };

  const marketsHtml = visibleMarkets.map(m => renderMarketSection(m)).join('');

  const liveTrackerHtml = isLive ? `
    <div class="live-tracker" id="liveTracker">
      <div class="live-tracker-head">
        <div class="live-tracker-title">Live Tracker</div>
        <div class="live-tracker-meta">
          <span id="liveTrackerStatus" class="live-tracker-status">Loading...</span>
        </div>
      </div>
      <iframe
        id="liveTrackerFrame"
        class="live-tracker-iframe"
        src="about:blank"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allowfullscreen
      ></iframe>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="match-header">
      <div class="match-competition">${game.competition || '-'}</div>
      <div class="match-teams-detail">
        <span class="detail-team">${renderTeamColor(shirt1)}${team1}</span>
        <span class="vs-text">vs</span>
        <span class="detail-team">${renderTeamColor(shirt2)}${team2}</span>
      </div>
      <div class="match-time-detail">
        ${headerTimeText}
      </div>
      <div id="game-stats-container" class="game-stats-container"></div>
    </div>
    ${liveTrackerHtml}
    
    ${renderTabs()}
    
    <div class="markets-list">
        ${marketsHtml || '<div class="loading">No markets in this category</div>'}
    </div>
  `;

  if (typeof restoreDetailsScrollFromState === 'function') {
    restoreDetailsScrollFromState(game, content);
  }

  if (typeof bindDetailsScrollPersist === 'function') {
    bindDetailsScrollPersist(game, content);
  }

  game.__prevEventPrices = nextEventPrices;

  setTimeout(() => {
    const root = document.getElementById('detailsContent');
    if (!root) return;
    root.querySelectorAll('.event-btn.odd-up, .event-btn.odd-down, .tm-cell.odd-up, .tm-cell.odd-down').forEach(el => {
      el.classList.remove('odd-up', 'odd-down');
      const arrow = el.querySelector('.odd-arrow');
      if (arrow) arrow.textContent = '';
    });
  }, 1100);

  if (isLive) {
    ensureLiveTracker(serverGameId);
  } else {
    stopLiveTracker();
  }

  const statsContainer = document.getElementById('game-stats-container');
  if (typeof hydrateGameStatsInDetails === 'function') {
    hydrateGameStatsInDetails(isLive, statsContainer, serverGameId, team1, team2, game);
  }

  if (typeof bindDetailsTabHandlers === 'function') {
    bindDetailsTabHandlers(game, content);
  }

  if (typeof bindDetailsMarketAccordionHandlers === 'function') {
    bindDetailsMarketAccordionHandlers(game, content, allMarkets);
  }
}
