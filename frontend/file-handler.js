// =============================================================================
// CrypShare - File Handler Module
// =============================================================================
// Handles file selection, validation, and drag & drop functionality.
// =============================================================================

import { showAlert, hideAlert, formatFileSize } from './ui-utils.js';

// Absolute maximum file size (used for initial file selection validation)
const MAX_FILE_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB

// =============================================================================
// Dynamic File Size Limits Based on Expiration Duration
// =============================================================================
// Longer expiration periods = smaller max file size to manage storage
export const EXPIRY_SIZE_LIMITS = {
  1: 1.5 * 1024 * 1024 * 1024,   // 1 hour: 1.5 GB
  6: 1.0 * 1024 * 1024 * 1024,   // 6 hours: 1.0 GB
  24: 500 * 1024 * 1024,          // 24 hours: 500 MB
  72: 200 * 1024 * 1024,          // 3 days: 200 MB
  168: 100 * 1024 * 1024,         // 7 days: 100 MB
};

/**
 * Get the maximum allowed file size for a given expiry duration.
 * @param {number} expiryHours - Expiry duration in hours
 * @returns {number} Max file size in bytes
 */
export function getMaxFileSizeForExpiry(expiryHours) {
  return EXPIRY_SIZE_LIMITS[expiryHours] || EXPIRY_SIZE_LIMITS[24]; // Default to 24h limit
}

/**
 * Format expiry hours into a human-readable string.
 * @param {number} hours - Expiry duration in hours
 * @returns {string} Human-readable duration (e.g., "24 hours" or "3 days")
 */
function formatExpiryDuration(hours) {
  if (hours < 24) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  const days = hours / 24;
  return `${days} day${days > 1 ? 's' : ''}`;
}

/**
 * Validate a file against the size limit for a specific expiry duration.
 * @param {File} file - The file to validate
 * @param {number} expiryHours - Expiry duration in hours
 * @returns {{ valid: boolean, maxSize: number, message: string|null }}
 */
export function validateFileForExpiry(file, expiryHours) {
  const maxSize = getMaxFileSizeForExpiry(expiryHours);
  
  if (file.size > maxSize) {
    const duration = formatExpiryDuration(expiryHours);
    return {
      valid: false,
      maxSize: maxSize,
      message: `For ${duration} expiry, maximum file size is ${formatFileSize(maxSize)}. Your file is ${formatFileSize(file.size)}.`
    };
  }
  
  return {
    valid: true,
    maxSize: maxSize,
    message: null
  };
}

/**
 * Initialize file input and drag & drop handlers.
 * @param {Function} onFileSelected - Callback when a valid file is selected
 */
export function initializeFileHandler(onFileSelected) {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  if (!dropZone || !fileInput) return;

  // Initialize the Matrix binary rain effect
  initializeBinaryRain(dropZone);

  // Drag events
  ["dragenter", "dragover"].forEach((event) => {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((event) => {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFileSelect(files[0], onFileSelected);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0], onFileSelected);
    }
  });
}

/**
 * Handle file selection (from input or drag & drop).
 * Uses absolute max (1.5GB) for initial validation - expiry-specific validation
 * happens when expiry changes or at upload time.
 * @param {File} file - The selected file
 * @param {Function} onValid - Callback when file is valid
 */
export function handleFileSelect(file, onValid) {
  hideAlert();
  
  const fileSelected = document.getElementById("fileSelected");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  // Check against absolute maximum (expiry-specific check happens at upload time)
  if (file.size > MAX_FILE_SIZE) {
    showAlert(
      "File Too Large",
      `Maximum file size is ${formatFileSize(MAX_FILE_SIZE)}. Your file is ${formatFileSize(file.size)}.`,
      "error"
    );
    clearFile();
    return;
  }

  // Update file input
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;

  // Update UI
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileSelected.classList.add("show");
  dropZone.classList.add("hidden");

  if (onValid) {
    onValid(file);
  }
}

/**
 * Clear the selected file and reset UI.
 */
export function clearFile() {
  const fileInput = document.getElementById("fileInput");
  const fileSelected = document.getElementById("fileSelected");
  const dropZone = document.getElementById("dropZone");

  if (fileInput) fileInput.value = "";
  if (fileSelected) fileSelected.classList.remove("show");
  if (dropZone) dropZone.classList.remove("hidden");
}

/**
 * Get the currently selected file.
 * @returns {File|null} The selected file or null
 */
export function getSelectedFile() {
  const fileInput = document.getElementById("fileInput");
  return fileInput?.files?.[0] || null;
}

/**
 * Get the maximum allowed file size (absolute max).
 * @returns {number} Max file size in bytes
 */
export function getMaxFileSize() {
  return MAX_FILE_SIZE;
}

// =============================================================================
// Matrix Binary Rain Effect
// =============================================================================

/**
 * Initialize the Matrix-style binary rain effect for the drop zone.
 * Creates multiple columns of falling 0s and 1s with varied speeds.
 * @param {HTMLElement} dropZone - The drop zone element
 */
function initializeBinaryRain(dropZone) {
  // Create the rain container
  const rainContainer = document.createElement('div');
  rainContainer.className = 'binary-rain';
  
  // Number of columns based on container width (roughly 1 column per 25px)
  const numColumns = 18;
  
  for (let i = 0; i < numColumns; i++) {
    const column = document.createElement('div');
    column.className = 'rain-column';
    
    // Random animation speed for variety (but no delay - all start together)
    const duration = 1.5 + Math.random() * 2; // 1.5s to 3.5s
    
    column.style.setProperty('--fall-duration', `${duration}s`);
    
    // Generate random binary digits (6-12 characters per column)
    const numDigits = 6 + Math.floor(Math.random() * 7);
    for (let j = 0; j < numDigits; j++) {
      const digit = document.createElement('span');
      digit.textContent = Math.random() > 0.5 ? '1' : '0';
      column.appendChild(digit);
    }
    
    rainContainer.appendChild(column);
  }
  
  // Insert rain container at the beginning of dropZone
  dropZone.insertBefore(rainContainer, dropZone.firstChild);
  
  // Regenerate digits periodically for more dynamic effect
  setInterval(() => {
    const columns = rainContainer.querySelectorAll('.rain-column');
    columns.forEach(column => {
      const spans = column.querySelectorAll('span');
      spans.forEach(span => {
        // Only regenerate some digits randomly
        if (Math.random() > 0.7) {
          span.textContent = Math.random() > 0.5 ? '1' : '0';
        }
      });
    });
  }, 500);
}

// Default export for backward compatibility
export default {
  initializeFileHandler,
  handleFileSelect,
  clearFile,
  getSelectedFile,
  getMaxFileSize,
  getMaxFileSizeForExpiry,
  validateFileForExpiry,
  EXPIRY_SIZE_LIMITS
};
