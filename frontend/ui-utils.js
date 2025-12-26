// =============================================================================
// CrypShare - Shared UI Utilities Module
// =============================================================================
// Common UI helper functions shared between upload.js and download.js
// =============================================================================

const UIUtils = (function () {
  "use strict";

  // ===========================================================================
  // Alert Functions
  // ===========================================================================

  /**
   * Show an alert message to the user.
   * @param {string} title - Alert title
   * @param {string} message - Alert message
   * @param {string} type - Alert type: 'error', 'success', 'info', or 'warning'
   */
  function showAlert(title, message, type = "error") {
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
      error: "⚠️",
      success: "✅",
      info: "ℹ️",
      warning: "⚡",
    };
    
    if (alertIcon) {
      alertIcon.textContent = icons[type] || icons.error;
    }

    alert.classList.add("show");
  }

  /**
   * Hide the alert message.
   */
  function hideAlert() {
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
  function showToast(message, duration = 3000) {
    // Remove existing toast if any
    const existingToast = document.querySelector(".toast-notification");
    if (existingToast) {
      existingToast.remove();
    }

    // Create toast element
    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.innerHTML = `<span class="toast-icon">ℹ️</span><span class="toast-message">${escapeHtml(message)}</span>`;
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
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  /**
   * Escape HTML special characters to prevent XSS.
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  function escapeHtml(text) {
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
  function updateProgress(percent, status) {
    const container = document.getElementById("progressContainer");
    const track = document.getElementById("progressTrack");
    const percentEl = document.getElementById("progressPercent");
    const statusEl = document.getElementById("progressStatus");

    if (!container) return;

    container.classList.add("show");

    if (track) {
      const filled = Math.floor(percent / 4);
      const empty = 25 - filled;
      track.textContent = "[" + "#".repeat(filled) + ".".repeat(empty) + "]";
    }

    if (percentEl) {
      percentEl.textContent = percent + "%";
    }

    if (statusEl) {
      statusEl.textContent = status;
    }
  }

  /**
   * Hide progress display.
   */
  function hideProgress() {
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
  function updateStep(stepId, status) {
    const step = document.getElementById(stepId);
    if (!step) return;

    const icon = step.querySelector(".status-icon");

    step.classList.remove("pending", "complete", "error");
    step.classList.add(status);

    if (icon) {
      if (status === "complete") {
        icon.textContent = "✓";
      } else if (status === "error") {
        icon.textContent = "✗";
      } else {
        icon.textContent = "○";
      }
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  return {
    showAlert,
    hideAlert,
    showToast,
    formatFileSize,
    escapeHtml,
    updateProgress,
    hideProgress,
    updateStep,
  };
})();

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = UIUtils;
}
