// =============================================================================
// CrypShare - Download & Decryption Module
// =============================================================================

// =============================================================================
// Link Validation on Page Load
// =============================================================================

/**
 * Validates the download link on page load.
 * Shows an error page if the link is invalid or the file doesn't exist.
 */
async function validateDownloadLink() {
  const urlParams = new URLSearchParams(window.location.search);
  const fileId = urlParams.get("id");
  const keyString = window.location.hash.substring(1);

  // Check if required parameters are present
  if (!fileId || !keyString) {
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

  // Verify file exists on server (HEAD request to avoid downloading the file)
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

    // Link is valid - show the download UI
    showDownloadReady();
  } catch (error) {
    // Network error - show the download UI anyway (let them try)
    // The actual download will show a more specific error if it fails
    showDownloadReady();
  }
}

/**
 * Shows the invalid link error page.
 */
function showInvalidLinkPage(title, message) {
  const card = document.querySelector(".card");
  card.innerHTML = `
    <!-- Logo Header -->
    <div class="logo" style="justify-content: center">
      <div class="logo-icon">🔐</div>
      <div class="logo-text">Cryp<span>Share</span></div>
    </div>

    <!-- Error Icon -->
    <span class="download-icon">❌</span>

    <!-- Error Title -->
    <h2 style="justify-content: center">${title}</h2>
    <p>${message}</p>

    <!-- Back to Upload Button -->
    <a href="/" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;">
      <span>📤</span> Upload a New File
    </a>

    <!-- Help Text -->
    <div class="security-badge">
      <span class="security-badge-icon">💡</span>
      <span>Need help? Make sure you have the complete share link</span>
    </div>
  `;
}

/**
 * Shows the download-ready UI (hides loading state if any).
 */
function showDownloadReady() {
  // The page is already set up for download, nothing to do
  // This function exists for clarity and future enhancements
}

// Run validation when page loads
document.addEventListener("DOMContentLoaded", validateDownloadLink);

// =============================================================================
// UI Helper Functions
// =============================================================================

function showAlert(title, message) {
  const alert = document.getElementById("alert");
  const alertTitle = document.getElementById("alert-title");
  const alertMessage = document.getElementById("alert-message");

  alertTitle.textContent = title;
  alertMessage.textContent = message;
  alert.classList.add("show");
}

function hideAlert() {
  document.getElementById("alert").classList.remove("show");
}

function updateStep(stepId, status) {
  const step = document.getElementById(stepId);
  const icon = step.querySelector(".status-icon");

  // Remove all status classes
  step.classList.remove("pending", "complete", "error");

  // Add new status
  step.classList.add(status);

  // Update icon
  if (status === "complete") {
    icon.textContent = "✓";
  } else if (status === "error") {
    icon.textContent = "✗";
  } else {
    icon.textContent = "○";
  }
}

function showStatus() {
  document.getElementById("statusContainer").style.display = "block";
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
    // Check for Web Crypto API
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        "Web Crypto API not available. Please use HTTPS or localhost."
      );
    }

    // Get parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get("id");
    const keyString = window.location.hash.substring(1);

    if (!fileId || !keyString) {
      throw new Error(
        "Invalid download link. Missing file ID or decryption key."
      );
    }

    // Validate fileId format (should be like file-timestamp-random.bin)
    if (!/^file-\d+-[a-f0-9]+\.bin$/.test(fileId)) {
      throw new Error("Invalid file ID format.");
    }

    // Step 1: Fetch encrypted file
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

    // Step 2: Import decryption key
    const jwk = {
      kty: "oct",
      k: keyString,
      alg: "A256GCM",
      ext: true,
    };

    let key;
    try {
      key = await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (keyError) {
      throw new Error("Invalid decryption key. The link may be corrupted.");
    }
    updateStep("step2", "complete");

    // Step 3: Decrypt
    // Extract IV (first 12 bytes) and encrypted data
    const iv = new Uint8Array(encryptedBlob.slice(0, 12));
    const encryptedData = encryptedBlob.slice(12);

    let decryptedBuffer;
    try {
      decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encryptedData
      );
    } catch (decryptError) {
      throw new Error(
        "Decryption failed. The file may be corrupted or the key is incorrect."
      );
    }
    updateStep("step3", "complete");

    // Step 4: Extract filename and prepare download
    updateStep("step4", "complete");

    const decryptedArray = new Uint8Array(decryptedBuffer);

    // Validate minimum size (at least 2 bytes for filename length)
    if (decryptedArray.length < 2) {
      throw new Error("Invalid file format: data too short.");
    }

    // Extract filename length (first 2 bytes)
    const filenameLength = (decryptedArray[0] << 8) | decryptedArray[1];

    // Validate filename length bounds
    if (
      filenameLength === 0 ||
      filenameLength > 1000 ||
      2 + filenameLength > decryptedArray.length
    ) {
      throw new Error("Invalid file format: corrupted filename data.");
    }

    // Extract filename
    const filenameBytes = decryptedArray.slice(2, 2 + filenameLength);
    let originalFilename = new TextDecoder().decode(filenameBytes);

    // Sanitize filename: remove path separators and null bytes to prevent directory traversal
    originalFilename =
      originalFilename.replace(/[/\\]/g, "_").replace(/\x00/g, "").trim() ||
      "download";

    // Extract file content
    const fileContent = decryptedArray.slice(2 + filenameLength);

    // Create download
    const blob = new Blob([fileContent]);
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = originalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    // Success state
    btn.disabled = false;
    btn.innerHTML = "<span>✓</span> Download Complete";
    btn.classList.add("btn-secondary");
    btn.classList.remove("btn-primary");
  } catch (error) {
    // Mark remaining steps as error
    ["step1", "step2", "step3", "step4"].forEach((step) => {
      const el = document.getElementById(step);
      if (el.classList.contains("pending")) {
        updateStep(step, "error");
      }
    });

    showAlert(
      "Decryption Failed",
      error.message || "An unexpected error occurred."
    );

    btn.disabled = false;
    btn.innerHTML = "<span>⬇️</span> Retry Download";
  }
}
