// =============================================================================
// CrypShare - Upload & Encryption Module (ES Module - Hybrid E2EE)
// =============================================================================
// Main orchestration module for file encryption and upload.
// Delegates to specialized modules for specific concerns:
// - expiry.js: Countdown timer and expiry selection
// - recipients.js: Contact/recipient management  
// - file-handler.js: File selection and drag/drop
// =============================================================================

import CryptoModule from './crypto.js';
import IdentityManager from './identity.js';
import { showAlert, hideAlert, showToast, escapeHtml, updateProgress, hideProgress } from './ui-utils.js';
import { getSelectedExpiryHours, updateExpiryNotice, startCountdownTimer } from './expiry.js';
import { 
  getSelectedRecipients, 
  clearSelectedRecipients, 
  loadContacts, 
  toggleRecipient as toggleRecipientBase,
  updateRecipientCount,
  removeContactUI as removeContactUIBase,
  importContact,
  importContactFromFile
} from './recipients.js';
import { initializeFileHandler, clearFile, getSelectedFile, getMaxFileSize } from './file-handler.js';

// State tracking
let hasActiveLink = false;
let overwriteWarningShown = false;
let linkCopied = false;
let currentIdentity = null;

// =============================================================================
// Access Configuration Validation
// =============================================================================

function validateAccessConfig() {
  const includeLinkKeyCheckbox = document.getElementById("includeLinkKey");
  const enableSigning =
    document.getElementById("enableSigning")?.checked || false;
  const uploadBtn = document.getElementById("uploadBtn");
  const warningEl = document.getElementById("accessWarning");
  const warningTitle = document.getElementById("accessWarningTitle");
  const warningMessage = document.getElementById("accessWarningMessage");

  if (!warningEl || !uploadBtn || !includeLinkKeyCheckbox)
    return { valid: true, canUpload: true };

  const includeLinkKey = includeLinkKeyCheckbox.checked;
  const selectedRecipients = getSelectedRecipients();

  let isValid = true;
  let canUpload = true;
  let warningType = "error";

  if (!includeLinkKey && selectedRecipients.length === 0) {
    isValid = false;
    canUpload = false;
    warningTitle.textContent = "No Decryption Method";
    warningMessage.textContent =
      "Enable 'Include key in link' OR select at least one recipient. Without either, no one can decrypt the file.";
    warningType = "error";
  } else if (enableSigning && !currentIdentity) {
    isValid = false;
    canUpload = true;
    warningTitle.textContent = "Cannot Sign File";
    warningMessage.textContent =
      "You enabled signing but have no identity. Create an identity first, or disable signing to continue.";
    warningType = "warning";
  }

  if (!isValid) {
    warningEl.classList.add("show");
    warningEl.classList.toggle("warning", warningType === "warning");
  } else {
    warningEl.classList.remove("show", "warning");
  }

  uploadBtn.disabled = !canUpload;
  uploadBtn.classList.toggle("disabled", !canUpload);

  return { valid: isValid, canUpload: canUpload };
}

// =============================================================================
// Mutual Exclusivity: Recipients vs Link Key
// =============================================================================

function updateLinkKeyState() {
  const includeLinkKeyCheckbox = document.getElementById("includeLinkKey");
  const linkKeyLabel = includeLinkKeyCheckbox?.closest(".option-label");
  const linkKeyDesc = linkKeyLabel?.querySelector(".option-desc");

  if (!includeLinkKeyCheckbox) return;

  const hasRecipients = getSelectedRecipients().length > 0;

  if (hasRecipients) {
    if (includeLinkKeyCheckbox.checked) {
      includeLinkKeyCheckbox.checked = false;
      showToast("Public link disabled for secure recipient delivery 🛡️");
    }
    includeLinkKeyCheckbox.disabled = true;
    linkKeyLabel?.classList.add("disabled");
    if (linkKeyDesc) {
      linkKeyDesc.textContent =
        "Disabled — file encrypted for specific recipients";
    }
  } else {
    includeLinkKeyCheckbox.disabled = false;
    linkKeyLabel?.classList.remove("disabled");
    if (linkKeyDesc) {
      linkKeyDesc.textContent =
        "Anyone with the link can decrypt (default behavior)";
    }
    if (!includeLinkKeyCheckbox.checked) {
      includeLinkKeyCheckbox.checked = true;
    }
  }

  validateAccessConfig();
}

