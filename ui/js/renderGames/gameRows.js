function renderGamesInCompetition(games) {
  const selectedServerGameId = selectedGame ? getServerGameId(selectedGame) : null;

  const nowTs = Date.now();

  return (Array.isArray(games) ? games : []).map(game => {
    const startTime = game.start_ts ? new Date(game.start_ts * 1000) : null;
    const team1 = game.team1_name || game.name || 'Team 1';
    const team2 = game.team2_name || (game.team1_name ? 'Team 2' : '-');
    const gameId = game.__clientId;
    const isLive = Boolean(game.type === 1);
    
    // Game-level blocked state
    const isGameBlocked = game.is_blocked === true || game.is_blocked === 1;

    // Team shirt colors from info object
    const info = game.info || {};
    const shirt1 = info.shirt1_color || '';
    const shirt2 = info.shirt2_color || '';
    
    // Helper to render team color badge
    const renderTeamColor = (color) => {
      if (!color || color === '000000') return '';
      return `<span class="team-color" style="background-color: #${color}"></span>`;
    };

    // Live Game Info
    let timeDisplay = '-';
    let dateDisplay = '-';
    let liveMetaHtml = '';

    if (isLive) {
      const meta = getLiveMeta(game);
      
      // Build premium horizontal live meta display
      const scoreParts = [];
      if (meta.scoreText) scoreParts.push(`<span class="live-score">${meta.scoreText}</span>`);
      if (meta.timeText) scoreParts.push(`<span class="live-time">${meta.timeText}</span>`);
      
      // Period scores (quarters, sets, halves)
      if (meta.periodScores && meta.periodScores.length > 0) {
        const periodHtml = meta.periodScores.map(p => 
          `<span class="period-score">${p.home}:${p.away}</span>`
        ).join('');
        scoreParts.push(`<span class="period-scores">${periodHtml}</span>`);
      }
      
      liveMetaHtml = `
        <div class="live-meta-row">
          <span class="live-badge${isGameBlocked ? ' suspended' : ''}">LIVE${isGameBlocked ? ' 🔒' : ''}</span>
          ${scoreParts.join('')}
        </div>
      `;
      
      dateDisplay = '';
      timeDisplay = '';
    } else {
      dateDisplay = startTime ? startTime.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) : '-';
      timeDisplay = startTime ? startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '-';
    }

    const serverGameId = getServerGameId(game);
    const mainMarket = game.market ? pickMainMarketFromMap(game.market) : null;
    const odds = extract1X2Odds(mainMarket, team1, team2) || (Array.isArray(game.__mainOdds) ? game.__mainOdds : null);
    const marketsCount = getMarketsCount(game) ?? (typeof game.__mainMarketsCount === 'number' ? game.__mainMarketsCount : null);
    const pillCount = typeof marketsCount === 'number'
      ? (odds ? Math.max(0, marketsCount - 1) : marketsCount)
      : null;

    const defaultLabels = ['1', 'X', '2'];
    const oddsLabels = !odds
      ? ['', '', '']
      : (odds.length === 2)
        ? [odds[0]?.label || '1', odds[1]?.label || '2', '']
        : (odds.length === 3)
          ? [odds[0]?.label || '1', odds[1]?.label || 'X', odds[2]?.label || '2']
          : defaultLabels;

    const flash = (game && typeof game === 'object' && game.__mainOddsFlash && typeof game.__mainOddsFlash === 'object')
      ? game.__mainOddsFlash
      : null;

    const flashClasses = [0, 1, 2].map((i) => {
      const meta = flash ? flash[String(i)] : null;
      if (!meta || typeof meta.until !== 'number' || meta.until <= nowTs) return '';
      return meta.cls ? ` ${meta.cls}` : '';
    });

    const flashArrows = [0, 1, 2].map((i) => {
      const meta = flash ? flash[String(i)] : null;
      if (!meta || typeof meta.until !== 'number' || meta.until <= nowTs) return '';
      return meta.arrow ? meta.arrow : '';
    });

    const isSelected = selectedServerGameId && serverGameId && String(selectedServerGameId) === String(serverGameId);
    const gameBlockedClass = isGameBlocked ? ' game-blocked' : '';

    // Different layout for live vs prematch
    if (isLive) {
      return `
        <div class="game-row game-row-live${isSelected ? ' selected' : ''}${gameBlockedClass}" data-game-id="${gameId}" ${serverGameId ? `data-server-game-id="${serverGameId}"` : ''}>
          ${liveMetaHtml}
          <div class="game-teams">
            <div class="team-name">${renderTeamColor(shirt1)}${team1}</div>
            <div class="team-name">${renderTeamColor(shirt2)}${team2}</div>
          </div>
          <div class="game-odds" ${serverGameId ? `data-server-game-id="${serverGameId}"` : ''}>
            ${[0, 1, 2].map((idx) => {
              const isBlocked = isGameBlocked || (odds && odds[idx]?.blocked);
              return `
              <div class="odd-btn${oddsLabels[idx] ? '' : ' odd-empty'}${isBlocked ? ' odd-blocked' : ''}${flashClasses[idx]}">
                <span class="odd-label">${oddsLabels[idx] || ''}</span>
                <span class="odd-value">${isBlocked ? '<span class="odd-locked">🔒</span>' : `<span class="odd-number">${odds && odds[idx] ? formatOddValue(odds[idx].price) : '-'}</span><span class="odd-arrow">${flashArrows[idx]}</span>`}</span>
              </div>
            `}).join('')}
            <div class="more-markets-pill">${typeof pillCount === 'number' ? `+${pillCount}` : ''}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="game-row${isSelected ? ' selected' : ''}${gameBlockedClass}" data-game-id="${gameId}" ${serverGameId ? `data-server-game-id="${serverGameId}"` : ''}>
        <div class="game-time">
          <div class="game-date">${dateDisplay}</div>
          <div class="game-hour">${timeDisplay}${isGameBlocked ? ' 🔒' : ''}</div>
        </div>
        <div class="game-teams">
          <div class="team-name">${renderTeamColor(shirt1)}${team1}</div>
          <div class="team-name">${renderTeamColor(shirt2)}${team2}</div>
        </div>
        <div class="game-odds" ${serverGameId ? `data-server-game-id="${serverGameId}"` : ''}>
          ${[0, 1, 2].map((idx) => {
            const isBlocked = isGameBlocked || (odds && odds[idx]?.blocked);
            return `
            <div class="odd-btn${oddsLabels[idx] ? '' : ' odd-empty'}${isBlocked ? ' odd-blocked' : ''}${flashClasses[idx]}">
              <span class="odd-label">${oddsLabels[idx] || ''}</span>
              <span class="odd-value">${isBlocked ? '<span class="odd-locked">🔒</span>' : `<span class="odd-number">${odds && odds[idx] ? formatOddValue(odds[idx].price) : '-'}</span><span class="odd-arrow">${flashArrows[idx]}</span>`}</span>
            </div>
          `}).join('')}
          <div class="more-markets-pill">${typeof pillCount === 'number' ? `+${pillCount}` : ''}</div>
        </div>
      </div>
    `;
  }).join('');
}

function selectGame(game, rowElement) {
  // Remove previous selection
  document.querySelectorAll('.game-row.selected').forEach(r => r.classList.remove('selected'));

  // Add selection to clicked row
  rowElement.classList.add('selected');
  selectedGame = game;

  const serverGameId = getServerGameId(game);
  const isLive = Number(game?.type) === 1;
  
  // Start real-time stream for both live and prematch modes
  if ((currentMode === 'live' || currentMode === 'prematch') && serverGameId && typeof startLiveGameStream === 'function') {
    startLiveGameStream(serverGameId);
  } else if (typeof stopLiveGameStream === 'function') {
    stopLiveGameStream();
  }

  // Update details panel
  showGameDetails(game);
  if (isMobileLayout()) {
    openMobileDetails();
  } else {
    gameDetailsPanel.classList.remove('hidden');
  }
}
