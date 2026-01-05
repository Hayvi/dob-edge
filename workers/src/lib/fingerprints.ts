export function getGameFp(data: unknown): string {
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const markets = obj && typeof obj.market === 'object' ? (obj.market as Record<string, unknown>) : {};
  const parts: string[] = [];

  const entries = Object.entries(markets || {}).sort(([a], [b]) => String(a).localeCompare(String(b)));
  for (const [mid, mRaw] of entries) {
    const m = mRaw && typeof mRaw === 'object' ? (mRaw as Record<string, unknown>) : null;
    const evMap = m && m.event && typeof m.event === 'object' ? (m.event as Record<string, unknown>) : {};
    const events = Object.values(evMap);

    const evParts = events
      .slice()
      .sort((aRaw, bRaw) => {
        const a = aRaw && typeof aRaw === 'object' ? (aRaw as Record<string, unknown>) : null;
        const b = bRaw && typeof bRaw === 'object' ? (bRaw as Record<string, unknown>) : null;
        const ao = typeof a?.order === 'number' ? (a.order as number) : Number.MAX_SAFE_INTEGER;
        const bo = typeof b?.order === 'number' ? (b.order as number) : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
      })
      .map(eRaw => {
        const e = eRaw && typeof eRaw === 'object' ? (eRaw as Record<string, unknown>) : null;
        return `${String(e?.id ?? '')}:${String(e?.price ?? '')}:${String(e?.base ?? '')}`;
      })
      .join(',');

    parts.push(`${String(mid)}|${String(m?.id ?? '')}|${String(m?.type ?? '')}|${String(m?.display_key ?? '')}|${evParts}`);
  }

  return parts.join('~');
}

export function getCountsFp(sports: unknown): string {
  return (Array.isArray(sports) ? sports : [])
    .filter(s => s && typeof s === 'object' && (s as any).name)
    .slice()
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
    .map((s: any) => `${String(s.name)}:${Number(s.count) || 0}`)
    .join('|');
}

export function getSportFp(games: unknown): string {
  return (Array.isArray(games) ? games : [])
    .map((gRaw: any) => {
      const id = gRaw?.id ?? gRaw?.gameId ?? '';
      const info = gRaw?.info && typeof gRaw.info === 'object' ? gRaw.info : {};
      const textInfo = gRaw?.text_info ?? '';
      const score = info.score ?? info.ss ?? info.score_str ?? info.scoreString ?? info.current_score ?? '';
      const clock = info.current_game_time ?? info.time ?? info.timer ?? info.match_time ?? info.minute ?? info.min ?? '';
      const phase = info.current_game_state ?? info.period ?? info.period_name ?? info.stage ?? info.phase ?? '';
      const add = info.add_minutes ?? info.added_minutes ?? info.addMinutes ?? info.addedMinutes ?? '';
      const mc = gRaw?.markets_count ?? '';
      return `${String(id)}|${String(mc)}|${String(textInfo)}|${String(score)}|${String(phase)}|${String(clock)}|${String(add)}`;
    })
    .sort()
    .join('~');
}

export function getOddsFp(market: unknown): string {
  if (!market || typeof market !== 'object') return '';
  const m = market as Record<string, unknown>;
  const evMap = m.event && typeof m.event === 'object' ? (m.event as Record<string, unknown>) : {};
  const ordered = Object.values(evMap)
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
    .map(eRaw => {
      const e = eRaw && typeof eRaw === 'object' ? (eRaw as Record<string, unknown>) : null;
      return `${String(e?.id ?? '')}:${String(e?.price ?? '')}:${String(e?.base ?? '')}`;
    })
    .join(',');
  return `${String(m?.id ?? '')}|${String(m?.type ?? '')}|${String(m?.display_key ?? '')}|${ordered}`;
}