// Wrappers for recipient functions that also update link key state
function toggleRecipient(contactId, selected) {
  toggleRecipientBase(contactId, selected, updateLinkKeyState);
}

function removeContactUI(contactId) {
  removeContactUIBase(contactId, updateLinkKeyState);
}

// =============================================================================
// UI Helper Functions
// =============================================================================

function showShareLink(link) {
  const container = document.querySelector('.container[data-state]');
  const input = document.getElementById("shareLink");

  input.value = link;
  container.setAttribute('data-state', 'success');

  hasActiveLink = true;
  linkCopied = false;
}

function copyLink() {
  const input = document.getElementById("shareLink");
  const btn = document.getElementById("copyBtn");

  navigator.clipboard
    .writeText(input.value)
    .then(() => {
      btn.classList.add("copied");
      btn.innerHTML = "<span>✓</span> Copied!";
      linkCopied = true;

      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = "<span>📋</span> Copy";
      }, 2000);
    })
    .catch(() => {
      input.select();
      document.execCommand("copy");
      btn.classList.add("copied");
      btn.innerHTML = "<span>✓</span> Copied!";
      linkCopied = true;

      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = "<span>📋</span> Copy";
      }, 2000);
    });
}

function resetToUpload() {
  const container = document.querySelector('.container[data-state]');
  
  container.setAttribute('data-state', 'upload');
  clearFile();
  
  hasActiveLink = false;
  overwriteWarningShown = false;
  linkCopied = false;
  
  const uploadStatusBadges = document.getElementById("uploadStatusBadges");
  const shareModeInfo = document.getElementById("shareModeInfo");
  const signatureStatusInfo = document.getElementById("signatureStatusInfo");
  
  if (uploadStatusBadges) {
    uploadStatusBadges.classList.remove("show");
    uploadStatusBadges.innerHTML = "";
  }
  if (shareModeInfo) shareModeInfo.classList.remove("show");
  if (signatureStatusInfo) signatureStatusInfo.classList.remove("show");
  
  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) {
    copyBtn.classList.remove("copied");
    copyBtn.innerHTML = "<span>📋</span> Copy";
  }
}

// =============================================================================
// Identity Panel Functions
// =============================================================================

async function initializeIdentityPanel() {
  const identityPanel = document.getElementById("identityPanel");
  if (!identityPanel) return;

  try {
    currentIdentity = await IdentityManager.getIdentity();
    updateIdentityUI();
  } catch (error) {
    console.error("Failed to load identity:", error);
  }
}

function updateIdentityUI() {
  const noIdentitySection = document.getElementById("noIdentitySection");
  const hasIdentitySection = document.getElementById("hasIdentitySection");
  const headerIdentityName = document.getElementById("headerIdentityName");
  const headerFingerprint = document.getElementById("headerFingerprint");
  const identityFingerprint = document.getElementById("identityFingerprint");

  if (currentIdentity) {
    noIdentitySection?.classList.add("hidden");
    hasIdentitySection?.classList.remove("hidden");
    headerFingerprint?.classList.remove("hidden");

    if (headerIdentityName) {
      headerIdentityName.textContent = currentIdentity.displayName || "IDENTITY";
    }
    if (identityFingerprint) {
      identityFingerprint.textContent =
        IdentityManager.getShortFingerprint(currentIdentity);
    }
  } else {
    noIdentitySection?.classList.remove("hidden");
    hasIdentitySection?.classList.add("hidden");
    headerFingerprint?.classList.add("hidden");
    
    if (headerIdentityName) {
      headerIdentityName.textContent = "IDENTITY";
    }
  }
}

async function createIdentity() {
  const nameInput = document.getElementById("identityNameInput");
  const displayName = nameInput?.value.trim() || "";

  try {
    currentIdentity = await IdentityManager.generateIdentity(displayName);
    updateIdentityUI();
    validateAccessConfig();
    showToast("Identity created successfully ✓");
  } catch (error) {
    showToast("Failed to create identity ✗");
  }
}

