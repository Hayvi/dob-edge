function renderDetailsMarketEventsHtml(market, ctx) {
  const marketId = market?.id;
  const marketBlocked = market?.is_blocked === true || market?.is_blocked === 1;
  // Check game-level blocked state from context
  const gameBlocked = ctx.isGameBlocked === true;
  const events = market?.event
    ? Object.entries(market.event).map(([k, e]) => ({ k, e })).sort((a, b) => ctx.sortByOrderAsc(a.e, b.e))
    : [];
  const lowerName = ctx.norm(market?.name);

  // Helper to check if event is blocked (game, market, or event level)
  const isEventBlocked = (e) => gameBlocked || marketBlocked || e?.is_blocked === true || e?.is_blocked === 1;
  
  // Helper to render price or lock icon
  const renderPrice = (e, meta) => {
    if (isEventBlocked(e)) {
      return '<span class="odd-locked">🔒</span>';
    }
    return `<span class="odd-number">${ctx.formatOddValue(e?.price)}</span><span class="odd-arrow">${meta?.arrow || ''}</span>`;
  };

  // 1. Handicap Table Renderer
  if (lowerName.includes('handicap')) {
    // Detect if line-based (Asian) or fixed
    const isAsian = lowerName.includes('asian');

    // Try to group by line/base if available
    const sampleBase = events.find(x => x?.e?.base !== undefined)?.e?.base;

    if (sampleBase !== undefined || isAsian) {
      // Render as Asian Handicap Table
      const byLine = new Map();
      for (const ev of events) {
        // Normalize grouping by absolute value to pair -1.5 (Home) with +1.5 (Away)
        const val = ev?.e?.base !== undefined ? parseFloat(ev.e.base) : 0;
        const key = Math.abs(val).toFixed(2); // Use 2 decimals for grouping
        if (!byLine.has(key)) byLine.set(key, []);
        byLine.get(key).push(ev);
      }

      const lines = Array.from(byLine.entries())
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

      // Helper to check if event is Home or Away using TYPE field
      const isHomeType = (e) => {
        const t = ctx.norm(e?.e?.type);
        return t === 'h1' || t === 'w1' || t === 'p1' || t === '1' || t === 'home' || t.includes('team1');
      };
      const isAwayType = (e) => {
        const t = ctx.norm(e?.e?.type);
        return t === 'h2' || t === 'w2' || t === 'p2' || t === '2' || t === 'away' || t.includes('team2');
      };

      return `
           <div class="table-market">
             <div class="tm-row tm-header">
               <div class="tm-col">${ctx.team1}</div>
               <div class="tm-col">${ctx.team2}</div>
             </div>
             ${lines.map(([key, evs]) => {
        const home = evs.find(isHomeType);
        const away = evs.find(isAwayType);

        // Determine display line. Prefer Home's base, otherwise infer from key.
        // Parse float to remove trailing zeros if possible for display
        let displayLine = home?.e?.base;
        if (displayLine === undefined) {
          // If home is missing, try to derive inverse of away, or just use -key as default for home col
          displayLine = away?.e?.base ? (parseFloat(away.e.base) * -1) : -parseFloat(key);
        }

        const homeMeta = home ? ctx.getMoveMeta(marketId, home.k, home.e?.price) : { cls: '', arrow: '' };
        const awayMeta = away ? ctx.getMoveMeta(marketId, away.k, away.e?.price) : { cls: '', arrow: '' };
        const homeBlocked = isEventBlocked(home?.e);
        const awayBlocked = isEventBlocked(away?.e);

        return `
                  <div class="tm-row">
                    <div class="tm-cell ${homeBlocked ? 'blocked' : homeMeta.cls}">
                      <span class="tm-label">${displayLine}</span>
                      <span class="tm-price">${renderPrice(home?.e, homeMeta)}</span>
                    </div>
                    <div class="tm-cell ${awayBlocked ? 'blocked' : awayMeta.cls}">
                      <span class="tm-label">${Number(displayLine) > 0 ? -Number(displayLine) : '+' + Math.abs(Number(displayLine))}</span>
                      <span class="tm-price">${renderPrice(away?.e, awayMeta)}</span>
                    </div>
                  </div>
                `;
      }).join('')}
           </div>
         `;
    }
  }

  // 2. Over/Under Table (Existing Logic Refined)
  if (ctx.isOverUnderLineMarket(market)) {
    const byLine = new Map();
    for (const ev of events) {
      const lineKey = ev?.e?.base !== undefined && ev?.e?.base !== null ? String(ev.e.base) : '';
      if (!byLine.has(lineKey)) byLine.set(lineKey, []);
      byLine.get(lineKey).push(ev);
    }

    const lines = Array.from(byLine.entries())
      .map(([line, evs]) => ({ line, evs }))
      .sort((a, b) => {
        const an = parseFloat(a.line);
        const bn = parseFloat(b.line);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        return String(a.line).localeCompare(String(b.line));
      });

    return `
        <div class="table-market">
           <div class="tm-row tm-header">
             <div class="tm-col-sm">Goals</div>
             <div class="tm-col">Over</div>
             <div class="tm-col">Under</div>
           </div>
           ${lines.map(({ line, evs }) => {
      const overEv = evs.find(x => ctx.isOver(x?.e));
      const underEv = evs.find(x => ctx.isUnder(x?.e));
      const overMeta = overEv ? ctx.getMoveMeta(marketId, overEv.k, overEv.e?.price) : { cls: '', arrow: '' };
      const underMeta = underEv ? ctx.getMoveMeta(marketId, underEv.k, underEv.e?.price) : { cls: '', arrow: '' };
      const overBlocked = isEventBlocked(overEv?.e);
      const underBlocked = isEventBlocked(underEv?.e);
      return `
               <div class="tm-row">
                 <div class="tm-col-sm tm-line">${line || '-'}</div>
                 <div class="tm-cell ${overBlocked ? 'blocked' : overMeta.cls}">
                    <span class="tm-price">${renderPrice(overEv?.e, overMeta)}</span>
                 </div>
                 <div class="tm-cell ${underBlocked ? 'blocked' : underMeta.cls}">
                    <span class="tm-price">${renderPrice(underEv?.e, underMeta)}</span>
                 </div>
               </div>
             `;
    }).join('')}
        </div>
      `;
  }

  // Default Grid
  return events.map(({ k, e }) => {
    const meta = ctx.getMoveMeta(marketId, k, e?.price);
    const blocked = isEventBlocked(e);
    return `
      <div class="event-btn ${blocked ? 'blocked' : meta.cls}">
        <div class="event-name">${e?.name || '-'}</div>
        <div class="event-price">${renderPrice(e, meta)}</div>
      </div>
    `;
  }).join('');
}
