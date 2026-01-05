type AnyObj = Record<string, any>;

export function parseGamesFromData(rawData: any, sportName = 'Unknown'): any[] {
  let data: any = rawData;

  if (rawData && rawData.data) {
    data = rawData.data;
    if (data && data.data) {
      data = data.data;
    }
  }

  const allGames: any[] = [];

  const pushGame = (game: AnyObj, regionName: string, competitionName: string) => {
    const markets: AnyObj = {};
    if (game.market) {
      for (const mId in game.market) {
        const market = game.market[mId];
        const events: AnyObj = {};
        if (market.event) {
          for (const eId in market.event) {
            events[eId] = market.event[eId];
          }
        }
        markets[mId] = { ...market, event: events };
      }
    }

    allGames.push({
      ...game,
      sport: sportName,
      region: regionName,
      competition: competitionName,
      market: markets
    });
  };

  const resolveFromMap = (value: any, key: any, map: AnyObj | null) => {
    if (!map) return null;
    if (value !== null && value !== undefined && (typeof value === 'string' || typeof value === 'number')) {
      return map[String(value)] || null;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const looksLikeEntity = Boolean(value.name || value.game || value.competition || value.market || value.event);
      if (looksLikeEntity) return value;
      if (value.id !== null && value.id !== undefined && map[String(value.id)]) return map[String(value.id)];
    }
    if (key !== null && key !== undefined && map[String(key)]) return map[String(key)];
    return null;
  };

  const resolveCollection = (refs: any, map: AnyObj | null) => {
    if (!refs) return [];
    if (Array.isArray(refs)) {
      return refs.map(id => (map ? map[String(id)] : null)).filter(Boolean);
    }
    if (typeof refs === 'object') {
      return Object.entries(refs)
        .map(([k, v]) => resolveFromMap(v, k, map) || (v && typeof v === 'object' ? v : null))
        .filter(Boolean);
    }
    return [];
  };

  if (data && data.region) {
    for (const regionId in data.region) {
      const region = data.region[regionId];
      const competitions = resolveCollection(region?.competition, data.competition);
      for (const competition of competitions) {
        const games = resolveCollection((competition as any)?.game, data.game);
        for (const game of games) {
          pushGame(game as AnyObj, region?.name || regionId, (competition as any)?.name);
        }
      }
    }
  }

  if (allGames.length === 0 && data && data.sport) {
    for (const sId in data.sport) {
      const sport = data.sport[sId];

      if (sport?.region) {
        const regions = resolveCollection(sport.region, data.region);
        for (const region of regions) {
          const competitions = resolveCollection((region as any)?.competition, sport.competition || data.competition);
          for (const competition of competitions) {
            const games = resolveCollection((competition as any)?.game, sport.game || data.game);
            for (const game of games) {
              pushGame(game as AnyObj, (region as any)?.name, (competition as any)?.name);
            }
          }
        }
      } else if (sport?.competition) {
        const competitions = resolveCollection(sport.competition, data.competition);
        for (const competition of competitions) {
          const games = resolveCollection((competition as any)?.game, sport.game || data.game);
          for (const game of games) {
            pushGame(game as AnyObj, (sport as any)?.name, (competition as any)?.name);
          }
        }
      }
    }
  }

  return allGames;
}