async function exportIdentity() {
  if (!currentIdentity) {
    showAlert("No Identity", "Create an identity first.", "warning");
    return;
  }

  const publicIdentity = IdentityManager.exportPublicIdentity(currentIdentity);
  const blob = new Blob([JSON.stringify(publicIdentity, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `crypshare-identity-${publicIdentity.id.substring(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyPublicKey() {
  if (!currentIdentity) {
    showToast("Create an identity first ⚠");
    return;
  }

  const publicIdentity = IdentityManager.exportPublicIdentity(currentIdentity);
  const publicKeyData = JSON.stringify(publicIdentity);
  const btn = document.querySelector('[onclick="copyPublicKey()"]');

  try {
    await navigator.clipboard.writeText(publicKeyData);
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = "✓ Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove("copied");
      }, 2000);
    }
  } catch (error) {
    showToast("Failed to copy ✗");
  }
}

// =============================================================================
// Link Overwrite Warning Modal
// =============================================================================

function showOverwriteModal(file) {
  const modal = document.getElementById("linkOverwriteModal");
  const linkPreview = document.getElementById("modalLinkPreview");
  const currentLink = document.getElementById("shareLink").value;

  if (currentLink) {
    linkPreview.textContent =
      currentLink.length > 50
        ? currentLink.substring(0, 50) + "..."
        : currentLink;
    linkPreview.style.display = "block";
  } else {
    linkPreview.style.display = "none";
  }

  modal.classList.add("show");
}

function hideOverwriteModal() {
  const modal = document.getElementById("linkOverwriteModal");
  modal.classList.remove("show");
}

function confirmNewUpload() {
  const modal = document.getElementById("linkOverwriteModal");
  modal.classList.remove("show");
  overwriteWarningShown = true;
  executeUpload();
}

// =============================================================================
// Initialization
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Initialize identity panel
  initializeIdentityPanel();
  loadContacts();

  // Initialize file handler
  initializeFileHandler(() => {
    // Callback when file is selected - validation happens automatically
  });

  // Initial validation check
  setTimeout(validateAccessConfig, 100);
  
  // Expiry selector change listener
  const expirySelect = document.getElementById("expirySelect");
  if (expirySelect) {
    expirySelect.addEventListener("change", updateExpiryNotice);
  }
});

// =============================================================================
// Main Upload Process
// =============================================================================

async function processFile() {
  const uploadBtn = document.getElementById("uploadBtn");
  const file = getSelectedFile();

  hideAlert();

  const validation = validateAccessConfig();
  if (!validation.canUpload) {
    showAlert(
      "Invalid Configuration",
      "Please fix the access configuration issues before uploading.",
      "warning"
    );
    return;
  }

  if (!file) {
    showAlert(
      "No File Selected",
      "Please select a file to encrypt and upload.",
      "warning"
    );
    return;
  }

  if (hasActiveLink && !overwriteWarningShown && !linkCopied) {
    showOverwriteModal(file);
    return;
  }

  await executeUpload();
}

const STREAMING_THRESHOLD = 100 * 1024 * 1024;

async function executeUpload() {
  const uploadBtn = document.getElementById("uploadBtn");
  const enableSigning =
    document.getElementById("enableSigning")?.checked || false;
  const includeLinkKey =
    document.getElementById("includeLinkKey")?.checked !== false;

  const container = document.querySelector('.container[data-state]');
  if (container) {
    container.setAttribute('data-state', 'upload');
  }

  const file = getSelectedFile();

  if (file.size > getMaxFileSize()) {
    showAlert(
      "File Too Large",
      `Maximum file size is 1GB.`,
      "error"
    );
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = "<span>⏳</span> Processing...";

  try {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        "Web Crypto API not available. Please use HTTPS or localhost."
      );
    }

    const useStreaming =
      file.size > STREAMING_THRESHOLD && CryptoModule.supportsStreamingUpload();

    if (useStreaming) {
      try {
        await executeStreamingUpload(file, enableSigning, includeLinkKey);
      } catch (streamError) {
        const isHttp2Issue =
          streamError.message.includes("Failed to fetch") ||
          streamError.message.includes("ALPN");
        if (!isHttp2Issue) {
          console.warn(
            "⚠️ Streaming upload failed, falling back to buffered:",
            streamError.message
          );
        }
        await executeBufferedUpload(file, enableSigning, includeLinkKey);
      }
    } else {
      await executeBufferedUpload(file, enableSigning, includeLinkKey);
    }
  } catch (error) {
    hideProgress();
    showAlert(
      "Encryption Failed",
      error.message || "An unexpected error occurred.",
      "error"
    );
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = "<span>🔒</span> Encrypt & Upload";
  }
}

async function executeStreamingUpload(file, enableSigning, includeLinkKey) {
  updateProgress(5, "Generating encryption key...");
  const aesKey = await CryptoModule.generateAESKey();
  const exportedKey = await CryptoModule.exportAESKey(aesKey);

  updateProgress(10, "Computing file hash (streaming)...");
  const originalFileHash = await CryptoModule.hashFile(
    file,
    (hashProgress) => {
      const overallProgress = 10 + Math.round(hashProgress * 0.15);
      updateProgress(overallProgress, `Hashing... ${hashProgress}%`);
    }
  );

  updateProgress(25, "Preparing metadata...");
  const metadata = await prepareMetadata(
    file,
    originalFileHash,
    aesKey,
    enableSigning,
    includeLinkKey
  );

  updateProgress(30, "Starting streaming upload...");
  const { stream: encryptedStream } = await CryptoModule.createEncryptedStream(
    file,
    aesKey,
    (encryptProgress) => {
      const overallProgress = 30 + Math.round(encryptProgress * 0.6);
      updateProgress(
        overallProgress,
        `Encrypting & uploading... ${encryptProgress}%`
      );
    }
  );

  const uploadResponse = await fetch("/upload-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: encryptedStream,
    duplex: "half",
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status}`);
  }

  const serverData = await uploadResponse.json();

  if (!serverData.fileId) {
    throw new Error("Server did not return a file ID.");
  }

  await uploadMetadata(serverData.fileId, metadata);

  updateProgress(100, "Complete!");
  const shareLink = generateShareLink(
    serverData.fileId,
    exportedKey.k,
    includeLinkKey
  );
  showUploadSuccess(shareLink, includeLinkKey, enableSigning, metadata.expiresAt);
}

async function executeBufferedUpload(file, enableSigning, includeLinkKey) {
  updateProgress(5, "Generating encryption key...");
  const aesKey = await CryptoModule.generateAESKey();
  const exportedKey = await CryptoModule.exportAESKey(aesKey);

  updateProgress(10, "Encrypting file in chunks...");
  const encryptedBlob = await CryptoModule.encryptFileChunked(
    file,
    aesKey,
    (chunkProgress) => {
      const overallProgress = 10 + Math.round(chunkProgress * 0.4);
      updateProgress(overallProgress, `Encrypting... ${chunkProgress}%`);
    }
  );

  updateProgress(55, "Computing file hash...");
  const originalFileHash = await CryptoModule.hashFile(file);

  updateProgress(60, "Preparing metadata...");
  const metadata = await prepareMetadata(
    file,
    originalFileHash,
    aesKey,
    enableSigning,
    includeLinkKey
  );

  updateProgress(70, "Uploading encrypted file...");
  const formData = new FormData();
  formData.append("encryptedFile", encryptedBlob, "encrypted.bin");

  const uploadResponse = await fetch("/upload", {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status}`);
  }

  const serverData = await uploadResponse.json();

  if (!serverData.fileId) {
    throw new Error("Server did not return a file ID.");
  }

  await uploadMetadata(serverData.fileId, metadata);

  updateProgress(100, "Complete!");
  const shareLink = generateShareLink(
    serverData.fileId,
    exportedKey.k,
    includeLinkKey
  );
  showUploadSuccess(shareLink, includeLinkKey, enableSigning, metadata.expiresAt);
}

async function prepareMetadata(
  file,
  contentHash,
  aesKey,
  enableSigning,
  includeLinkKey
) {
  const expiryHours = getSelectedExpiryHours();
  const expiresAt = Date.now() + (expiryHours * 60 * 60 * 1000);
  const selectedRecipients = getSelectedRecipients();
  
  const metadata = {
    version: 2,
    filename: file.name,
    size: file.size,
    contentHash: contentHash,
    timestamp: new Date().toISOString(),
    expiresAt: expiresAt,
    expiryHours: expiryHours,
    accessModes: [],
    encryptedKeys: [],
    signature: null,
  };

  if (selectedRecipients.length > 0) {
    metadata.accessModes.push("identity");

    for (const recipientId of selectedRecipients) {
      const contact = await IdentityManager.getContact(recipientId);
      if (contact) {
        const recipientPublicKey = await CryptoModule.importECDHPublicKey(
          contact.encryptionPublicKey
        );
        const encryptedKeyBundle = await CryptoModule.encryptKeyForRecipient(
          aesKey,
          recipientPublicKey
        );

        metadata.encryptedKeys.push({
          recipientId: recipientId,
          recipientFingerprint: contact.fingerprint,
          ...encryptedKeyBundle,
        });
      }
    }
  }

  if (includeLinkKey) {
    metadata.accessModes.push("link");
  }

  if (enableSigning && currentIdentity) {
    const loadedIdentity = await IdentityManager.loadIdentityKeys(
      currentIdentity
    );

    const signatureBundle = await CryptoModule.signFileMetadata(
      { filename: file.name, size: file.size, contentHash: contentHash },
      loadedIdentity.signing.privateKey
    );

    metadata.signature = {
      ...signatureBundle,
      signerId: currentIdentity.id,
      signerFingerprint: currentIdentity.fingerprint,
      signerPublicKey: currentIdentity.signing.publicKey,
    };
  }

  return metadata;
}

async function uploadMetadata(fileId, metadata) {
  const hasCustomExpiry = metadata.expiryHours !== 24;
  const hasRecipients = metadata.encryptedKeys.length > 0;
  const hasSignature = metadata.signature !== null;
  
  if (hasCustomExpiry || hasRecipients || hasSignature) {
    updateProgress(95, "Uploading metadata...");

    const metadataResponse = await fetch(`/metadata/${fileId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });

    if (!metadataResponse.ok) {
      console.warn(
        "Failed to upload metadata, link-based access will still work"
      );
    }
  }
  
  return metadata;
}

