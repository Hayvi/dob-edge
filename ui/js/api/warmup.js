// Auto-warmup logic for cold starts
let warmupInProgress = false;
let warmupAttempts = 0;
const MAX_WARMUP_ATTEMPTS = 3;

async function triggerWarmup() {
  if (warmupInProgress || warmupAttempts >= MAX_WARMUP_ATTEMPTS) return false;
  
  warmupInProgress = true;
  warmupAttempts++;
  
  try {
    const response = await fetch('/api/warmup');
    const result = await response.json();
    
    if (result.status === 'warmed') {
      console.log('Worker warmed up successfully');
      showToast('Connection restored', 'success');
      return true;
    }
  } catch (error) {
    console.warn('Warmup failed:', error);
  } finally {
    warmupInProgress = false;
  }
  
  return false;
}

// Reset warmup attempts on successful connection
function resetWarmupAttempts() {
  warmupAttempts = 0;
}

// Auto-trigger warmup on connection failures
function handleConnectionFailure() {
  if (warmupAttempts < MAX_WARMUP_ATTEMPTS) {
    setTimeout(() => {
      triggerWarmup();
    }, 1000);
  }
}
