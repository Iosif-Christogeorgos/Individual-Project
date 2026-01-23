// =============================================================================
// CrypShare - Shared UI Utilities Module (ES Module)
// =============================================================================
// Common UI helper functions shared between upload.js and download.js
// =============================================================================

import { hapticError, hapticSuccess, hapticNotification } from "./haptics.js";

// ===========================================================================
// Alert Functions
// ===========================================================================

/**
 * Show an alert message to the user.
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @param {string} type - Alert type: 'error', 'success', 'info', or 'warning'
 */
export function showAlert(title, message, type = "error") {
  // Trigger appropriate haptic feedback based on alert type
  if (type === "error" || type === "warning") {
    hapticError();
  } else if (type === "success") {
    hapticSuccess();
  } else {
    hapticNotification();
  }
  const alert = document.getElementById("alert");
  const alertTitle = document.getElementById("alert-title");
  const alertMessage = document.getElementById("alert-message");
  const alertIcon = alert?.querySelector(".alert-icon") || document.getElementById("alert-icon");

  if (!alert || !alertTitle || !alertMessage) {
    console.error("Alert elements not found in DOM");
    return;
  }

  alertTitle.textContent = title;
  alertMessage.textContent = message;

  // Remove all type classes and add the correct one
  alert.classList.remove(
    "alert-error",
    "alert-success",
    "alert-info",
    "alert-warning"
  );
  alert.classList.add(`alert-${type}`);

  // Update icon based on type
  const icons = {
    error: '<svg class="lucide-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    success: '<svg class="lucide-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    info: '<svg class="lucide-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    warning: '<svg class="lucide-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
  };
  
  if (alertIcon) {
    alertIcon.innerHTML = icons[type] || icons.error;
  }

  alert.classList.add("show");
}

/**
 * Hide the alert message.
 */
export function hideAlert() {
  const alert = document.getElementById("alert");
  if (alert) {
    alert.classList.remove("show");
  }
}

// ===========================================================================
// Toast Notifications
// ===========================================================================

/**
 * Show a toast notification.
 * @param {string} message - Toast message
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export function showToast(message, duration = 3000) {
  // Trigger notification haptic feedback
  hapticNotification();

  // Remove existing toast if any
  const existingToast = document.querySelector(".toast-notification");
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.innerHTML = `<span class="toast-icon"><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span><span class="toast-message">${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  // Auto-remove after duration
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===========================================================================
// Formatting Utilities
// ===========================================================================

/**
 * Format bytes to human-readable file size.
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

/**
 * Format expiry hours into a human-readable string.
 * @param {number} hours - Expiry duration in hours
 * @returns {string} Human-readable duration (e.g., "24 hours" or "3 days")
 */
export function formatExpiryDuration(hours) {
  if (hours < 24) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ===========================================================================
// Progress Display
// ===========================================================================

/**
 * Update progress display.
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} status - Status message
 */
export function updateProgress(percent, status) {
  const container = document.getElementById("progressContainer");
  const track = document.getElementById("progressTrack");
  const percentEl = document.getElementById("progressPercent");
  const statusEl = document.getElementById("progressStatus");

  // Hide the progress bar - we use the lock animation instead
  if (container) {
    container.classList.remove("show");
  }

  // Update encryption animation with progress
  if (window.encryptionAnimator) {
    window.encryptionAnimator.updateProgressDisplay(percent, status);
  }
}

/**
 * Hide progress display.
 */
export function hideProgress() {
  const container = document.getElementById("progressContainer");
  if (container) {
    container.classList.remove("show");
  }
}

// ===========================================================================
// DOM Utilities
// ===========================================================================

/**
 * Update step status indicator.
 * @param {string} stepId - Step element ID
 * @param {string} status - Status: 'pending', 'complete', or 'error'
 */
export function updateStep(stepId, status) {
  const step = document.getElementById(stepId);
  if (!step) return;

  const icon = step.querySelector(".status-icon");

  step.classList.remove("pending", "complete", "error");
  step.classList.add(status);

  if (icon) {
    if (status === "complete") {
      icon.innerHTML = '<svg class="lucide-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyber-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    } else if (status === "error") {
      icon.innerHTML = '<svg class="lucide-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    } else {
      icon.textContent = "○";
    }
  }
}

// ===========================================================================
// Legacy UIUtils Object (for backward compatibility)
// ===========================================================================

const UIUtils = {
  showAlert,
  hideAlert,
  showToast,
  formatFileSize,
  formatExpiryDuration,
  escapeHtml,
  updateProgress,
  hideProgress,
  updateStep,
};

export default UIUtils;