function generateShareLink(fileId, keyString, includeLinkKey) {
  if (includeLinkKey) {
    return `${window.location.origin}/download?id=${encodeURIComponent(
      fileId
    )}#${keyString}`;
  } else {
    return `${window.location.origin}/download?id=${encodeURIComponent(
      fileId
    )}`;
  }
}

function showUploadSuccess(shareLink, includeLinkKey, enableSigning, expiresAt) {
  setTimeout(() => {
    hideProgress();
    showShareLink(shareLink);
    
    if (expiresAt) {
      startCountdownTimer(expiresAt);
    }
    
    showUploadStatusBadges(
      includeLinkKey,
      getSelectedRecipients().length,
      enableSigning && currentIdentity
    );
    showShareModeInfo(includeLinkKey, getSelectedRecipients().length);
    showSignatureStatusInfo(enableSigning, currentIdentity);
    updateSecurityWarning(includeLinkKey);
  }, 500);
}

function showShareModeInfo(hasLinkKey, recipientCount) {
  const infoEl = document.getElementById("shareModeInfo");
  if (!infoEl) return;

  let message = "";
  let icon = "";

  if (hasLinkKey && recipientCount > 0) {
    icon = "🔐";
    message = `Hybrid access: Anyone with link can decrypt + ${recipientCount} identity recipient(s)`;
  } else if (hasLinkKey) {
    icon = "🔗";
    message = "Link-based access: Anyone with this link can decrypt the file";
  } else if (recipientCount > 0) {
    icon = "👤";
    message = `Identity-only access: Only ${recipientCount} selected recipient(s) can decrypt`;
  } else {
    icon = "⚠️";
    message = "Warning: No access method selected. File cannot be decrypted!";
  }

  infoEl.innerHTML = `<span class="info-icon">${icon}</span> ${message}`;
  infoEl.classList.add("show");
}

