async function fetchMainMarket(serverGameId) {
  return null;
}

async function withConcurrencyLimit(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await Promise.resolve(fn(item)).catch(() => null);
    }
  });
  await Promise.all(workers);
}

function updateGameRowOdds(serverGameId, oddsArr, marketsCount) {
  const oddsContainer = document.querySelector(`.game-odds[data-server-game-id="${CSS.escape(String(serverGameId))}"]`);
  if (!oddsContainer) return;

  const oddsBtns = oddsContainer.querySelectorAll('.odd-btn');

  const pill = oddsContainer.querySelector('.more-markets-pill');

  if (!oddsArr) {
    if (pill && typeof marketsCount === 'number') {
      pill.textContent = `+${Math.max(0, marketsCount - 1)}`;
    }
    return;
  }

  const defaultLabels = ['1', 'X', '2'];
  const labels = !oddsArr
    ? ['', '', '']
    : (oddsArr.length === 2)
      ? [oddsArr[0]?.label || '1', oddsArr[1]?.label || '2', '']
      : (oddsArr.length === 3)
        ? [oddsArr[0]?.label || '1', oddsArr[1]?.label || 'X', oddsArr[2]?.label || '2']
        : defaultLabels;

  const boundGame = Array.isArray(currentGames)
    ? currentGames.find(x => {
      const sid = getServerGameId(x);
      return sid && String(sid) === String(serverGameId);
    })
    : null;

  const flashStore = (boundGame && typeof boundGame === 'object')
    ? (boundGame.__mainOddsFlash && typeof boundGame.__mainOddsFlash === 'object' ? boundGame.__mainOddsFlash : {})
    : null;

  for (let i = 0; i < oddsBtns.length && i < 3; i++) {
    const isBlocked = oddsArr && oddsArr[i]?.blocked;
    
    oddsBtns[i].classList.toggle('odd-empty', !labels[i]);
    oddsBtns[i].classList.toggle('odd-blocked', isBlocked);

    const labelEl = oddsBtns[i].querySelector('.odd-label');
    if (labelEl) labelEl.textContent = labels[i] || '';

    const valueEl = oddsBtns[i].querySelector('.odd-value');
    if (!valueEl) continue;

    // If blocked, show lock icon
    if (isBlocked) {
      valueEl.innerHTML = '<span class="odd-locked">🔒</span>';
      oddsBtns[i].classList.remove('odd-up', 'odd-down');
      continue;
    }

    const newText = oddsArr && oddsArr[i] ? formatOddValue(oddsArr[i].price) : '-';
    const numberEl = valueEl.querySelector('.odd-number');
    const arrowEl = valueEl.querySelector('.odd-arrow');
    
    // Ensure we have the right structure (in case it was previously locked)
    if (!numberEl) {
      valueEl.innerHTML = `<span class="odd-number">${newText}</span><span class="odd-arrow"></span>`;
      continue;
    }

    const currentText = numberEl ? String(numberEl.textContent || '').trim() : String(valueEl.textContent || '').trim();
    const prev = Number.parseFloat(currentText);
    const next = Number.parseFloat(newText);

    if (numberEl) {
      numberEl.textContent = newText;
    } else {
      valueEl.textContent = newText;
    }

    if (arrowEl) arrowEl.textContent = '';
    oddsBtns[i].classList.remove('odd-up', 'odd-down');

    if (Number.isFinite(prev) && Number.isFinite(next) && prev !== next) {
      const direction = next > prev ? 'up' : 'down';
      oddsBtns[i].classList.add(direction === 'up' ? 'odd-up' : 'odd-down');
      if (arrowEl) arrowEl.textContent = direction === 'up' ? '▲' : '▼';

      if (flashStore) {
        flashStore[String(i)] = {
          cls: direction === 'up' ? 'odd-up' : 'odd-down',
          arrow: direction === 'up' ? '▲' : '▼',
          until: Date.now() + 1100
        };
      }

      const timeoutKey = `__oddsFlashTimeout${i}`;
      const oldId = oddsBtns[i][timeoutKey];
      if (oldId) clearTimeout(oldId);
      oddsBtns[i][timeoutKey] = setTimeout(() => {
        oddsBtns[i].classList.remove('odd-up', 'odd-down');
        if (arrowEl) arrowEl.textContent = '';
        oddsBtns[i][timeoutKey] = null;
      }, 1100);
    }
  }

  if (pill && typeof marketsCount === 'number') {
    const extra = oddsArr ? Math.max(0, marketsCount - 1) : marketsCount;
    pill.textContent = `+${extra}`;
  }

  const g = Array.isArray(currentGames)
    ? currentGames.find(x => {
      const sid = getServerGameId(x);
      return sid && String(sid) === String(serverGameId);
    })
    : null;
  if (g) {
    g.__mainOdds = oddsArr;
    if (typeof marketsCount === 'number') g.__mainMarketsCount = marketsCount;
    if (flashStore) g.__mainOddsFlash = flashStore;
    g.__mainOddsUpdatedAt = Date.now();
  }
}

async function hydrateMainMarketsInContainer(containerEl) {
  if (!containerEl) return;
  return;

  const liveOddsSse = (typeof liveStreamHasOddsSse !== 'undefined') && Boolean(liveStreamHasOddsSse);
  const prematchOddsSse = (typeof prematchStreamHasOddsSse !== 'undefined') && Boolean(prematchStreamHasOddsSse);
  const oddsSseActive = (currentMode === 'live' && liveOddsSse) || (currentMode === 'prematch' && prematchOddsSse);
  if (oddsSseActive) return;

  const rows = Array.from(containerEl.querySelectorAll('.game-row')).filter(r => r.dataset.serverGameId);
  const toFetch = rows;

  await withConcurrencyLimit(toFetch, 2, async (row) => {
    const serverGameId = row.dataset.serverGameId;
    const game = currentGames.find(g => String(g.__clientId) === row.dataset.gameId);
    if (!game) return;

    const selectedServerGameId = selectedGame ? getServerGameId(selectedGame) : null;
    if (selectedServerGameId && String(selectedServerGameId) === String(serverGameId)) {
      const detailsOpen = Boolean(gameDetailsPanel && !gameDetailsPanel.classList.contains('hidden'));
      const liveGameActive = Boolean(typeof isLiveGameStreamActive === 'function' && isLiveGameStreamActive());
      if (detailsOpen || liveGameActive) return;
    }

    const data = await fetchMainMarket(serverGameId);
    const market = data?.market || null;
    const marketsCount = typeof data?.markets_count === 'number' ? data.markets_count : getMarketsCount(game);
    const odds = extract1X2Odds(market, game.team1_name, game.team2_name);
    updateGameRowOdds(serverGameId, odds, marketsCount);
  });
}
