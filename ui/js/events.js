function setupEventListeners() {
  // Tab switching
  const onModeChanged = () => {
    (async () => {
      // Clear live stream intervals when switching modes to prevent leaks
      if (typeof clearLiveStreamIntervals === 'function') {
        clearLiveStreamIntervals();
      }
      
      if (currentMode === 'results' && typeof ensureResultsSportsLoaded === 'function') {
        await ensureResultsSportsLoaded(true);
      }
      renderSportsList();

      const q = document.getElementById('sportSearch')?.value || '';
      if (q) filterSports(q);
    })();
  };

  const modePrematchEl = document.getElementById('modePrematch');
  const modeLiveEl = document.getElementById('modeLive');
  const modeResultsEl = document.getElementById('modeResults');

  if (modePrematchEl) modePrematchEl.addEventListener('click', onModeChanged);
  if (modeLiveEl) modeLiveEl.addEventListener('click', onModeChanged);
  if (modeResultsEl) modeResultsEl.addEventListener('click', onModeChanged);

  onModeChanged();

  // Search
  document.getElementById('sportSearch').addEventListener('input', (e) => {
    filterSports(e.target.value);
  });

  // Header buttons
  document.getElementById('refreshHierarchy').addEventListener('click', () => loadHierarchy(true));
  document.getElementById('bulkScrape').addEventListener('click', bulkScrape);
  document.getElementById('showHealth').addEventListener('click', showHealthModal);

  if (mobileSidebarToggle) {
    mobileSidebarToggle.addEventListener('click', () => {
      toggleMobileSidebar();
    });
  }

  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', () => {
      closeMobileSidebar();
      if (typeof stopLiveTracker === 'function') stopLiveTracker();
      if (typeof stopLiveGameStream === 'function') stopLiveGameStream();
      closeMobileDetails();
      mobileOverlay.classList.add('hidden');
    });
  }

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      if (sidebar) sidebar.classList.remove('mobile-open');
      if (gameDetailsPanel) gameDetailsPanel.classList.remove('mobile-open');
      if (mobileOverlay) mobileOverlay.classList.add('hidden');
    } else {
      hideMobileOverlayIfIdle();
    }
  });

  // Details panel
  document.getElementById('closeDetails').addEventListener('click', () => {
    if (typeof stopLiveTracker === 'function') stopLiveTracker();
    if (typeof stopLiveGameStream === 'function') stopLiveGameStream();
    closeMobileDetails();
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadHierarchy();
  loadHealth();
  setupEventListeners();
  
  // Start counts stream for real-time live/prematch counts
  if (typeof startCountsStream === 'function') {
    startCountsStream();
  }

  // Keep-alive: refresh health every 10 minutes
  // Store interval ID for cleanup to prevent memory leaks
  if (window.healthCheckIntervalId) {
    clearInterval(window.healthCheckIntervalId);
  }
  window.healthCheckIntervalId = setInterval(() => {
    loadHealth();
    console.log('Keep-alive health check');
  }, 10 * 60 * 1000);
});

// Close modal on outside click
healthModal.addEventListener('click', (e) => {
  if (e.target === healthModal) closeHealthModal();
});
// Cleanup function to prevent memory leaks
function cleanup() {
  if (window.healthCheckIntervalId) {
    clearInterval(window.healthCheckIntervalId);
    window.healthCheckIntervalId = null;
  }
  
  // Clear live stream intervals explicitly
  if (typeof clearLiveStreamIntervals === 'function') {
    clearLiveStreamIntervals();
  }
  
  // Clear odds animation timeouts to prevent memory leaks
  if (typeof clearAllOddsAnimationTimeouts === 'function') {
    clearAllOddsAnimationTimeouts();
  }
  
  // Stop all streams to clean up EventSource listeners
  if (typeof stopCountsStream === 'function') {
    stopCountsStream();
  }
  if (typeof stopLiveStream === 'function') {
    stopLiveStream();
  }
  if (typeof stopPrematchStream === 'function') {
    stopPrematchStream();
  }
  if (typeof stopLiveGameStream === 'function') {
    stopLiveGameStream();
  }
}

// Clean up on page unload to prevent memory leaks
window.addEventListener('beforeunload', cleanup);
window.addEventListener('unload', cleanup);