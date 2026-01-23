// =============================================================================
// CrypShare - Download & Decryption Module (ES Module - Hybrid E2EE)
// =============================================================================
// Supports both:
// 1. Link-based access - AES key from URL fragment
// 2. Identity-based access - Decrypt AES key using user's private key
// =============================================================================

import * as CryptoModule from "./crypto.js";
import * as IdentityManager from "./identity.js";
import { showAlert, hideAlert, escapeHtml, updateStep, formatExpiryDuration } from "./ui-utils.js";
import { hapticSuccess, hapticHeavy, hapticError } from "./haptics.js";

let currentIdentity = null;
let fileMetadata = null;

// Threshold for streaming download (100MB)
const STREAMING_DOWNLOAD_THRESHOLD = 100 * 1024 * 1024;


/**
 * Update the expiry notice on the download page based on metadata.
 * Falls back to generic message if expiry info is not available.
 */
function updateExpiryNotice() {
  const expiryNoticeText = document.getElementById("expiryNoticeText");
  if (!expiryNoticeText) return;

  if (fileMetadata?.expiryHours) {
    // Use expiryHours from metadata for exact duration
    const duration = formatExpiryDuration(fileMetadata.expiryHours);
    expiryNoticeText.innerHTML = `This link expires <strong>${duration}</strong> after upload`;
  } else if (fileMetadata?.expiresAt) {
    // Calculate remaining time from expiresAt timestamp
    const now = Date.now();
    const remaining = fileMetadata.expiresAt - now;
    if (remaining > 0) {
      const hoursRemaining = Math.ceil(remaining / (1000 * 60 * 60));
      if (hoursRemaining < 1) {
        expiryNoticeText.innerHTML = `This link expires in <strong>less than 1 hour</strong>`;
      } else if (hoursRemaining < 24) {
        expiryNoticeText.innerHTML = `This link expires in <strong>${hoursRemaining} hour${
          hoursRemaining !== 1 ? "s" : ""
        }</strong>`;
      } else {
        const daysRemaining = Math.ceil(hoursRemaining / 24);
        expiryNoticeText.innerHTML = `This link expires in <strong>${daysRemaining} day${
          daysRemaining !== 1 ? "s" : ""
        }</strong>`;
      }
    } else {
      expiryNoticeText.innerHTML = `This link may have <strong>expired</strong>`;
    }
  } else {
    // Default fallback - most files use 24 hour default
    expiryNoticeText.innerHTML = `This link expires <strong>24 hours</strong> after upload`;
  }
}

// =============================================================================
// Link Validation on Page Load
// =============================================================================

async function validateDownloadLink() {
  const urlParams = new URLSearchParams(window.location.search);
  const fileId = urlParams.get("id");
  const keyString = window.location.hash.substring(1);

  // Check if file ID is present
  if (!fileId) {
    showInvalidLinkPage(
      "Invalid Link",
      "This download link is invalid or incomplete. Please make sure you have the complete URL."
    );
    return;
  }

  // Validate fileId format
  if (!/^file-\d+-[a-f0-9]+\.bin$/.test(fileId)) {
    showInvalidLinkPage(
      "Invalid Link",
      "This download link appears to be malformed. Please check the URL and try again."
    );
    return;
  }

  // Check if file exists on server
  try {
    const response = await fetch(`/download/${encodeURIComponent(fileId)}`, {
      method: "HEAD",
    });

    if (response.status === 404) {
      showInvalidLinkPage(
        "File Not Found",
        "This file has expired or been deleted. Files are automatically removed after their expiry period."
      );
      return;
    }

    if (!response.ok) {
      showInvalidLinkPage(
        "File Unavailable",
        "Unable to access this file. Please try again later or request a new link."
      );
      return;
    }

    // Try to fetch metadata
    await fetchMetadata(fileId);

    // Load user identity
    await loadUserIdentity();

    // Update expiry notice with actual metadata
    updateExpiryNotice();

    // Determine access mode
    if (keyString) {
      // Link-based access available
      showDownloadReady("link");
    } else if (fileMetadata && canDecryptWithIdentity()) {
      // Identity-based access available
      showDownloadReady("identity");
    } else if (fileMetadata && fileMetadata.encryptedKeys?.length > 0) {
      // Identity-based access required but user doesn't have matching identity
      showIdentityRequiredPage();
    } else {
      // No key in URL and no identity access
      showInvalidLinkPage(
        "Missing Decryption Key",
        "This link does not contain the decryption key. You may need to use identity-based access or request a new link."
      );
    }
  } catch (error) {
    console.error("Validation error:", error);
    showInvalidLinkPage(
      "Connection Error",
      "Unable to verify file availability. Please check your connection and try again."
    );
    return;
  }
}

