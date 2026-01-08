function unwrapSwarmData(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw.data;
  if (data && typeof data === 'object') {
    const d: any = data;
    if (d.data && typeof d.data === 'object') return d.data;
    return data;
  }
  return raw;
}

export function extractSportsCountsFromSwarm(rawData: unknown): { sports: Array<{ name: string; count: number }>; totalGames: number } {
  const data: any = unwrapSwarmData(rawData);
  const sports: Array<{ name: string; count: number }> = [];

  if (data && data.sport && typeof data.sport === 'object') {
    for (const s of Object.values<any>(data.sport)) {
      const name = s?.name;
      let count = 0;
      if (typeof s?.game === 'number') {
        count = Number(s.game) || 0;
      } else if (s?.game && typeof s.game === 'object') {
        count = Object.keys(s.game).length;
      }
      if (name && count > 0) {
        sports.push({ name: String(name), count: Number(count) || 0 });
      }
    }
  }

  const totalGames = sports.reduce((sum, s) => sum + (Number(s?.count) || 0), 0);
  return { sports, totalGames };
}
