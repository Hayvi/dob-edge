// State
let hierarchy = null;
let currentSport = null;
let currentCompetition = null;
let currentGames = [];
let selectedGame = null;
let cachedMode = false; // Use this for backward compatibility or simple check
let currentMode = 'prematch'; // 'prematch', 'live', 'cached', 'results'

let sportsWithCachedGames = null;
let sportsWithPrematchGames = null;
let sportsWithLiveGames = null;
let sportsWithResults = null;

let sportsCountsCached = null;
let sportsCountsPrematch = null;
let sportsCountsLive = null;
let sportsCountsResults = null;

let totalGamesCached = null;
let totalGamesPrematch = null;
let totalGamesLive = null;
let totalGamesResults = null;

// Sport icons mapping
const sportIcons = {
  'Football': '⚽', 'Basketball': '🏀', 'Tennis': '🎾', 'Ice Hockey': '🏒',
  'Volleyball': '🏐', 'Handball': '🤾', 'Baseball': '⚾', 'American Football': '🏈',
  'Table Tennis': '🏓', 'Cricket': '🏏', 'Rugby': '🏉', 'Golf': '⛳',
  'Boxing': '🥊', 'MMA': '🥋', 'Darts': '🎯', 'Snooker': '🎱',
  'Chess': '♟️', 'Cycling': '🚴', 'Formula 1': '🏎️', 'default': '🏆'
};

// Region flags
const regionFlags = {
  'Europe': '🇪🇺', 'World': '🌍', 'England': '🏴', 'Spain': '🇪🇸',
  'Germany': '🇩🇪', 'Italy': '🇮🇹', 'France': '🇫🇷', 'Africa': '🌍',
  'Asia': '🌏', 'America': '🌎', 'default': '🏳️'
};

// UI Elements & Mode Logic
const btnModePrematch = document.getElementById('modePrematch');
const btnModeLive = document.getElementById('modeLive');
const btnModeCached = document.getElementById('modeCached');
const btnModeResults = document.getElementById('modeResults');

function setMode(mode) {
  currentMode = mode;
  cachedMode = (mode === 'cached');

  // Stop streams that don't apply to new mode
  if (mode !== 'live' && typeof stopLiveStream === 'function') {
    stopLiveStream();
  }
  if (mode !== 'prematch' && typeof stopPrematchStream === 'function') {
    stopPrematchStream();
  }

  // Update UI
  [btnModePrematch, btnModeLive, btnModeCached, btnModeResults].forEach(btn => btn?.classList.remove('active'));

  const activeBtn = document.getElementById(`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Trigger data refresh
  renderSportsList();

  // Clear current games view to indicate switch
  currentGames = [];
  const gamesListEl = document.getElementById('gamesList');
  if (gamesListEl) gamesListEl.innerHTML = '';
  document.getElementById('gamesCount').textContent = '0 games';

  if (currentSport) {
    // Reload based on new mode
    if (mode === 'live') {
      if (typeof startLiveStream === 'function') {
        startLiveStream(currentSport?.id || null);
      }
      loadLiveGames(currentSport.id, currentSport.name);
    } else if (mode === 'cached') {
      loadGames(currentSport.id, currentSport.name);
    } else if (mode === 'results') {
      loadResultGames(currentSport.id, currentSport.name);
    } else if (mode === 'prematch') {
      // Use subscription-based stream for prematch
      if (typeof startPrematchStream === 'function') {
        startPrematchStream(currentSport?.id);
      }
    }
  } else if (mode === 'live') {
    if (typeof startLiveStream === 'function') {
      startLiveStream(null);
    }
  }
}

if (btnModePrematch) btnModePrematch.addEventListener('click', () => setMode('prematch'));
if (btnModeLive) btnModeLive.addEventListener('click', () => setMode('live'));
if (btnModeCached) btnModeCached.addEventListener('click', () => setMode('cached'));
if (btnModeResults) btnModeResults.addEventListener('click', () => setMode('results'));
