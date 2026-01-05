let competitionGamesByKey = new Map();
let virtualScrollBound = false;
let virtualScrollScheduled = false;
const virtualRowHeightByKey = new Map();
let virtualLastScrollEl = null;
let virtualLastOptions = {};
let virtualResizeBound = false;

function getVirtualScrollEl() {
  if (virtualLastScrollEl && virtualLastScrollEl.isConnected) return virtualLastScrollEl;
  const el = document.querySelector('.content');
  virtualLastScrollEl = el;
  return el;
}

function scheduleVirtualUpdate() {
  if (virtualScrollScheduled) return;
  virtualScrollScheduled = true;
  requestAnimationFrame(() => {
    virtualScrollScheduled = false;
    updateAllVirtualCompetitions(virtualLastOptions);
  });
}

function measureRowHeight(sampleHtml) {
  if (!sampleHtml) return 0;
  const tmp = document.createElement('div');
  tmp.style.position = 'absolute';
  tmp.style.left = '-99999px';
  tmp.style.top = '0';
  tmp.style.visibility = 'hidden';
  tmp.style.pointerEvents = 'none';
  tmp.innerHTML = sampleHtml;
  document.body.appendChild(tmp);
  const row = tmp.firstElementChild;
  const h = row ? row.getBoundingClientRect().height : 0;
  tmp.remove();
  return Number(h) || 0;
}

function ensureCompetitionVirtualized(container, options = {}) {
  if (!container) return;
  const vkey = container.dataset ? container.dataset.vkey : null;
  if (!vkey) return;

  const games = competitionGamesByKey.get(String(vkey));
  if (!Array.isArray(games) || games.length === 0) {
    const itemsEl = container.querySelector('.virtual-items');
    if (itemsEl) itemsEl.innerHTML = '';
    const topEl = container.querySelector('.virtual-spacer-top');
    const bottomEl = container.querySelector('.virtual-spacer-bottom');
    if (topEl) topEl.style.height = '0px';
    if (bottomEl) bottomEl.style.height = '0px';
    return;
  }

  let rowH = Number(virtualRowHeightByKey.get(String(vkey)) || 0);
  if (!rowH || rowH < 10) {
    const sample = renderGamesInCompetition(games.slice(0, 1));
    rowH = measureRowHeight(sample);
    if (!rowH || rowH < 10) rowH = 60;
    virtualRowHeightByKey.set(String(vkey), rowH);
  }

  updateVirtualCompetition(container, options);
}

function updateVirtualCompetition(container, options = {}) {
  if (!container || !container.classList.contains('expanded')) return;
  const vkey = container.dataset ? container.dataset.vkey : null;
  if (!vkey) return;

  const games = competitionGamesByKey.get(String(vkey));
  if (!Array.isArray(games) || games.length === 0) return;

  const scrollEl = getVirtualScrollEl();
  if (!scrollEl) return;

  const rowH = Number(virtualRowHeightByKey.get(String(vkey)) || 0) || 60;
  const viewportH = Number(scrollEl.clientHeight) || 0;
  const scrollTop = Number(scrollEl.scrollTop) || 0;

  const scrollRect = scrollEl.getBoundingClientRect();
  const contRect = container.getBoundingClientRect();
  const containerTop = (contRect.top - scrollRect.top) + scrollTop;

  const startPx = scrollTop - containerTop;
  const endPx = startPx + viewportH;

  const bufferRows = 8;
  const rawStart = Math.floor((startPx / rowH)) - bufferRows;
  const rawEnd = Math.ceil((endPx / rowH)) + bufferRows;
  const startIndex = Math.max(0, Math.min(games.length, rawStart));
  const endIndex = Math.max(startIndex, Math.min(games.length, Math.max(0, rawEnd)));

  const topPad = startIndex * rowH;
  const bottomPad = Math.max(0, (games.length - endIndex) * rowH);

  const topEl = container.querySelector('.virtual-spacer-top');
  const bottomEl = container.querySelector('.virtual-spacer-bottom');
  const itemsEl = container.querySelector('.virtual-items');
  if (!itemsEl) return;

  const prevStart = Number(container.dataset.virtualStart || 0);
  const prevEnd = Number(container.dataset.virtualEnd || 0);
  if (prevStart === startIndex && prevEnd === endIndex) {
    if (topEl) topEl.style.height = `${topPad}px`;
    if (bottomEl) bottomEl.style.height = `${bottomPad}px`;
    return;
  }

  container.dataset.virtualStart = String(startIndex);
  container.dataset.virtualEnd = String(endIndex);

  if (topEl) topEl.style.height = `${topPad}px`;
  if (bottomEl) bottomEl.style.height = `${bottomPad}px`;

  itemsEl.innerHTML = renderGamesInCompetition(games.slice(startIndex, endIndex));

  const now = Date.now();
  const liveOddsSse = (typeof liveStreamHasOddsSse !== 'undefined') && Boolean(liveStreamHasOddsSse);
  const prematchOddsSse = (typeof prematchStreamHasOddsSse !== 'undefined') && Boolean(prematchStreamHasOddsSse);

  const hasFlag = options && Object.prototype.hasOwnProperty.call(options, 'hydrateMainMarkets');
  const hydrateFlag = hasFlag ? Boolean(options.hydrateMainMarkets) : true;

  if (!hydrateFlag) return;

  const oddsSseActive = (currentMode === 'live' && liveOddsSse) || (currentMode === 'prematch' && prematchOddsSse);
  if (oddsSseActive) return;
  if (typeof hydrateMainMarketsInContainer !== 'function') return;

  const lastAt = Number(container.__virtualHydrateAt || 0);
  if (now - lastAt < 1200) return;
  if (container.__virtualHydrateInFlight) return;

  container.__virtualHydrateAt = now;
  container.__virtualHydrateInFlight = true;
  hydrateMainMarketsInContainer(container)
    .finally(() => {
      container.__virtualHydrateInFlight = false;
    })
    .catch(() => null);
}

function updateAllVirtualCompetitions(options = {}) {
  const regionsTree = document.getElementById('regionsTree');
  if (!regionsTree) return;
  const expanded = Array.from(regionsTree.querySelectorAll('.games-in-competition.expanded[data-vkey]'));
  const scrollEl = getVirtualScrollEl();
  const scrollRect = scrollEl ? scrollEl.getBoundingClientRect() : null;
  expanded.forEach(c => {
    if (scrollRect) {
      const r = c.getBoundingClientRect();
      const pad = scrollRect.height || 800;
      if (r.bottom < scrollRect.top - pad) return;
      if (r.top > scrollRect.bottom + pad) return;
    }
    ensureCompetitionVirtualized(c, options);
  });
}
