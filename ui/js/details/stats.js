function hydrateGameStatsInDetails(isLive, statsContainer, serverGameId, team1, team2, game) {
  // For live games, show live match statistics from game.stats
  if (isLive && game?.stats && statsContainer) {
    const stats = game.stats;
    
    // Define which stats to show and their display names
    const statConfig = [
      { key: 'dangerous_attack', label: 'Dangerous Attacks' },
      { key: 'shot_on_target', label: 'Shots on Target' },
      { key: 'shot_blocked', label: 'Shots Blocked' },
      { key: 'corner', label: 'Corners' },
      { key: 'goal', label: 'Goals' },
      { key: 'foul', label: 'Fouls' },
      { key: 'offside', label: 'Offsides' },
      { key: 'yellow_card', label: 'Yellow Cards' },
      { key: 'red_card', label: 'Red Cards' },
      { key: 'goalkeeper_save', label: 'Saves' },
      { key: 'free_kick', label: 'Free Kicks' },
      { key: 'throw_in', label: 'Throw-ins' },
      { key: 'substitution', label: 'Substitutions' },
      { key: 'wicet', label: 'Wickets' }, // Cricket
      { key: 'over', label: 'Overs' }, // Cricket
      { key: 'possession', label: 'Possession %' },
      { key: 'attack', label: 'Attacks' },
    ];
    
    const statRows = statConfig
      .filter(({ key }) => stats[key] && (stats[key].team1_value !== undefined || stats[key].team2_value !== undefined))
      .map(({ key, label }) => {
        const t1 = stats[key].team1_value ?? 0;
        const t2 = stats[key].team2_value ?? 0;
        const total = (Number(t1) || 0) + (Number(t2) || 0);
        const pct1 = total > 0 ? Math.round((Number(t1) / total) * 100) : 50;
        const pct2 = 100 - pct1;
        
        return `
          <div class="live-stat-row">
            <span class="live-stat-value left">${t1}</span>
            <div class="live-stat-bar-container">
              <div class="live-stat-bar left" style="width: ${pct1}%"></div>
              <span class="live-stat-label">${label}</span>
              <div class="live-stat-bar right" style="width: ${pct2}%"></div>
            </div>
            <span class="live-stat-value right">${t2}</span>
          </div>
        `;
      })
      .join('');
    
    // Period/Half scores
    let periodScoresHtml = '';
    const periodScores = [];
    for (let i = 1; i <= 10; i++) {
      const setKey = `score_set${i}`;
      if (stats[setKey]) {
        const t1 = stats[setKey].team1_value ?? '-';
        const t2 = stats[setKey].team2_value ?? '-';
        periodScores.push({ period: i, t1, t2 });
      }
    }
    if (periodScores.length > 0) {
      const periodLabels = periodScores.length === 2 ? ['1H', '2H'] : periodScores.map((_, i) => `P${i + 1}`);
      periodScoresHtml = `
        <div class="period-scores-box">
          <div class="period-scores-header">
            <span class="team-name">${team1}</span>
            ${periodLabels.map(l => `<span class="period-label">${l}</span>`).join('')}
            <span class="team-name">${team2}</span>
          </div>
          <div class="period-scores-row">
            <span class="period-total">${periodScores.reduce((sum, p) => sum + (Number(p.t1) || 0), 0)}</span>
            ${periodScores.map(p => `<span class="period-score">${p.t1}-${p.t2}</span>`).join('')}
            <span class="period-total">${periodScores.reduce((sum, p) => sum + (Number(p.t2) || 0), 0)}</span>
          </div>
        </div>
      `;
    }
    
    // Live events timeline
    let eventsHtml = '';
    const liveEvents = game?.live_events;
    if (Array.isArray(liveEvents) && liveEvents.length > 0) {
      // Event type mapping
      const eventTypes = {
        '1': { icon: '⚽', name: 'Goal' },
        '2': { icon: '🟨', name: 'Yellow Card' },
        '3': { icon: '🟥', name: 'Red Card' },
        '4': { icon: '🚩', name: 'Corner' },
        '5': { icon: '⚽', name: 'Penalty' },
        '6': { icon: '🔄', name: 'Substitution' },
        '7': { icon: '🏥', name: 'Injury' },
        '8': { icon: '⏱️', name: 'Half Time' },
        '9': { icon: '🏁', name: 'Full Time' },
        '10': { icon: '🎯', name: 'Shot on Target' },
        '11': { icon: '❌', name: 'Shot off Target' },
        '12': { icon: '🧤', name: 'Save' },
        '13': { icon: '🚫', name: 'Offside' },
        '14': { icon: '⚠️', name: 'Foul' },
        '20': { icon: '⚡', name: 'Dangerous Attack' },
        '328': { icon: '📺', name: 'VAR Review' },
      };
      
      // Sort by time descending (most recent first)
      const sortedEvents = [...liveEvents]
        .filter(e => e.type_id && eventTypes[e.type_id])
        .sort((a, b) => (b.time || 0) - (a.time || 0))
        .slice(0, 15); // Show last 15 events
      
      if (sortedEvents.length > 0) {
        const eventItems = sortedEvents.map(e => {
          const eventType = eventTypes[e.type_id] || { icon: '•', name: 'Event' };
          const teamName = e.side === '1' ? team1 : e.side === '2' ? team2 : '';
          const minute = e.current_minute || '';
          
          return `
            <div class="live-event-item">
              <span class="live-event-time">${minute}</span>
              <span class="live-event-icon">${eventType.icon}</span>
              <span class="live-event-text">
                ${eventType.name}${teamName ? ` - <span class="live-event-team">${teamName}</span>` : ''}
              </span>
            </div>
          `;
        }).join('');
        
        eventsHtml = `
          <div class="live-events-box">
            <div class="live-events-title">Match Events</div>
            ${eventItems}
          </div>
        `;
      }
    }
    
    if (statRows || periodScoresHtml || eventsHtml) {
      statsContainer.innerHTML = `
        ${periodScoresHtml}
        ${statRows ? `
        <div class="live-stats-box">
          <div class="live-stats-header">
            <span class="team-name">${team1}</span>
            <span class="stats-title">Match Stats</span>
            <span class="team-name">${team2}</span>
          </div>
          <div class="live-stats-body">
            ${statRows}
          </div>
        </div>
        ` : ''}
        ${eventsHtml}
      `;
    } else {
      statsContainer.innerHTML = '';
    }
    return;
  }
  
  // For prematch games, fetch stats from API
  if (!isLive && statsContainer && serverGameId) {
    statsContainer.innerHTML = '<div class="stats-loading">Loading stats...</div>';
    fetch(`/api/game-stats?gameId=${serverGameId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error || !data.stats) {
          statsContainer.innerHTML = '';
          return;
        }
        const home = data.stats.home;
        const away = data.stats.away;

        if (!home && !away) {
          statsContainer.innerHTML = '';
          return;
        }

        const renderTeamStats = (stats, name) => {
          if (!stats) return `<div class="team-stat-empty">-</div>`;
          const formHtml = (stats.form || []).map(r =>
            `<span class="stat-result stat-${r.toLowerCase()}">${r}</span>`
          ).join('');

          return `
                      <div class="team-stat-box">
                          <div class="stat-team-name">${name}</div>
                          <div class="stat-position">Pos: ${stats.position || '-'}</div>
                          <div class="stat-points"> Pts: ${stats.points || '-'}</div>
                          <div class="stat-form">${formHtml}</div>
                      </div>
                  `;
        };

        statsContainer.innerHTML = `
                  <div class="stats-box">
                      ${renderTeamStats(home, team1)}
                      ${renderTeamStats(away, team2)}
                  </div>
              `;
      })
      .catch(e => {
        console.error('Stats fetch error:', e);
        statsContainer.innerHTML = '';
      });
  }
}
