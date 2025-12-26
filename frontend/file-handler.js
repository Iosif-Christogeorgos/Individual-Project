// =============================================================================
// CrypShare - File Handler Module
// =============================================================================
// Handles file selection, validation, and drag & drop functionality.
// =============================================================================

import { showAlert, hideAlert, formatFileSize } from './ui-utils.js';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

/**
 * Initialize file input and drag & drop handlers.
 * @param {Function} onFileSelected - Callback when a valid file is selected
 */
export function initializeFileHandler(onFileSelected) {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  if (!dropZone || !fileInput) return;

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

  if (file.size > MAX_FILE_SIZE) {
    showAlert(
      "File Too Large",
      `Maximum file size is 1GB. Your file is ${formatFileSize(file.size)}.`,
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
 * Get the maximum allowed file size.
 * @returns {number} Max file size in bytes
 */
export function getMaxFileSize() {
  return MAX_FILE_SIZE;
}

// Default export for backward compatibility
export default {
  initializeFileHandler,
  handleFileSelect,
  clearFile,
  getSelectedFile,
  getMaxFileSize
};
