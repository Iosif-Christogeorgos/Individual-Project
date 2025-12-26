// =============================================================================
// CrypShare - Expiry & Countdown Module
// =============================================================================
// Handles file expiry selection and countdown timer display.
// =============================================================================

// State
let currentExpiresAt = null;
let countdownInterval = null;

/**
 * Get the selected expiry time in hours from the dropdown.
 * @returns {number} Expiry hours (default 24)
 */
export function getSelectedExpiryHours() {
  const select = document.getElementById("expirySelect");
  return parseInt(select?.value || "24", 10);
}

/**
 * Update the expiry notice text based on selected value.
 */
export function updateExpiryNotice() {
  const expiryTimeEl = document.getElementById("expiryNoticeTime");
  const hours = getSelectedExpiryHours();
  
  if (expiryTimeEl) {
    if (hours < 24) {
      expiryTimeEl.textContent = `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      const days = hours / 24;
      expiryTimeEl.textContent = `${days} day${days > 1 ? 's' : ''}`;
    }
  }
}

/**
 * Format milliseconds into a human-readable countdown string.
 * @param {number} ms - Remaining milliseconds
 * @returns {string} Formatted countdown (e.g., "23:59:59" or "2d 5h 30m")
 */
export function formatCountdown(ms) {
  if (ms <= 0) return "Expired";
  
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Start the countdown timer with animated hourglass.
 * @param {number} expiresAt - Unix timestamp when file expires
 */
export function startCountdownTimer(expiresAt) {
  currentExpiresAt = expiresAt;
  const totalDuration = expiresAt - Date.now();
  
  // Clear any existing interval
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  
  const timerEl = document.getElementById("countdownTimer");
  const countdownContainer = document.getElementById("expiryCountdown");
  const sandTopMask = document.querySelector(".sand-top-mask");
  const sandBottomMask = document.querySelector(".sand-bottom-mask");
  const sandStream = document.querySelector(".sand-stream");
  
  if (!timerEl) return;
  
  function updateTimer() {
    const remaining = currentExpiresAt - Date.now();
    
    // Check if expired
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      showExpiredState(countdownContainer);
      return;
    }
    
    timerEl.textContent = formatCountdown(remaining);
    
    // Calculate progress (0 = full, 1 = empty)
    const progress = Math.max(0, Math.min(1, 1 - (remaining / totalDuration)));
    
    // Animate sand using clip masks
    if (sandTopMask && sandBottomMask) {
      // Top sand: mask moves DOWN to hide sand (drains from bottom)
      // At progress=0: y=0 (full), at progress=1: y=37 (empty - past the sand shape)
      const topMaskY = progress * 37;
      sandTopMask.setAttribute("y", topMaskY);
      
      // Bottom sand: mask moves UP to reveal sand (fills from top)
      // At progress=0: y=80 (hidden), at progress=1: y=43 (full)  
      const bottomMaskY = 80 - (progress * 37);
      sandBottomMask.setAttribute("y", bottomMaskY);
      
      // Sand stream visible while draining
      if (sandStream) {
        sandStream.style.opacity = (progress > 0.02 && progress < 0.98) ? 1 : 0;
      }
    }
  }
  
  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

/**
 * Show the expired state UI.
 */
function showExpiredState(container) {
  if (!container) return;
  
  container.innerHTML = `
    <div class="expired-message">
      <div class="expired-icon">⛔</div>
      <div class="expired-content">
        <span class="expired-title">File Has Expired</span>
        <span class="expired-subtitle">This link is no longer accessible</span>
      </div>
    </div>
  `;
  container.classList.add("expired");
}

/**
 * Stop the countdown timer.
 */
export function stopCountdownTimer() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// Default export for backward compatibility
export default {
  getSelectedExpiryHours,
  updateExpiryNotice,
  formatCountdown,
  startCountdownTimer,
  stopCountdownTimer
};