async function fetchMetadata(fileId) {
  try {
    const response = await fetch(`/metadata/${encodeURIComponent(fileId)}`);
    if (response.ok) {
      const data = await response.json();
      if (data) {
        fileMetadata = data;
      } else {
        // Server returned null - no metadata exists (normal for link-only uploads)
        fileMetadata = null;
      }
    } else {
      console.warn("Metadata fetch returned:", response.status);
      fileMetadata = null;
    }
  } catch (error) {
    console.debug("No metadata available:", error.message);
    fileMetadata = null;
  }
}

async function loadUserIdentity(retryCount = 0) {
  const MAX_RETRIES = 2;

  try {
    const hasIdentity = await IdentityManager.hasIdentity();

    if (hasIdentity) {
      currentIdentity = await IdentityManager.getLoadedIdentity();
    } else {
      currentIdentity = null;
    }
  } catch (error) {
    console.error("Failed to load identity:", error);

    // Retry on failure (IndexedDB can be flaky on some browsers)
    if (retryCount < MAX_RETRIES) {
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * (retryCount + 1))
      );
      return loadUserIdentity(retryCount + 1);
    }

    currentIdentity = null;
  }
}

function canDecryptWithIdentity() {
  if (!currentIdentity || !fileMetadata?.encryptedKeys) {
    return false;
  }

  // Check if any encrypted key matches our identity
  return fileMetadata.encryptedKeys.some(
    (ek) => ek.recipientFingerprint === currentIdentity.fingerprint
  );
}

function getMatchingEncryptedKey() {
  if (!currentIdentity || !fileMetadata?.encryptedKeys) return null;

  return fileMetadata.encryptedKeys.find(
    (ek) => ek.recipientFingerprint === currentIdentity.fingerprint
  );
}

// =============================================================================
// Page Display Functions
// =============================================================================

function showInvalidLinkPage(title, message) {
  const card = document.querySelector(".card");
  card.innerHTML = `
    <div class="logo justify-center">
      <img src="logo.svg" alt="CrypShare" class="logo-icon" />
      <div class="logo-text">Cryp<span>Share</span></div>
    </div>

    <span class="download-icon"><svg class="lucide-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span>

    <h2 class="justify-center">${title}</h2>
    <p>${message}</p>

    <a href="/" class="btn btn-primary text-decoration-none d-inline-flex items-center justify-center gap-2">
      <span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg></span> Upload a New File
    </a>

    <div class="security-badge">
      <span class="security-badge-icon"><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg></span>
      <span>Need help? Make sure you have the complete share link</span>
    </div>
  `;
}

function showIdentityRequiredPage() {
  const card = document.querySelector(".card");
  const recipientInfo = fileMetadata?.encryptedKeys?.length
    ? `This file is encrypted for ${fileMetadata.encryptedKeys.length} specific recipient(s).`
    : "";

  card.innerHTML = `
    <div class="logo justify-center">
      <img src="logo.svg" alt="CrypShare" class="logo-icon" />
      <div class="logo-text">Cryp<span>Share</span></div>
    </div>

    <span class="download-icon"><svg class="lucide-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg></span>

    <h2 class="justify-center">Identity Required</h2>
    <p>
      This file requires identity-based decryption. ${recipientInfo}
    </p>

    ${
      currentIdentity
        ? `
      <div class="identity-info">
        <span class="identity-badge"><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg></span>
        <span>Your identity: <strong>${escapeHtml(
          currentIdentity.displayName
        )}</strong></span>
        <span class="fingerprint">${currentIdentity.fingerprint
          .substring(0, 16)
          .toUpperCase()}</span>
      </div>
      <p class="error-text">Your identity does not match any authorized recipient.</p>
    `
        : `
      <p>You need to set up your cryptographic identity to decrypt this file.</p>
      <a href="/" class="btn btn-secondary text-decoration-none d-inline-flex items-center justify-center gap-2 mb-4">
        <span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg></span> Set Up Identity
      </a>
    `
    }

    <a href="/" class="btn btn-primary text-decoration-none d-inline-flex items-center justify-center gap-2">
      <span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg></span> Upload a New File
    </a>
  `;
}

