// =============================================================================
// CrypShare - Download & Decryption Module (Hybrid E2EE)
// =============================================================================
// Supports both:
// 1. Link-based access - AES key from URL fragment
// 2. Identity-based access - Decrypt AES key using user's private key
// =============================================================================

let currentIdentity = null;
let fileMetadata = null;

// Threshold for streaming download (100MB)
const STREAMING_DOWNLOAD_THRESHOLD = 100 * 1024 * 1024;

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
        "This file has expired or been deleted. Files are automatically removed after 24 hours."
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
    showDownloadReady("link"); // Try anyway
  }
}

async function fetchMetadata(fileId) {
  try {
    const response = await fetch(`/metadata/${encodeURIComponent(fileId)}`);
    if (response.ok) {
      const data = await response.json();
      if (data) {
        fileMetadata = data;
// [Deleted console.log]
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
    if (typeof IdentityManager === "undefined") {
      currentIdentity = null;
      return;
    }

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
    <div class="logo" style="justify-content: center">
      <img src="logo.svg" alt="CrypShare" class="logo-icon" />
      <div class="logo-text">Cryp<span>Share</span></div>
    </div>

    <span class="download-icon">❌</span>

    <h2 style="justify-content: center">${title}</h2>
    <p>${message}</p>

    <a href="/" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;">
      <span>📤</span> Upload a New File
    </a>

    <div class="security-badge">
      <span class="security-badge-icon">💡</span>
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
    <div class="logo" style="justify-content: center">
      <img src="logo.svg" alt="CrypShare" class="logo-icon" />
      <div class="logo-text">Cryp<span>Share</span></div>
    </div>

    <span class="download-icon">🔑</span>

    <h2 style="justify-content: center">Identity Required</h2>
    <p>
      This file requires identity-based decryption. ${recipientInfo}
    </p>

    ${
      currentIdentity
        ? `
      <div class="identity-info">
        <span class="identity-badge">🆔</span>
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
      <a href="/" class="btn btn-secondary" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; margin-bottom: 1rem;">
        <span>🆔</span> Set Up Identity
      </a>
    `
    }

    <a href="/" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;">
      <span>📤</span> Upload a New File
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
    const signerName =
      fileMetadata.signature.signerId?.substring(0, 8) || "Unknown";
    const signerFingerprint =
      fileMetadata.signature.signerFingerprint
        ?.substring(0, 16)
        .toUpperCase() || "";

    signatureInfo.innerHTML = `
      <div class="signature-info-card signed">
        <div class="sig-icon-badge signed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <div class="sig-details">
          <span class="sig-label">Digitally Signed</span>
          <span class="sig-signer">By: ${escapeHtml(signerName)} ${
      signerFingerprint ? `(${signerFingerprint})` : ""
    }</span>
        </div>
      </div>
    `;
    signatureInfo.classList.add("show");
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

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
  // Wait for all required modules to be available
  const checkModules = () => {
    return (
      typeof CryptoModule !== "undefined" &&
      typeof IdentityManager !== "undefined"
    );
  };

  // If modules aren't ready, wait a bit
  if (!checkModules()) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (!checkModules()) {
      console.error("Required modules not available");
    }
  }

  await validateDownloadLink();
}

document.addEventListener("DOMContentLoaded", initializeDownloadPage);

// =============================================================================
// UI Helper Functions
// =============================================================================

function showAlert(title, message, type = "error") {
  const alert = document.getElementById("alert");
  const alertTitle = document.getElementById("alert-title");
  const alertMessage = document.getElementById("alert-message");
  const alertIcon = document.getElementById("alert-icon");

  // Set icon based on type
  const icons = { error: "⚠️", success: "✅", info: "ℹ️", warning: "⚡" };
  if (alertIcon) {
    alertIcon.textContent = icons[type] || icons.error;
  }

  // Update alert styling based on type
  alert.classList.remove(
    "alert-error",
    "alert-success",
    "alert-info",
    "alert-warning"
  );
  alert.classList.add(`alert-${type}`);

  alertTitle.textContent = title;
  alertMessage.textContent = message;
  alert.classList.add("show");
}

function hideAlert() {
  document.getElementById("alert").classList.remove("show");
}

function updateStep(stepId, status) {
  const step = document.getElementById(stepId);
  if (!step) return;

  const icon = step.querySelector(".status-icon");

  step.classList.remove("pending", "complete", "error");
  step.classList.add(status);

  if (status === "complete") {
    icon.textContent = "✓";
  } else if (status === "error") {
    icon.textContent = "✗";
  } else {
    icon.textContent = "○";
  }
}

function showStatus() {
  const container = document.getElementById("statusContainer");
  if (container) {
    container.style.display = "block";
  }
}

// =============================================================================
// Main Download & Decryption Process
// =============================================================================

async function startDownload() {
  const btn = document.getElementById("downloadBtn");

  hideAlert();
  showStatus();

  btn.disabled = true;
  btn.innerHTML = "<span>⏳</span> Decrypting...";

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
            btn.innerHTML = `<span>⬇️</span> Downloading... ${downloadProgress}%`;
          } else {
            updateStep("step1", "complete");
          }
        },
        (decryptProgress) => {
          // Decryption progress (step 3)
          if (decryptProgress < 100) {
            btn.innerHTML = `<span>🔓</span> Decrypting... ${decryptProgress}%`;
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
      // The previous code used decryptFileAuto.
      // We will replace it with decryptFileChunked.

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
          "Decryption failed: " + decryptError.message || "The file may be corrupted or the key is incorrect."
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

    // Verify content hash if metadata available (hash of original file before encryption)
    if (fileMetadata?.contentHash) {
      try {
        // Use streaming hash for large files (matches upload algorithm)
        let decryptedHash;
        if (fileContent.length > 100 * 1024 * 1024) {
          // Large file: use streaming hash (Merkle-tree style)
          decryptedHash = await CryptoModule.hashDataStreaming(fileContent);
        } else {
          // Small file: use standard hash
          decryptedHash = await CryptoModule.sha256(fileContent.buffer);
        }

        if (decryptedHash !== fileMetadata.contentHash) {
          console.warn("Content hash mismatch:", {
            expected: fileMetadata.contentHash,
            actual: decryptedHash,
          });
          showAlert(
            "Warning",
            "File integrity check failed. The file may have been tampered with.",
            "warning"
          );
        } else {
// Integrity verified
        }
      } catch (hashError) {
        console.error("Hash verification error:", hashError);
      }
    }

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
    btn.disabled = false;
    btn.innerHTML = "<span>✓</span> Download Complete";
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
    btn.innerHTML = "<span>⬇️</span> Retry Download";
  }
}

// =============================================================================
// Signature Verification UI
// =============================================================================

function showSignatureVerified() {
  const infoEl = document.getElementById("signatureVerification");
  if (!infoEl) return;

  infoEl.innerHTML = `
    <div class="signature-verified">
      <span class="sig-icon">✅</span>
      <span>Signature verified - File was signed by the uploader</span>
    </div>
  `;
  infoEl.classList.add("show");
}

function showSignatureWarning() {
  const infoEl = document.getElementById("signatureVerification");
  if (!infoEl) return;

  infoEl.innerHTML = `
    <div class="signature-warning">
      <span class="sig-icon">⚠️</span>
      <span>Signature verification failed - File may have been tampered with</span>
    </div>
  `;
  infoEl.classList.add("show", "warning");
}
