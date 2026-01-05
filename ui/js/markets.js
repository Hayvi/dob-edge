function getServerGameId(game) {
  return game.id || game.gameId || null;
}

function pickMainMarketFromMap(marketsMap) {
  if (!marketsMap) return null;
  const markets = Object.values(marketsMap);
  if (markets.length === 0) return null;

  const marketText = (m) => `${m?.name || ''} ${m?.type || ''} ${m?.display_key || ''}`.toLowerCase();

  const isExcludedMainMarket = (m) => {
    const s = marketText(m);
    if (!s) return false;
    return /winning\s*margin|victory\s*margin|margin\s*of\s*victory|win\s*by/i.test(s);
  };

  const isSubMatchWinnerMarket = (m) => {
    const s = marketText(m);
    if (!s) return false;
    if (/(^|[^a-z0-9])(set|game|point|period|quarter|inning|frame|map|round)([^a-z0-9]|$)/i.test(s)) return true;
    if (/(^|[^a-z0-9])(1st|2nd|3rd|4th|first|second|third|fourth)\s*(set|game|half|period|quarter|inning|frame|map|round)([^a-z0-9]|$)/i.test(s)) return true;
    return false;
  };

  const isHalfTimeMarket = (m) => {
    const s = marketText(m);
    return s.includes('half') || s.includes('halftime') || /(^|[^a-z0-9])ht([^a-z0-9]|$)/i.test(s);
  };

  const preferFullTime = (candidates) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const ordered = candidates.slice().sort(sortByOrderAsc);
    return ordered.find(m => !isHalfTimeMarket(m)) || null;
  };

  const nonSubMarkets = markets.filter(m => !isSubMatchWinnerMarket(m));
  const eligibleMarkets = nonSubMarkets.filter(m => !isExcludedMainMarket(m));

  const byDisplayKeyCandidates = eligibleMarkets.filter(m => {
    const k = String(m?.display_key || '').toLowerCase();
    if (k === 'winner') {
      const n = String(m?.name || '').toLowerCase();
      return n === 'winner' || n === 'match winner' || n.includes('match');
    }
    return k.includes('1x2') || k.includes('w1xw2') || k.includes('match_result') || k.includes('matchresult') || k.includes('matchwinner') || k.includes('match_winner');
  });
  const byDisplayKey = preferFullTime(byDisplayKeyCandidates);
  if (byDisplayKey) return byDisplayKey;

  const byTypeCandidates = eligibleMarkets.filter(m => {
    const t = String(m?.type || '').toLowerCase();
    if (t === 'winner') {
      const n = String(m?.name || '').toLowerCase();
      return n === 'winner' || n === 'match winner' || n.includes('match');
    }
    return t.includes('matchresult') || t.includes('w1xw2') || t.includes('1x2') || t.includes('matchwinner');
  });
  const byType = preferFullTime(byTypeCandidates);
  if (byType) return byType;

  const byNameCandidates = eligibleMarkets.filter(m => {
    const n = String(m?.name || '').toLowerCase();
    const events = m?.event ? Object.values(m.event) : [];
    const hasValidCols = events.length === 2 || events.length === 3;
    if (!hasValidCols) return false;
    if (n.includes('match') && (n.includes('winner') || n.includes('result') || n.includes('1x2'))) return true;
    if (n === 'match winner') return true;
    if (n === 'winner') return true;
    return false;
  });
  const byName = preferFullTime(byNameCandidates);
  if (byName) return byName;

  const byDrawCandidates = eligibleMarkets.filter(m => {
    const events = m?.event ? Object.values(m.event) : [];
    if (events.length !== 3) return false;
    return events.some(e => String(e?.name || '').toLowerCase().includes('draw')) || events.some(e => String(e?.name || '').toLowerCase() === 'x');
  });
  const byDraw = preferFullTime(byDrawCandidates);
  if (byDraw) return byDraw;

  return null;
}

function extract1X2Odds(mainMarket, team1, team2) {
  const marketBlocked = mainMarket?.is_blocked === true || mainMarket?.is_blocked === 1;
  const events = mainMarket?.event ? Object.values(mainMarket.event).slice().sort(sortByOrderAsc) : [];
  if (events.length === 0) return null;

  const lowerTeam1 = String(team1 || '').toLowerCase();
  const lowerTeam2 = String(team2 || '').toLowerCase();

  const norm = (v) => String(v || '').trim().toLowerCase();
  const hasToken = (s, token) => new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i').test(String(s || ''));
  
  // Helper to check if event is blocked
  const isEventBlocked = (e) => marketBlocked || e?.is_blocked === true || e?.is_blocked === 1;

  const isHome = (e) => {
    const n = norm(e?.name);
    const t = norm(e?.type);
    return n === '1' || n === 'w1' || n === 'home' || hasToken(n, 'w1') || hasToken(t, 'w1') || (lowerTeam1 && n.includes(lowerTeam1));
  };

  const isAway = (e) => {
    const n = norm(e?.name);
    const t = norm(e?.type);
    return n === '2' || n === 'w2' || n === 'away' || hasToken(n, 'w2') || hasToken(t, 'w2') || (lowerTeam2 && n.includes(lowerTeam2));
  };

  const isDraw = (e) => {
    const n = norm(e?.name);
    const t = norm(e?.type);
    return n === 'x' || n === 'draw' || n === 'd' || n.includes('draw') || hasToken(t, 'draw') || hasToken(n, 'tie');
  };

  const findOutcome = (kind) => {
    if (kind === '1') {
      return events.find(isHome) || events.find(e => norm(e?.name) === '1');
    }
    if (kind === 'x') {
      return events.find(isDraw) || events.find(e => norm(e?.name) === 'x');
    }
    if (kind === '2') {
      return events.find(isAway) || events.find(e => norm(e?.name) === '2');
    }
    return null;
  };

  const o1 = findOutcome('1');
  const ox = findOutcome('x');
  const o2 = findOutcome('2');

  const hasDraw = Boolean(ox) || events.some(isDraw);

  if (hasDraw) {
    return [
      { label: '1', price: o1?.price, blocked: isEventBlocked(o1) },
      { label: 'X', price: ox?.price, blocked: isEventBlocked(ox) },
      { label: '2', price: o2?.price, blocked: isEventBlocked(o2) }
    ];
  }

  if (events.length === 2) {
    const a = o1 || events[0];
    const b = o2 || events[1];
    return [
      { label: '1', price: a?.price, blocked: isEventBlocked(a) },
      { label: '2', price: b?.price, blocked: isEventBlocked(b) }
    ];
  }

  if (!o1 && !ox && !o2) return null;

  return [
    { label: '1', price: o1?.price, blocked: isEventBlocked(o1) },
    { label: '2', price: o2?.price, blocked: isEventBlocked(o2) }
  ];
}

function getMarketsCount(game) {
  if (typeof game?.markets_count === 'number') return game.markets_count;
  if (game?.market) return Object.keys(game.market).length;
  return null;
}
