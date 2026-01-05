export function getSportMainMarketTypePriority(sportName: string): string[] {
  const n = String(sportName || '').toLowerCase();
  if (n.includes('football')) return ['P1XP2', 'W1XW2', '1X2', 'MATCH_RESULT', 'MATCHRESULT'];
  return ['P1P2', 'P1XP2', 'W1W2', 'W1XW2'];
}

export function pickPreferredMarketFromEmbedded(marketMap: unknown, typePriority: string[]): Record<string, unknown> | null {
  if (!marketMap || typeof marketMap !== 'object') return null;
  const markets = Object.values(marketMap as Record<string, unknown>).filter(Boolean);
  if (markets.length === 0) return null;

  const pri = Array.isArray(typePriority) ? typePriority.map(String) : [];
  for (const t of pri) {
    const tt = String(t || '').toUpperCase();
    const byType = markets
      .map(m => (m && typeof m === 'object' ? (m as Record<string, unknown>) : null))
      .filter(Boolean)
      .filter(m => String((m as any)?.type || '').toUpperCase() === tt) as Record<string, unknown>[];
    if (byType.length) {
      byType.sort((a, b) => (Number((a as any)?.order) || Number.MAX_SAFE_INTEGER) - (Number((b as any)?.order) || Number.MAX_SAFE_INTEGER));
      return byType[0];
    }
  }

  return null;
}

function mapEventLabel(e: Record<string, unknown>): string {
  const t = String(e?.type || '').toUpperCase();
  if (t === 'P1') return '1';
  if (t === 'P2') return '2';
  if (t === 'X') return 'X';

  const n = String(e?.name || '').toLowerCase();
  if (n === 'x' || n.includes('draw')) return 'X';
  return '';
}

export function buildOddsArrFromMarket(market: unknown): Array<{ label: string; price: unknown; blocked: boolean }> | null {
  if (!market || typeof market !== 'object') return null;
  const m = market as Record<string, unknown>;

  const marketBlocked = (m as any)?.is_blocked === true || (m as any)?.is_blocked === 1;
  const evMap = m.event && typeof m.event === 'object' ? (m.event as Record<string, unknown>) : {};
  const events = Object.values(evMap);

  const ordered = events
    .filter(Boolean)
    .slice()
    .sort((aRaw, bRaw) => {
      const a = aRaw && typeof aRaw === 'object' ? (aRaw as Record<string, unknown>) : null;
      const b = bRaw && typeof bRaw === 'object' ? (bRaw as Record<string, unknown>) : null;
      const ao = typeof a?.order === 'number' ? (a.order as number) : Number.MAX_SAFE_INTEGER;
      const bo = typeof b?.order === 'number' ? (b.order as number) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
    })
    .map(e => (e && typeof e === 'object' ? (e as Record<string, unknown>) : null))
    .filter(Boolean) as Record<string, unknown>[];

  const odds = ordered.map((e, idx) => {
    const label = mapEventLabel(e) ||
      (ordered.length === 2 ? (idx === 0 ? '1' : '2') : (idx === 0 ? '1' : idx === 1 ? 'X' : '2'));

    const eventBlocked = e?.is_blocked === true || e?.is_blocked === 1;

    return {
      label,
      price: e?.price,
      blocked: Boolean(marketBlocked || eventBlocked)
    };
  });

  if (odds.length === 2) return odds;
  if (odds.length === 3) return odds;
  return null;
}