function showUploadStatusBadges(hasLinkKey, recipientCount, isSigned) {
  const container = document.getElementById("uploadStatusBadges");
  if (!container) return;

  let badges = [];

  badges.push(
    `<span class="status-badge badge-encrypted">🔒 AES-256-GCM Encrypted</span>`
  );

  if (recipientCount > 0) {
    badges.push(
      `<span class="status-badge badge-identity">👤 ${recipientCount} Recipient(s)</span>`
    );
  }

  if (isSigned) {
    badges.push(`<span class="status-badge badge-signed">✍️ Signed</span>`);
  }

  container.innerHTML = badges.join("");
  container.classList.add("show");
}

function showSignatureStatusInfo(enableSigning, identity) {
  const infoEl = document.getElementById("signatureStatusInfo");
  if (!infoEl) return;

  if (enableSigning && identity) {
    const shortFingerprint = identity.fingerprint
      .substring(0, 16)
      .toUpperCase();
    infoEl.innerHTML = `
      <div class="sig-status sig-signed">
        <div class="sig-verified-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <div class="sig-content">
          <span class="sig-detail">Signed by: ${escapeHtml(
            identity.displayName
          )} (${shortFingerprint})</span>
          <span class="sig-note">Recipients can verify this file came from you.</span>
        </div>
      </div>
    `;
    infoEl.classList.add("show");
  } else if (enableSigning && !identity) {
    infoEl.innerHTML = `
      <div class="sig-status sig-warning">
        <div class="sig-warning-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 9v4m0 4h.01"/>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
        </div>
        <div class="sig-content">
          <span class="sig-detail">Signature Skipped</span>
          <span class="sig-note">No identity configured. Create an identity to sign files.</span>
        </div>
      </div>
    `;
    infoEl.classList.add("show");
  } else {
    infoEl.classList.remove("show");
    infoEl.innerHTML = "";
  }
}

