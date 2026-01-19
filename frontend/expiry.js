// =============================================================================
// CrypShare - Expiry & Countdown Module
// =============================================================================
// Handles file expiry selection and countdown timer display.
// =============================================================================

// State
let currentExpiresAt = null;
let countdownInterval = null;

// =============================================================================
// Custom Dropdown Initialization
// =============================================================================

/**
 * Initialize the custom animated dropdown.
 * Sets up event listeners for toggle, selection, and keyboard navigation.
 */
export function initializeExpiryDropdown() {
  // Initialize dropdown (if present)
  initializeDropdown();
  
  // Initialize pills (if present)
  initializePills();
}

/**
 * Initialize the dropdown UI (legacy/fallback).
 */
function initializeDropdown() {
  const dropdown = document.getElementById("expiryDropdown");
  const trigger = document.getElementById("dropdownTrigger");
  const menu = document.getElementById("dropdownMenu");
  const valueDisplay = document.getElementById("dropdownValue");
  const hiddenSelect = document.getElementById("expirySelect");

  if (!dropdown || !trigger || !menu) return;

  // Toggle dropdown on trigger click
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDropdown(dropdown);
  });

  // Handle option selection
  menu.addEventListener("click", (e) => {
    const option = e.target.closest(".dropdown-option");
    if (!option) return;

    const value = option.dataset.value;
    const text = option.textContent.trim();

    // Update visual state
    menu.querySelectorAll(".dropdown-option").forEach((opt) => {
      opt.classList.remove("selected");
    });
    option.classList.add("selected");

    // Update displayed value
    if (valueDisplay) {
      valueDisplay.textContent = text;
    }

    // Sync with hidden native select
    if (hiddenSelect) {
      hiddenSelect.value = value;
      // Dispatch change event for other listeners
      hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Close dropdown
    closeDropdown(dropdown);

    // Update expiry notice
    updateExpiryNotice();
  });

  // Keyboard navigation
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleDropdown(dropdown);
    } else if (e.key === "Escape") {
      closeDropdown(dropdown);
    } else if (e.key === "ArrowDown" && dropdown.classList.contains("open")) {
      e.preventDefault();
      focusNextOption(menu, 1);
    } else if (e.key === "ArrowUp" && dropdown.classList.contains("open")) {
      e.preventDefault();
      focusNextOption(menu, -1);
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target)) {
      closeDropdown(dropdown);
    }
  });

  // Close dropdown when pressing Escape anywhere
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDropdown(dropdown);
    }
  });
}

/**
 * Initialize the pills UI (modern single-click selection).
 */
function initializePills() {
  const pillsContainer = document.getElementById("expiryPills");
  const hiddenSelect = document.getElementById("expirySelect");

  if (!pillsContainer) return;

  const pills = pillsContainer.querySelectorAll(".expiry-pill");

  pills.forEach((pill) => {
    pill.addEventListener("click", (e) => {
      e.preventDefault();

      const value = pill.dataset.value;

      // Update visual state - remove selected from all, add to clicked
      pills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");

      // Sync with hidden native select
      if (hiddenSelect) {
        hiddenSelect.value = value;
        hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Update expiry notice (if present)
      updateExpiryNotice();
    });
  });
}

function toggleDropdown(dropdown) {
  if (dropdown.classList.contains("open")) {
    closeDropdown(dropdown);
  } else {
    openDropdown(dropdown);
  }
}

function openDropdown(dropdown) {
  dropdown.classList.add("open");
  const trigger = dropdown.querySelector(".dropdown-trigger");
  if (trigger) {
    trigger.setAttribute("aria-expanded", "true");
  }
}

function closeDropdown(dropdown) {
  dropdown.classList.remove("open");
  const trigger = dropdown.querySelector(".dropdown-trigger");
  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
  }
}

function focusNextOption(menu, direction) {
  const options = Array.from(menu.querySelectorAll(".dropdown-option"));
  const currentIndex = options.findIndex(
    (opt) => opt === document.activeElement || opt.classList.contains("selected")
  );
  let nextIndex = currentIndex + direction;

  if (nextIndex < 0) nextIndex = options.length - 1;
  if (nextIndex >= options.length) nextIndex = 0;

  options[nextIndex]?.focus();
}

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
  initializeExpiryDropdown,
  getSelectedExpiryHours,
  updateExpiryNotice,
  formatCountdown,
  startCountdownTimer,
  stopCountdownTimer
};
