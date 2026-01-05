function isMobileLayout() {
  return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
}

function showMobileOverlay() {
  if (!mobileOverlay || !isMobileLayout()) return;
  mobileOverlay.classList.remove('hidden');
}

function hideMobileOverlayIfIdle() {
  if (!mobileOverlay || !isMobileLayout()) return;
  const sidebarOpen = sidebar && sidebar.classList.contains('mobile-open');
  const detailsOpen = gameDetailsPanel && gameDetailsPanel.classList.contains('mobile-open');
  if (!sidebarOpen && !detailsOpen) {
    mobileOverlay.classList.add('hidden');
  }
}

function openMobileSidebar() {
  if (!sidebar || !isMobileLayout()) return;
  sidebar.classList.add('mobile-open');
  showMobileOverlay();
  updateMobileNavActive('sports');
}

function closeMobileSidebar() {
  if (!sidebar) return;
  sidebar.classList.remove('mobile-open');
  hideMobileOverlayIfIdle();
}

function toggleMobileSidebar() {
  if (!sidebar || !isMobileLayout()) return;
  if (sidebar.classList.contains('mobile-open')) closeMobileSidebar();
  else openMobileSidebar();
}

function openMobileDetails() {
  if (!gameDetailsPanel || !isMobileLayout()) return;
  gameDetailsPanel.classList.remove('hidden');
  gameDetailsPanel.classList.add('mobile-open');
  showMobileOverlay();
}

function closeMobileDetails() {
  if (!gameDetailsPanel) return;
  if (isMobileLayout()) {
    gameDetailsPanel.classList.remove('mobile-open');
    gameDetailsPanel.classList.add('hidden');
    hideMobileOverlayIfIdle();
    return;
  }
  gameDetailsPanel.classList.add('hidden');
}

function updateMobileNavActive(tab) {
  const navBtns = document.querySelectorAll('.mobile-nav-btn');
  navBtns.forEach(btn => btn.classList.remove('active'));
  
  if (tab === 'sports') {
    document.getElementById('mobileNavSports')?.classList.add('active');
  } else if (tab === 'live') {
    document.getElementById('mobileNavLive')?.classList.add('active');
  }
}

function initMobileBottomNav() {
  const navSports = document.getElementById('mobileNavSports');
  const navLive = document.getElementById('mobileNavLive');
  const navRefresh = document.getElementById('mobileNavRefresh');

  if (navSports) {
    navSports.addEventListener('click', () => {
      openMobileSidebar();
    });
  }

  if (navLive) {
    navLive.addEventListener('click', () => {
      closeMobileSidebar();
      closeMobileDetails();
      // Switch to live mode
      if (typeof switchMode === 'function') {
        switchMode('live');
      } else {
        // Fallback: click the live mode button
        const liveBtn = document.getElementById('modeLive');
        if (liveBtn) liveBtn.click();
      }
      updateMobileNavActive('live');
    });
  }

  if (navRefresh) {
    navRefresh.addEventListener('click', () => {
      // Trigger refresh
      const refreshBtn = document.getElementById('refreshHierarchy');
      if (refreshBtn) refreshBtn.click();
    });
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileBottomNav);
} else {
  initMobileBottomNav();
}
