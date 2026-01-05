function getLiveMeta(game) {
  const info = game?.info;
  const stats = game?.stats;
  
  // Handle case where info is missing but we have game-level scores
  const hasInfo = info && typeof info === 'object';
  const hasStats = stats && typeof stats === 'object';
  
  if (!hasInfo && !hasStats && game?.score1 === undefined && game?.score2 === undefined) {
    return { scoreText: '', timeText: '', periodScores: null };
  }

  const sportName = String(game?.sport || '').toLowerCase();
  const isFootball = sportName.includes('football') || sportName.includes('soccer');
  const isCricket = sportName.includes('cricket');
  const isEsports =
    sportName.includes('dota') ||
    sportName.includes('counter') ||
    sportName.includes('cs') ||
    sportName.includes('valorant') ||
    sportName.includes('league');
  const isSetSport =
    sportName.includes('tennis') ||
    sportName.includes('table tennis') ||
    sportName.includes('volleyball') ||
    sportName.includes('badminton') ||
    sportName.includes('squash');
  const isHockey = sportName.includes('hockey');

  const pickString = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const pickNum = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v.trim());
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const looksLikeClock = (s) => {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    if (!t) return false;
    return /^\d{1,2}:\d{2}$/.test(t) || /^\d{1,2}:\d{2}:\d{2}$/.test(t);
  };

  // Check if text_info contains period scores (parentheses with scores)
  const textInfoHasPeriodScores = (text) => {
    if (!text) return false;
    // Match patterns like (14:18), (19:16) or (1:0), (0:0)
    return /\(\d+:\d+\)/.test(text);
  };

  // Extract period/quarter scores from stats object
  // Only used when text_info doesn't already contain them
  const extractPeriodScores = () => {
    if (!hasStats) return null;
    
    // If text_info already has period scores, don't extract separately
    const textInfo = game?.text_info;
    if (textInfoHasPeriodScores(textInfo)) return null;
    
    const periods = [];
    
    // Try different stats structures
    for (let i = 1; i <= 10; i++) {
      const setKey = `score_set${i}`;
      const quarterKey = `score_quarter${i}`;
      const periodKey = `score_period${i}`;
      const halfKey = `score_half${i}`;
      
      const val = stats[setKey] || stats[quarterKey] || stats[periodKey] || stats[halfKey];
      if (val && typeof val === 'object') {
        const home = pickNum(val.team1_value ?? val.home ?? val.h ?? val.team1);
        const away = pickNum(val.team2_value ?? val.away ?? val.a ?? val.team2);
        if (home !== null || away !== null) {
          periods.push({ home: home ?? 0, away: away ?? 0 });
        }
      } else if (typeof val === 'string' && val.includes(':')) {
        const [h, a] = val.split(':').map(Number);
        if (Number.isFinite(h) && Number.isFinite(a)) {
          periods.push({ home: h, away: a });
        }
      }
    }
    
    // Structure 2: stats.sets or stats.quarters array
    const setsArr = stats.sets || stats.quarters || stats.periods || stats.halves;
    if (Array.isArray(setsArr)) {
      for (const s of setsArr) {
        if (s && typeof s === 'object') {
          const home = pickNum(s.team1_value ?? s.home ?? s.h ?? s.team1 ?? s.score1);
          const away = pickNum(s.team2_value ?? s.away ?? s.a ?? s.team2 ?? s.score2);
          if (home !== null || away !== null) {
            periods.push({ home: home ?? 0, away: away ?? 0 });
          }
        }
      }
    }
    
    return periods.length > 0 ? periods : null;
  };

  const periodScores = extractPeriodScores();

  // Build score text - UNIVERSAL approach
  // Priority: text_info (already formatted by API)
  let scoreText = '';
  
  // 1. text_info - The API's pre-formatted score string (works for ALL sports)
  const textInfo = game?.text_info;
  if (typeof textInfo === 'string' && textInfo.trim()) {
    scoreText = textInfo.trim();
  }
  
  // 2. Fallback: build from stats/info if text_info not available
  if (!scoreText) {
    const scoreCandidates = [];
    
    if (hasStats) {
      for (let i = 1; i <= 5; i++) {
        const setKey = `score_set${i}`;
        const scoreSet = stats[setKey];
        if (scoreSet && typeof scoreSet === 'object') {
          const t1 = scoreSet.team1_value;
          const t2 = scoreSet.team2_value;
          if (t1 !== undefined || t2 !== undefined) {
            const parts = [t1, t2].filter(v => v !== undefined && v !== null && v !== '');
            if (parts.length > 0) {
              scoreCandidates.push(parts.join(' - '));
            }
            break;
          }
        }
      }
      
      const points = stats.point ?? stats.score ?? stats.goals;
      if (points && typeof points === 'object') {
        const p1 = points.team1_value;
        const p2 = points.team2_value;
        if (p1 !== undefined || p2 !== undefined) {
          const wickets = stats.wicet ?? stats.wicket;
          if (isCricket && wickets) {
            const w1 = wickets.team1_value;
            const w2 = wickets.team2_value;
            const s1 = w1 !== undefined ? `${p1 ?? 0}/${w1}` : String(p1 ?? 0);
            const s2 = w2 !== undefined ? `${p2 ?? 0}/${w2}` : String(p2 ?? 0);
            scoreCandidates.push(`${s1} - ${s2}`);
          } else {
            scoreCandidates.push(`${p1 ?? 0}-${p2 ?? 0}`);
          }
        }
      }
    }
    
    if (hasInfo) {
      const infoScore = info.score ?? info.ss ?? info.score_str ?? info.scoreString ?? info.current_score;
      if (typeof infoScore === 'string' && infoScore.trim()) {
        scoreCandidates.push(infoScore.trim());
      }
      
      const score1 = info.score1 ?? info.home_score ?? info.score_home ?? info.team1_score;
      const score2 = info.score2 ?? info.away_score ?? info.score_away ?? info.team2_score;
      if (score1 !== undefined || score2 !== undefined) {
        const formatScore = (s) => {
          if (typeof s === 'string' && s.trim()) return s.trim();
          if (typeof s === 'number') return String(s);
          if (s && typeof s === 'object') {
            const val = s.runs ?? s.score ?? s.value ?? s.total;
            const extra = s.wickets ?? s.wicket ?? s.w;
            if (val !== undefined) {
              return extra !== undefined ? `${val}/${extra}` : String(val);
            }
          }
          return null;
        };
        const s1 = formatScore(score1);
        const s2 = formatScore(score2);
        if (s1 || s2) {
          scoreCandidates.push(`${s1 || '0'}-${s2 || '0'}`);
        }
      }
    }
    
    const gameScore1 = game?.score1;
    const gameScore2 = game?.score2;
    if (gameScore1 !== undefined || gameScore2 !== undefined) {
      const s1 = gameScore1 !== undefined ? String(gameScore1) : '0';
      const s2 = gameScore2 !== undefined ? String(gameScore2) : '0';
      if (s1 !== '0' || s2 !== '0' || scoreCandidates.length === 0) {
        scoreCandidates.push(`${s1}-${s2}`);
      }
    }

    for (const c of scoreCandidates) {
      if (typeof c === 'string' && c.trim()) {
        scoreText = c.trim();
        break;
      }
    }
  }

  // Build time/phase text - only if not already in scoreText
  // text_info often includes time at the end, so check for that
  let timeText = '';
  
  // Check if scoreText already contains time info (clock pattern at end)
  const scoreHasTime = scoreText && /\d{1,2}:\d{2}['"]?\s*$/.test(scoreText);
  const scoreHasPhase = scoreText && /\b(Set|P|Q|H|Map|Round|Inning)\s*\d/i.test(scoreText);
  
  if (!scoreHasTime || !scoreHasPhase) {
    const pickBestClock = (candidates) => {
      const toClockCandidate = (val) => {
        if (val === null || val === undefined) return null;
        if (typeof val === 'number' && Number.isFinite(val)) {
          return { raw: val, text: `${val}'`, score: 70 + Math.min(300, Math.max(0, val)) };
        }
        if (typeof val !== 'string') return null;
        const s = val.trim();
        if (!s) return null;

        const mmss = s.match(/^(\d{1,2}):(\d{2})$/);
        if (mmss) {
          const mm = Number(mmss[1]);
          const ss = Number(mmss[2]);
          if (Number.isFinite(mm) && Number.isFinite(ss)) {
            const base = mm >= 2 ? 120 : 60;
            return { raw: s, text: s, score: base + mm };
          }
        }

        const min = s.match(/^(\d{1,3})\s*'?$/);
        if (min && s.endsWith("'")) {
          const m = Number(min[1]);
          if (Number.isFinite(m)) return { raw: s, text: `${m}'`, score: 90 + Math.min(300, m) };
        }

        if (isFootball && min && !s.endsWith("'")) {
          const m = Number(min[1]);
          if (Number.isFinite(m)) return { raw: s, text: `${m}'`, score: 88 + Math.min(300, m) };
        }

        if (s.includes(':')) {
          return { raw: s, text: s, score: 80 };
        }

        return { raw: s, text: s, score: 10 };
      };

      const scored = [];
      for (const v of candidates) {
        const c = toClockCandidate(v);
        if (c) scored.push(c);
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.length ? scored[0].text : '';
    };

    const buildPhaseText = () => {
      if (!hasInfo) return '';
      
      const bo = pickNum(info.best_of ?? info.bo ?? info.bestOf);

      const rawPeriod =
        pickString(info.period_name) ||
        pickString(info.period) ||
        pickString(info.period_str) ||
        pickString(info.stage) ||
        pickString(info.stage_name) ||
        pickString(info.phase) ||
        pickString(info.current_game_state) ||
        '';
      const quarter = pickNum(info.quarter ?? info.q ?? info.current_quarter);
      const set = pickNum(info.set ?? info.current_set);
      const map = pickNum(info.map ?? info.current_map ?? info.map_number);
      const round = pickNum(info.round ?? info.current_round);
      const inning = pickNum(info.inning ?? info.current_inning);
      const frame = pickNum(info.frame ?? info.current_frame);

      let phase = rawPeriod;

      if (phase) {
        const m = phase.match(/^set(\d+)$/i);
        if (m) {
          const n = Number(m[1]);

          const hasStoppage = Boolean(info.stoppage_firsthalf || info.stoppage_secondhalf);
          const addMin = pickNum(info.add_minutes ?? info.added_minutes ?? info.addMinutes ?? info.addedMinutes);
          const hasFootballSignals = isFootball || hasStoppage || (addMin !== null && addMin > 0);

          const hasSetCount = info.set_count !== undefined || info.setCount !== undefined;
          const hasAdditionalData = info.additional_data !== undefined || info.additionalData !== undefined;
          const hasClock = looksLikeClock(pickString(info.current_game_time)) || looksLikeClock(pickString(info.time)) || looksLikeClock(pickString(info.timer));

          if (isCricket) {
            const ordinal = n === 1 ? '1st' : n === 2 ? '2nd' : `${n}th`;
            phase = `${ordinal} Innings`;
          } else if (hasFootballSignals) {
            if (n === 1) phase = '1H';
            else if (n === 2) phase = '2H';
            else if (n === 3) phase = 'ET1';
            else if (n === 4) phase = 'ET2';
          } else if (isSetSport || hasSetCount) {
            phase = `Set ${n}`;
          } else if (isEsports || hasAdditionalData) {
            phase = `Map ${n}`;
          } else if (isHockey || hasClock) {
            phase = `P${n}`;
          } else {
            phase = `Set ${n}`;
          }
        }
      }

      if (isCricket) {
        const innings = pickNum(info.innings ?? info.current_innings ?? info.inning ?? info.current_inning);
        if (innings !== null && !phase) {
          const ordinal = innings === 1 ? '1st' : innings === 2 ? '2nd' : `${innings}th`;
          phase = `${ordinal} Innings`;
        }
        const over = pickString(info.over_number ?? info.over ?? info.overs);
        if (over) {
          phase = phase ? `${phase} Ov ${over}` : `Ov ${over}`;
        }
      }

      if (!phase) {
        if (quarter !== null) phase = `Q${quarter}`;
        else if (set !== null) phase = `Set ${set}`;
        else if (map !== null) phase = `Map ${map}`;
        else if (inning !== null) phase = `Inning ${inning}`;
        else if (frame !== null) phase = `Frame ${frame}`;
        else if (round !== null && (sportName.includes('counter') || sportName.includes('cs'))) phase = `Round ${round}`;
      }

      if (bo !== null && phase) phase = `${phase} (Bo${bo})`;
      if (!phase && bo !== null && (sportName.includes('counter') || sportName.includes('cs'))) phase = `Bo${bo}`;
      return phase;
    };

    const phaseText = !scoreHasPhase ? buildPhaseText() : '';

    const clockCandidates = hasInfo ? [
      info.time,
      info.timer,
      info.timer_main,
      info.timer_main_str,
      info.match_time,
      info.match_clock,
      info.current_game_time,
      info.game_time,
      info.game_clock,
      info.period_time,
      info.period_clock,
      info.clock_time,
      info.clock,
      info.minute,
      info.min
    ] : [];

    let clockText = !scoreHasTime ? pickBestClock(clockCandidates) : '';

    if (isFootball && hasInfo && clockText) {
      const add = Number(info.add_minutes ?? info.added_minutes ?? info.addMinutes ?? info.addedMinutes);
      const baseMatch = clockText.match(/^(\d{1,3})'$/);
      if (Number.isFinite(add) && add > 0 && baseMatch) {
        clockText = `${Number(baseMatch[1])}+${add}'`;
      }
    }
    
    timeText = phaseText && clockText
      ? `${phaseText} ${clockText}`
      : (phaseText || clockText);
  }

  return { scoreText, timeText, periodScores };
}