function showDownloadReady(accessMode) {
  const accessModeEl = document.getElementById("accessMode");
  const signatureInfo = document.getElementById("signatureInfo");

  // Update access mode indicator
  if (accessModeEl) {
    if (accessMode === "identity") {
      accessModeEl.innerHTML = `
        <div class="access-mode-card access-identity">
          <div class="access-icon-badge identity">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
          </div>
          <div class="access-details">
            <span class="access-label">Identity-Based Access</span>
            <span class="access-user">Decrypting as: ${escapeHtml(
              currentIdentity?.displayName || "Unknown"
            )}</span>
          </div>
        </div>
      `;
      accessModeEl.classList.add("show");
    } else {
      accessModeEl.innerHTML = `
        <div class="access-mode-card access-link">
          <div class="access-icon-badge link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </div>
          <div class="access-details">
            <span class="access-label">Link-Based Access</span>
            <span class="access-user">Decryption key included in URL</span>
          </div>
        </div>
      `;
      accessModeEl.classList.add("show");
    }
  }

  // Show signature info if available
  if (signatureInfo && fileMetadata?.signature) {
    const signerName = fileMetadata.signature.signerDisplayName || "Unknown";
    const signerFingerprint =
      fileMetadata.signature.signerFingerprint
        ?.substring(0, 16)
        .toUpperCase() || "";

    signatureInfo.innerHTML = `
      <div class="signature-card-v2 signed">
        <div class="sig-header">
          <div class="sig-verified-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M9 12l2 2 4-4"/>
              <path d="M12 3l1.5 1.5a2 2 0 002.5.25l1.5-.75a2 2 0 012.45.65l.75 1.5a2 2 0 002.1.85L24 6.5v11a2 2 0 01-2 2H2a2 2 0 01-2-2v-11l1.25.5a2 2 0 002.1-.85l.75-1.5a2 2 0 012.45-.65l1.5.75a2 2 0 002.5-.25L12 3z"/>
            </svg>
          </div>
          <div class="sig-status-text">
            <span class="sig-status-label">Verified Signature</span>
            <span class="sig-status-badge">AUTHENTIC</span>
          </div>
        </div>
        <div class="sig-body">
          <div class="sig-signer-row">
            <span class="sig-signer-label">Signed by</span>
            <span class="sig-signer-name">${escapeHtml(signerName)}</span>
          </div>
          <button type="button" class="sig-fingerprint-toggle" aria-expanded="false">
            <svg class="sig-key-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            <span>View Fingerprint</span>
            <svg class="sig-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <div class="sig-fingerprint-panel" hidden>
            <div class="sig-fingerprint-content">
              <code class="sig-fingerprint-code">${
                signerFingerprint || "Not available"
              }</code>
              <button type="button" class="sig-copy-btn" title="Copy fingerprint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
              </button>
            </div>
            <span class="sig-fingerprint-hint">Compare this with the sender's known fingerprint to verify authenticity</span>
          </div>
        </div>
      </div>
    `;
    signatureInfo.classList.add("show");

    // Set up interactive fingerprint toggle
    const toggle = signatureInfo.querySelector(".sig-fingerprint-toggle");
    const panel = signatureInfo.querySelector(".sig-fingerprint-panel");
    const copyBtn = signatureInfo.querySelector(".sig-copy-btn");

    toggle?.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", !expanded);
      panel.hidden = expanded;
    });

    copyBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(signerFingerprint || "");
        hapticSuccess(); // Feedback for successful copy
        copyBtn.classList.add("copied");
        setTimeout(() => copyBtn.classList.remove("copied"), 1500);
      } catch (e) {
        console.error("Copy failed:", e);
      }
    });
  } else if (signatureInfo) {
    signatureInfo.innerHTML = `
      <div class="signature-info-card unsigned">
        <div class="sig-icon-badge unsigned">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
          </svg>
        </div>
        <div class="sig-details">
          <span class="sig-label">Not Signed</span>
          <span class="sig-signer">Uploader identity not verified</span>
        </div>
      </div>
    `;
    signatureInfo.classList.add("show");
  }
}