function updateSecurityWarning(hasLinkKey) {
  const warningEl = document.getElementById("securityWarning");
  if (!warningEl) return;

  if (hasLinkKey) {
    warningEl.innerHTML = `
      <div class="spw-header">
        <span class="spw-indicator">▶</span>
        <span class="spw-title">LINK CONTAINS DECRYPTION KEY</span>
      </div>
      <p class="spw-instruction">
        This link includes the encryption key. Anyone with the link can decrypt and download the file.
      </p>
      <div class="spw-critical-box">
        <span class="spw-warning-icon">⚠️</span>
        <span class="spw-warning-text">
          <strong>SECURITY NOTE:</strong> Share only via trusted, secure channels. 
          Avoid public forums or group chats.
        </span>
      </div>
    `;
  } else {
    warningEl.innerHTML = `
      <div class="spw-header">
        <span class="spw-indicator">▶</span>
        <span class="spw-title">IDENTITY-ONLY ACCESS</span>
      </div>
      <p class="spw-instruction">
        This link does not contain the decryption key. Only selected recipients with matching identities can decrypt.
      </p>
      <div class="spw-success-box">
        <span class="spw-success-icon">🛡️</span>
        <span class="spw-success-text">
          <strong>ENHANCED SECURITY:</strong> Even if the link is intercepted, 
          the file cannot be decrypted without the recipient's private key.
        </span>
      </div>
    `;
  }
}

// =============================================================================
// Global Function Exports (for onclick handlers in HTML)
// =============================================================================

window.processFile = processFile;
window.copyLink = copyLink;
window.clearFile = clearFile;
window.resetToUpload = resetToUpload;
window.hideAlert = hideAlert;
window.createIdentity = createIdentity;
window.exportIdentity = exportIdentity;
window.copyPublicKey = copyPublicKey;
window.importContact = importContact;
window.importContactFromFile = importContactFromFile;
window.toggleRecipient = toggleRecipient;
window.removeContactUI = removeContactUI;
window.validateAccessConfig = validateAccessConfig;
window.showOverwriteModal = showOverwriteModal;
window.hideOverwriteModal = hideOverwriteModal;
window.confirmNewUpload = confirmNewUpload;
