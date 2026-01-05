async function loadHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    document.getElementById('cacheHits').textContent = data.cache?.hits || 0;
    document.getElementById('avgResponse').textContent = (data.responseTime?.avg || 0) + 'ms';
  } catch (error) {
    console.error('Failed to load health:', error);
  }
}

async function bulkScrape() {
  showLoading('Bulk scraping all sports... This may take a while.');
  try {
    const response = await fetch(`/api/fetch-all-sports?_=${Date.now()}`, { cache: 'no-store' });
    const data = await response.json();
    showToast(`Scraped ${data.count} sports. ${data.errors?.length || 0} errors.`,
      data.errors?.length ? 'info' : 'success');
    loadHealth();
  } catch (error) {
    showToast('Bulk scrape failed: ' + error.message, 'error');
  }
  hideLoading();
}

async function showHealthModal() {
  showLoading('Loading health data...');
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    renderHealthModal(data);
    healthModal.classList.remove('hidden');
  } catch (error) {
    showToast('Failed to load health: ' + error.message, 'error');
  }
  hideLoading();
}

function closeHealthModal() {
  healthModal.classList.add('hidden');
}

function updateStats() {
  loadHealth();
}
