// =============================================================================
// CrypShare - Quick Share Module (ES Module)
// =============================================================================
// Simplified upload for link-based sharing only.
// No identity, no recipients, no signing - just fast file encryption.
// =============================================================================

import * as CryptoModule from "./crypto.js";
import {
  showAlert,
  hideAlert,
  showToast,
  updateProgress,
  hideProgress,
  formatFileSize,
} from "./ui-utils.js";
import {
  getSelectedExpiryHours,
  startCountdownTimer,
  initializeExpiryDropdown,
} from "./expiry.js";
import {
  initializeFileHandler,
  clearFile,
  getSelectedFile,
  validateFileForExpiry,
  getMaxFileSizeForExpiry,
} from "./file-handler.js";

// State
let hasActiveLink = false;
let isUploading = false;
let uploadAbortController = null;

// =============================================================================
// UI Helper Functions
// =============================================================================

function validateFileForCurrentExpiry() {
  const expiryHours = getSelectedExpiryHours();
  const file = getSelectedFile();
  if (!file) return;

  const validation = validateFileForExpiry(file, expiryHours);
  if (!validation.valid) {
    showAlert("File Exceeds Size Limit", validation.message, "warning");
  } else {
    hideAlert();
  }
}

function showShareLink(link) {
  const container = document.querySelector(".container[data-state]");
  const input = document.getElementById("shareLink");

  input.value = link;
  container.setAttribute("data-state", "success");
  hasActiveLink = true;
}

function copyLink() {
  const input = document.getElementById("shareLink");
  const btn = document.getElementById("copyBtn");

  navigator.clipboard
    .writeText(input.value)
    .then(() => {
      btn.classList.add("copied");
      btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span> Copied!';

      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></span> Copy';
      }, 2000);
    })
    .catch(() => {
      input.select();
      input.setSelectionRange(0, 99999);
      btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span> Select & Copy';

      setTimeout(() => {
        btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></span> Copy';
      }, 3000);
    });
}

function resetToUpload() {
  const container = document.querySelector(".container[data-state]");
  container.setAttribute("data-state", "upload");
  clearFile();
  hasActiveLink = false;

  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) {
    copyBtn.classList.remove("copied");
    copyBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></span> Copy';
  }
}

// =============================================================================
// Initialization
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  // Reveal the page (remove critical.css cloak)
  document.documentElement.classList.add("auth-resolved");

  // Initialize expiry dropdown
  initializeExpiryDropdown();

  // Initialize file handler
  initializeFileHandler((file) => {
    const expiryHours = getSelectedExpiryHours();
    const validation = validateFileForExpiry(file, expiryHours);
    if (!validation.valid) {
      showAlert("File Exceeds Size Limit", validation.message, "error");
    }
  });

  // Expiry change listener
  const expirySelect = document.getElementById("expirySelect");
  if (expirySelect) {
    expirySelect.addEventListener("change", validateFileForCurrentExpiry);
  }

  // Alert close
  document.getElementById("alertCloseBtn")?.addEventListener("click", hideAlert);

  // File clear button
  document.getElementById("clearFileBtn")?.addEventListener("click", () => {
    if (isUploading) {
      cancelUpload();
    } else {
      clearFile();
    }
  });

  // Main upload button
  document.getElementById("uploadBtn")?.addEventListener("click", processFile);

  // Success view buttons
  document.getElementById("copyBtn")?.addEventListener("click", copyLink);
  document.getElementById("backBtn")?.addEventListener("click", resetToUpload);

  // Cancel button in overlay
  document.getElementById("megaCancelBtn")?.addEventListener("click", () => {
    if (window.cancelUpload) {
      window.cancelUpload();
    }
  });
});

// Global cancel function for overlay
window.cancelUpload = function () {
  if (uploadAbortController) {
    uploadAbortController.abort();
    uploadAbortController = null;
  }

  isUploading = false;

  const uploadBtn = document.getElementById("uploadBtn");
  if (uploadBtn) {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> Encrypt & Upload';
  }

  hideProgress();
  if (window.encryptionAnimator) {
    window.encryptionAnimator.reset();
  }

  clearFile();
  showToast("Upload cancelled ✓");
};

// =============================================================================
// Main Upload Process
// =============================================================================

const STREAMING_THRESHOLD = 100 * 1024 * 1024;

async function processFile() {
  const uploadBtn = document.getElementById("uploadBtn");
  const file = getSelectedFile();

  hideAlert();

  if (!file) {
    showAlert("No File Selected", "Please select a file to encrypt.", "warning");
    return;
  }

  // Validate file size
  const expiryHours = getSelectedExpiryHours();
  const sizeValidation = validateFileForExpiry(file, expiryHours);
  if (!sizeValidation.valid) {
    showAlert("File Too Large", sizeValidation.message, "error");
    return;
  }

  await executeUpload();
}

function cancelUpload() {
  if (!isUploading) return;

  if (uploadAbortController) {
    uploadAbortController.abort();
    uploadAbortController = null;
  }

  isUploading = false;

  const uploadBtn = document.getElementById("uploadBtn");
  if (uploadBtn) {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> Encrypt & Upload';
  }

  hideProgress();
  if (window.encryptionAnimator) {
    window.encryptionAnimator.reset();
  }

  clearFile();
  showToast("Upload cancelled ✓");
}

