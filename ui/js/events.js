function setupEventListeners() {
  // Tab switching
  const onModeChanged = () => {
    (async () => {
      // Initial load of sports data - SSE will handle real-time updates via counts-stream
      await ensureAllSportsLoaded(true);
      renderSportsList();

      const q = document.getElementById('sportSearch')?.value || '';
      if (q) filterSports(q);
    })();
  };

  const modePrematchEl = document.getElementById('modePrematch');
  const modeLiveEl = document.getElementById('modeLive');
  const modeCachedEl = document.getElementById('modeCached');
  const modeResultsEl = document.getElementById('modeResults');

  if (modePrematchEl) modePrematchEl.addEventListener('click', onModeChanged);
  if (modeLiveEl) modeLiveEl.addEventListener('click', onModeChanged);
  if (modeCachedEl) modeCachedEl.addEventListener('click', onModeChanged);
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
  setInterval(() => {
    loadHealth();
    console.log('Keep-alive health check');
  }, 10 * 60 * 1000);
});

// Close modal on outside click
healthModal.addEventListener('click', (e) => {
  if (e.target === healthModal) closeHealthModal();
});