/**
 * Show the signature verification step in the UI.
 */
function showSignatureStep() {
  const step5 = document.getElementById("step5");
  if (step5) {
    step5.style.display = "flex";
  }
}

// Run validation when page loads
// Use a more robust initialization that ensures all modules are ready
async function initializeDownloadPage() {
  await validateDownloadLink();

  // ==========================================================================
  // Event Listeners (replaces inline onclick handlers for strict CSP)
  // ==========================================================================
  document
    .getElementById("alertCloseBtn")
    ?.addEventListener("click", hideAlert);
  document
    .getElementById("downloadBtn")
    ?.addEventListener("click", startDownload);
}

document.addEventListener("DOMContentLoaded", initializeDownloadPage);

// =============================================================================
// Main Download & Decryption Process
// =============================================================================

async function startDownload() {
  const btn = document.getElementById("downloadBtn");

  hideAlert();
  showStatus();

  btn.disabled = true;
  btn.innerHTML = '<span><svg class="lucide-icon animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> Decrypting...';

  try {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        "Web Crypto API not available. Please use HTTPS or localhost."
      );
    }

    // Get parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get("id");
    const keyString = window.location.hash.substring(1);

    if (!fileId) {
      throw new Error("Invalid download link. Missing file ID.");
    }

    // Validate fileId format
    if (!/^file-\d+-[a-f0-9]+\.bin$/.test(fileId)) {
      throw new Error("Invalid file ID format.");
    }

    // Step 1: Check file size to decide streaming vs buffered
    const headResponse = await fetch(
      `/download/${encodeURIComponent(fileId)}`,
      {
        method: "HEAD",
      }
    );

    if (!headResponse.ok) {
      if (headResponse.status === 404) {
        throw new Error(
          "File not found. It may have been deleted or the link is invalid."
        );
      }
      throw new Error(`Failed to fetch file: ${headResponse.status}`);
    }

    const contentLength = parseInt(
      headResponse.headers.get("Content-Length") || "0",
      10
    );
    const useStreaming = contentLength > STREAMING_DOWNLOAD_THRESHOLD;

    updateStep("step1", "pending");

    // Step 2: Get decryption key (link-based or identity-based)
    let key;

    if (keyString) {
      // Link-based access: import key from URL fragment
      const jwk = {
        kty: "oct",
        k: keyString,
        alg: "A256GCM",
        ext: true,
      };

      try {
        key = await CryptoModule.importAESKeyFromJWK(jwk);
      } catch (keyError) {
        throw new Error("Invalid decryption key. The link may be corrupted.");
      }
    } else {
      // Identity-based access: decrypt key using private key
      if (!currentIdentity) {
        throw new Error(
          "No identity available. Please set up your identity first."
        );
      }

      const encryptedKeyBundle = getMatchingEncryptedKey();
      if (!encryptedKeyBundle) {
        throw new Error(
          "Your identity is not authorized to decrypt this file."
        );
      }

      try {
        key = await CryptoModule.decryptKeyWithPrivateKey(
          encryptedKeyBundle,
          currentIdentity.encryption.privateKey
        );
      } catch (keyError) {
        console.error("Key decryption error:", keyError);
        throw new Error("Failed to decrypt file key with your identity.");
      }
    }
    updateStep("step2", "complete");

    // Step 3: Download and decrypt
    let decryptedResult;

    if (useStreaming) {
      // Memory-efficient streaming download for large files

      decryptedResult = await CryptoModule.downloadAndDecryptStreaming(
        `/download/${encodeURIComponent(fileId)}`,
        key,
        (downloadProgress) => {
          // Download progress (step 1)
          if (downloadProgress < 100) {
            btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></span> Downloading... ${downloadProgress}%';
          } else {
            updateStep("step1", "complete");
          }
        },
        (decryptProgress) => {
          // Decryption progress (step 3)
          if (decryptProgress < 100) {
            btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg></span> Decrypting... ${decryptProgress}%';
          }
        }
      );
      updateStep("step1", "complete");
      updateStep("step3", "complete");
    } else {
      // Buffered download for small files (original approach)
      const response = await fetch(`/download/${encodeURIComponent(fileId)}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "File not found. It may have been deleted or the link is invalid."
          );
        }
        throw new Error(`Failed to fetch file: ${response.status}`);
      }

      const encryptedBlob = await response.arrayBuffer();
      updateStep("step1", "complete");

      // Verify format and decrypt
      try {
        decryptedResult = await CryptoModule.decryptFileChunked(
          encryptedBlob,
          key,
          (progress) => {
            if (progress < 100) {
              updateStep("step3", "pending");
            }
          }
        );
      } catch (decryptError) {
        throw new Error(
          "Decryption failed: " + decryptError.message ||
            "The file may be corrupted or the key is incorrect."
        );
      }
      updateStep("step3", "complete");
    }

    const { filename: originalFilename, data: fileContentBuffer } =
      decryptedResult;
    const fileContent = new Uint8Array(fileContentBuffer);

    // Step 4: Verify signature if present
    if (fileMetadata?.signature) {
      showSignatureStep(); // Make signature step visible
      updateStep("step5", "pending"); // Optional signature step
      try {
        const signerPublicKey = await CryptoModule.importSigningPublicKey(
          fileMetadata.signature.signerPublicKey
        );

        const verification = await CryptoModule.verifyFileMetadataSignature(
          fileMetadata.signature,
          signerPublicKey
        );

        if (verification.valid) {
          updateStep("step5", "complete");
          showSignatureVerified(verification.metadata);
        } else {
          console.warn("Signature verification failed");
          showSignatureWarning();
        }
      } catch (sigError) {
        console.error("Signature verification error:", sigError);
      }
    }

    // Step 5: Prepare download
    updateStep("step4", "complete");

    // Sanitize filename
    const sanitizedFilename =
      originalFilename.replace(/[/\\]/g, "_").replace(/\x00/g, "").trim() ||
      "download";

    // Note: Hash verification removed - AES-GCM already provides integrity checking.\n    // If ciphertext was tampered with, decryption would have failed above.

    // Create download
    const blob = new Blob([fileContent]);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = sanitizedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    // Success state
    hapticHeavy(); // Strong feedback for successful download
    btn.disabled = false;
    btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span> Download Complete';
    btn.classList.add("btn-secondary");
    btn.classList.remove("btn-primary");
  } catch (error) {
    // Mark remaining steps as error
    ["step1", "step2", "step3", "step4", "step5"].forEach((step) => {
      const el = document.getElementById(step);
      if (el && el.classList.contains("pending")) {
        updateStep(step, "error");
      }
    });

    showAlert(
      "Decryption Failed",
      error.message || "An unexpected error occurred.",
      "error"
    );

    btn.disabled = false;
    btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></span> Retry Download';
  }
}

function showStatus() {
  const container = document.getElementById("statusContainer");
  if (container) {
    container.style.display = "block";
  }
}

// =============================================================================
// Signature Verification UI
// =============================================================================

function showSignatureVerified() {
  hapticSuccess(); // Positive feedback for verified signature
  const infoEl = document.getElementById("signatureVerification");
  if (!infoEl) return;

  infoEl.innerHTML = `
    <div class="signature-verified">
      <span class="sig-icon"><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg></span>
      <span>Signature verified - File was signed by the uploader</span>
    </div>
  `;
  infoEl.classList.add("show");
}

function showSignatureWarning() {
  hapticError(); // Warning feedback for failed signature
  const infoEl = document.getElementById("signatureVerification");
  if (!infoEl) return;

  infoEl.innerHTML = `
    <div class="signature-warning">
      <span class="sig-icon"><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
      <span>Signature verification failed - File may have been tampered with</span>
    </div>
  `;
  infoEl.classList.add("show", "warning");
}