async function executeUpload() {
  const uploadBtn = document.getElementById("uploadBtn");
  const file = getSelectedFile();
  const expiryHours = getSelectedExpiryHours();

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<span><svg class="lucide-icon animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> Processing...';
  isUploading = true;

  uploadAbortController = new AbortController();

  // Start animation
  if (window.encryptionAnimator && file) {
    window.encryptionAnimator.startEncryptionSequence(file.name);
  }

  try {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Web Crypto API not available. Please use HTTPS.");
    }

    const isSecureContext = window.location.protocol === "https:";
    const useStreaming =
      isSecureContext &&
      file.size > STREAMING_THRESHOLD &&
      CryptoModule.supportsStreamingUpload();

    if (useStreaming) {
      try {
        await executeStreamingUpload(file, expiryHours);
      } catch (streamError) {
        if (streamError.name === "AbortError") throw streamError;
        console.warn("Streaming failed, falling back:", streamError.message);
        await executeBufferedUpload(file, expiryHours);
      }
    } else {
      await executeBufferedUpload(file, expiryHours);
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    hideProgress();
    showAlert("Encryption Failed", error.message || "An error occurred.", "error");
  } finally {
    isUploading = false;
    uploadAbortController = null;
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> Encrypt & Upload';
  }
}

async function executeStreamingUpload(file, expiryHours) {
  updateProgress(5, "Generating encryption key...");
  const aesKey = await CryptoModule.generateAESKey();
  const exportedKey = await CryptoModule.exportAESKey(aesKey);

  updateProgress(10, "Preparing stream...");
  const { stream: encryptedStream } = await CryptoModule.createEncryptedStream(
    file,
    aesKey,
    (percent) => {
      // Pass raw percent (0-100) so animation syncs with actual encryption
      updateProgress(percent, `Encrypting... ${percent}%`);
    }
  );

  updateProgress(80, "Uploading to server...");

  const uploadResponse = await fetch("/upload-stream", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: encryptedStream,
    signal: uploadAbortController.signal,
    duplex: "half",
  });

  if (!uploadResponse.ok) {
    const errorData = await uploadResponse.json();
    throw new Error(errorData.error || "Upload failed");
  }

  const serverData = await uploadResponse.json();
  if (!serverData.fileId) throw new Error("Server did not return file ID");

  await uploadMetadata(serverData.fileId, file, expiryHours);

  updateProgress(100, "Complete!");
  const shareLink = `${window.location.origin}/download?id=${encodeURIComponent(
    serverData.fileId
  )}#${exportedKey.k}`;

  showUploadSuccess(shareLink, Date.now() + expiryHours * 60 * 60 * 1000);
}

async function executeBufferedUpload(file, expiryHours) {
  updateProgress(5, "Generating encryption key...");
  const aesKey = await CryptoModule.generateAESKey();
  const exportedKey = await CryptoModule.exportAESKey(aesKey);

  updateProgress(10, "Encrypting file...");
  const encryptedData = await CryptoModule.encryptFileChunked(
    file,
    aesKey,
    (percent) => {
      // Pass raw percent (0-100) so animation syncs with actual encryption
      updateProgress(percent, `Encrypting... ${percent}%`);
    }
  );

  updateProgress(75, "Uploading...");

  const formData = new FormData();
  formData.append(
    "encryptedFile",
    new Blob([encryptedData]),
    `${file.name}.enc`
  );

  const uploadResponse = await fetch("/upload", {
    method: "POST",
    body: formData,
    signal: uploadAbortController.signal,
  });

  if (!uploadResponse.ok) {
    const errorData = await uploadResponse.json();
    throw new Error(errorData.error || "Upload failed");
  }

  const serverData = await uploadResponse.json();
  if (!serverData.fileId) throw new Error("Server did not return file ID");

  await uploadMetadata(serverData.fileId, file, expiryHours);

  updateProgress(100, "Complete!");
  const shareLink = `${window.location.origin}/download?id=${encodeURIComponent(
    serverData.fileId
  )}#${exportedKey.k}`;

  showUploadSuccess(shareLink, Date.now() + expiryHours * 60 * 60 * 1000);
}

async function uploadMetadata(fileId, file, expiryHours) {
  const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;

  const metadata = {
    version: 2,
    // NOTE: filename intentionally omitted - it's encrypted in the file blob header
    // Storing it here would break zero-knowledge architecture
    size: file.size,
    contentHash: null,
    timestamp: new Date().toISOString(),
    expiresAt: expiresAt,
    expiryHours: expiryHours,
    accessModes: ["link"],
    encryptedKeys: [],
    signature: null,
  };

  if (expiryHours !== 24) {
    updateProgress(95, "Saving metadata...");
    await fetch(`/metadata/${fileId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });
  }
}

function showUploadSuccess(shareLink, expiresAt) {
  setTimeout(() => {
    hideProgress();
    showShareLink(shareLink);

    if (expiresAt) {
      startCountdownTimer(expiresAt);
    }

    if (window.encryptionAnimator) {
      window.encryptionAnimator.showSuccess();
    }
  }, 2000);
}
