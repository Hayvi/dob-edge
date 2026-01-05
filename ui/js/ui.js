function sortByOrderAsc(a, b) {
  const ao = a?.order ?? Number.MAX_SAFE_INTEGER;
  const bo = b?.order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

function formatOddValue(price) {
  return typeof price === 'number' && Number.isFinite(price) ? price.toFixed(2) : '-';
}

// UI Helpers
function showLoading(text = 'Loading...') {
  loadingText.textContent = text;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function formatUptime(seconds) {
  if (!seconds) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
