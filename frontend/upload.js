// =============================================================================
// CrypShare - Upload & Encryption Module (Hybrid E2EE)
// =============================================================================
// Supports both:
// 1. Link-based access (existing) - AES key in URL fragment
// 2. Identity-based access (new) - AES key encrypted with recipient public keys
// =============================================================================

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

// State tracking
let hasActiveLink = false;
let overwriteWarningShown = false;
let linkCopied = false;
let currentIdentity = null;
let selectedRecipients = [];

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

function updateProgress(percent, status) {
  const container = document.getElementById("progressContainer");
  const track = document.getElementById("progressTrack");
  const percentEl = document.getElementById("progressPercent");
  const statusEl = document.getElementById("progressStatus");

  container.classList.add("show");

  const filled = Math.floor(percent / 4);
  const empty = 25 - filled;
  track.textContent = "[" + "#".repeat(filled) + ".".repeat(empty) + "]";

  percentEl.textContent = percent + "%";
  statusEl.textContent = status;
}

function hideProgress() {
  document.getElementById("progressContainer").classList.remove("show");
}

function showShareLink(link) {
  const container = document.getElementById("shareContainer");
  const input = document.getElementById("shareLink");

  container.classList.add("show");
  input.value = link;

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

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function clearFile() {
  const fileInput = document.getElementById("fileInput");
  const fileSelected = document.getElementById("fileSelected");

  fileInput.value = "";
  fileSelected.classList.remove("show");
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
  const identityName = document.getElementById("identityName");
  const identityFingerprint = document.getElementById("identityFingerprint");

  if (currentIdentity) {
    noIdentitySection?.classList.add("hidden");
    hasIdentitySection?.classList.remove("hidden");

    if (identityName) {
      identityName.textContent = currentIdentity.displayName;
    }
    if (identityFingerprint) {
      identityFingerprint.textContent =
        IdentityManager.getShortFingerprint(currentIdentity);
    }
  } else {
    noIdentitySection?.classList.remove("hidden");
    hasIdentitySection?.classList.add("hidden");
  }
}

async function createIdentity() {
  const nameInput = document.getElementById("identityNameInput");
  const displayName = nameInput?.value.trim() || "";

  try {
    currentIdentity = await IdentityManager.generateIdentity(displayName);
    updateIdentityUI();
    showAlert(
      "Identity Created",
      "Your cryptographic identity has been generated and stored securely."
    );
    setTimeout(hideAlert, 3000);
  } catch (error) {
    showAlert("Error", "Failed to create identity: " + error.message);
  }
}

async function exportIdentity() {
  if (!currentIdentity) {
    showAlert("No Identity", "Create an identity first.");
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
    showAlert("No Identity", "Create an identity first.");
    return;
  }

  const publicIdentity = IdentityManager.exportPublicIdentity(currentIdentity);
  const publicKeyData = JSON.stringify(publicIdentity);

  try {
    await navigator.clipboard.writeText(publicKeyData);
    showAlert("Copied", "Your public identity has been copied to clipboard.");
    setTimeout(hideAlert, 2000);
  } catch (error) {
    showAlert("Error", "Failed to copy: " + error.message);
  }
}

// =============================================================================
// Recipient Management
// =============================================================================

async function loadContacts() {
  const contactsList = document.getElementById("contactsList");
  if (!contactsList) return;

  try {
    const contacts = await IdentityManager.getContacts();

    if (contacts.length === 0) {
      contactsList.innerHTML =
        '<div class="no-contacts">No contacts added yet</div>';
      return;
    }

    contactsList.innerHTML = contacts
      .map(
        (contact) => `
      <div class="contact-item" data-id="${contact.id}">
        <input type="checkbox" class="contact-checkbox" 
               onchange="toggleRecipient('${contact.id}', this.checked)">
        <div class="contact-info">
          <span class="contact-name">${escapeHtml(contact.displayName)}</span>
          <span class="contact-fingerprint">${contact.fingerprint
            .substring(0, 16)
            .toUpperCase()}</span>
        </div>
        <button class="contact-remove" onclick="removeContactUI('${
          contact.id
        }')" title="Remove contact">×</button>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Failed to load contacts:", error);
  }
}

function toggleRecipient(contactId, selected) {
  if (selected) {
    if (!selectedRecipients.includes(contactId)) {
      selectedRecipients.push(contactId);
    }
  } else {
    selectedRecipients = selectedRecipients.filter((id) => id !== contactId);
  }
  updateRecipientCount();
}

function updateRecipientCount() {
  const countEl = document.getElementById("recipientCount");
  if (countEl) {
    countEl.textContent =
      selectedRecipients.length > 0
        ? `${selectedRecipients.length} recipient(s) selected`
        : "";
  }
}

async function removeContactUI(contactId) {
  try {
    await IdentityManager.removeContact(contactId);
    selectedRecipients = selectedRecipients.filter((id) => id !== contactId);
    await loadContacts();
    updateRecipientCount();
  } catch (error) {
    showAlert("Error", "Failed to remove contact: " + error.message);
  }
}

async function importContact() {
  const input = document.getElementById("importContactInput");
  if (!input || !input.value.trim()) {
    showAlert("Error", "Please paste a public identity JSON.");
    return;
  }

  try {
    const publicIdentity = JSON.parse(input.value.trim());

    // Validate required fields
    if (
      !publicIdentity.id ||
      !publicIdentity.encryptionPublicKey ||
      !publicIdentity.signingPublicKey
    ) {
      throw new Error("Invalid public identity format");
    }

    await IdentityManager.addContact(publicIdentity);
    input.value = "";
    await loadContacts();
    showAlert(
      "Contact Added",
      `Added ${publicIdentity.displayName} to your contacts.`
    );
    setTimeout(hideAlert, 2000);
  } catch (error) {
    showAlert("Error", "Failed to import contact: " + error.message);
  }
}

async function importContactFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const publicIdentity = JSON.parse(text);

      if (!publicIdentity.id || !publicIdentity.encryptionPublicKey) {
        throw new Error("Invalid public identity format");
      }

      await IdentityManager.addContact(publicIdentity);
      await loadContacts();
      showAlert(
        "Contact Added",
        `Added ${publicIdentity.displayName} to your contacts.`
      );
      setTimeout(hideAlert, 2000);
    } catch (error) {
      showAlert("Error", "Failed to import contact: " + error.message);
    }
  };

  input.click();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
// Drag & Drop Handlers
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  // Initialize identity panel
  initializeIdentityPanel();
  loadContacts();

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
      handleFileSelect(files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });
});

function handleFileSelect(file) {
  hideAlert();
  proceedWithFileSelect(file);
}

function proceedWithFileSelect(file) {
  const fileSelected = document.getElementById("fileSelected");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");

  if (file.size > MAX_FILE_SIZE) {
    showAlert(
      "File Too Large",
      `Maximum file size is 1GB. Your file is ${formatFileSize(file.size)}.`
    );
    clearFile();
    return;
  }

  const fileInput = document.getElementById("fileInput");
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;

  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileSelected.classList.add("show");
}

// =============================================================================
// Main Encryption & Upload Process (Hybrid E2EE)
// =============================================================================

async function processFile() {
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");

  hideAlert();

  if (fileInput.files.length === 0) {
    showAlert(
      "No File Selected",
      "Please select a file to encrypt and upload."
    );
    return;
  }

  if (hasActiveLink && !overwriteWarningShown && !linkCopied) {
    showOverwriteModal(fileInput.files[0]);
    return;
  }

  await executeUpload();
}

async function executeUpload() {
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");
  const enableSigning =
    document.getElementById("enableSigning")?.checked || false;
  const includeLinkKey =
    document.getElementById("includeLinkKey")?.checked !== false; // Default true

  document.getElementById("shareContainer").classList.remove("show");

  const file = fileInput.files[0];

  if (file.size > MAX_FILE_SIZE) {
    showAlert(
      "File Too Large",
      `Maximum file size is 1GB. Your file is ${formatFileSize(file.size)}.`
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

    // Step 1: Generate AES file key
    updateProgress(5, "Generating encryption key...");
    const aesKey = await CryptoModule.generateAESKey();
    const exportedKey = await CryptoModule.exportAESKey(aesKey);

    // Step 2: Encrypt file using chunked encryption (memory-efficient for large files)
    updateProgress(10, "Encrypting file in chunks...");
    const encryptedBlob = await CryptoModule.encryptFileChunked(
      file,
      aesKey,
      (chunkProgress) => {
        // Map chunk progress (0-100) to overall progress (10-50)
        const overallProgress = 10 + Math.round(chunkProgress * 0.4);
        updateProgress(overallProgress, `Encrypting... ${chunkProgress}%`);
      }
    );

    // Step 3: Prepare metadata
    updateProgress(55, "Preparing metadata...");

    // For content hash, read file in chunks to avoid memory issues
    const contentHash = await CryptoModule.hashFile(file);

    const metadata = {
      version: 2, // Chunked encryption format
      filename: file.name,
      size: file.size,
      contentHash: contentHash,
      timestamp: new Date().toISOString(),
      accessModes: [],
      encryptedKeys: [],
      signature: null,
    };

    // Step 4: Encrypt key for selected recipients (identity-based access)
    if (selectedRecipients.length > 0) {
      updateProgress(60, "Encrypting key for recipients...");
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

    // Step 5: Add link-based access if enabled
    if (includeLinkKey) {
      metadata.accessModes.push("link");
    }

    // Step 6: Sign metadata if identity exists and signing is enabled
    if (enableSigning && currentIdentity) {
      updateProgress(65, "Signing metadata...");
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

    // Step 7: Upload encrypted file
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

    // Step 8: Upload metadata (if using identity-based access or signatures)
    if (metadata.encryptedKeys.length > 0 || metadata.signature) {
      updateProgress(90, "Uploading metadata...");

      const metadataResponse = await fetch(`/metadata/${serverData.fileId}`, {
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

    // Step 9: Generate share link
    updateProgress(100, "Complete!");

    let shareLink;
    if (includeLinkKey) {
      // Include key in URL fragment (original behavior)
      shareLink = `${window.location.origin}/download?id=${encodeURIComponent(
        serverData.fileId
      )}#${exportedKey.k}`;
    } else {
      // Identity-only access - no key in URL
      shareLink = `${window.location.origin}/download?id=${encodeURIComponent(
        serverData.fileId
      )}`;
    }

    // Show success
    setTimeout(() => {
      hideProgress();
      showShareLink(shareLink);
      showUploadStatusBadges(
        includeLinkKey,
        selectedRecipients.length,
        enableSigning && currentIdentity
      );
      showShareModeInfo(includeLinkKey, selectedRecipients.length);
      showSignatureStatusInfo(enableSigning, currentIdentity);
      updateSecurityWarning(includeLinkKey);
    }, 500);
  } catch (error) {
    hideProgress();
    showAlert(
      "Encryption Failed",
      error.message || "An unexpected error occurred."
    );
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = "<span>🔒</span> Encrypt & Upload";
  }
}

function showShareModeInfo(hasLinkKey, recipientCount) {
  const infoEl = document.getElementById("shareModeInfo");
  if (!infoEl) return;

  let message = "";
  let icon = "";

  if (hasLinkKey && recipientCount > 0) {
    icon = "🔓";
    message = `Hybrid access: Anyone with link can decrypt + ${recipientCount} identity recipient(s)`;
  } else if (hasLinkKey) {
    icon = "🔗";
    message = "Link-based access: Anyone with this link can decrypt the file";
  } else if (recipientCount > 0) {
    icon = "🔐";
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

  // Encryption badge (always shown)
  badges.push(
    `<span class="status-badge badge-encrypted">🔒 AES-256-GCM Encrypted</span>`
  );

  // Access mode badges
  if (hasLinkKey) {
    badges.push(`<span class="status-badge badge-link">🔗 Link Access</span>`);
  }
  if (recipientCount > 0) {
    badges.push(
      `<span class="status-badge badge-identity">👤 ${recipientCount} Recipient(s)</span>`
    );
  }

  // Signature badge
  if (isSigned) {
    badges.push(`<span class="status-badge badge-signed">✍️ Signed</span>`);
  } else {
    badges.push(`<span class="status-badge badge-unsigned">📝 Unsigned</span>`);
  }

  container.innerHTML = badges.join("");
  container.classList.add("show");
}

function showSignatureStatusInfo(enableSigning, identity) {
  const infoEl = document.getElementById("signatureStatusInfo");
  if (!infoEl) return;

  if (enableSigning && identity) {
    infoEl.innerHTML = `
      <div class="sig-status sig-signed">
        <span class="sig-icon">✅</span>
        <div class="sig-content">
          <strong>File Signed</strong>
          <span class="sig-detail">Signed by: ${escapeHtml(
            identity.displayName
          )} (${identity.fingerprint})</span>
          <span class="sig-note">Recipients can verify this file came from you.</span>
        </div>
      </div>
    `;
    infoEl.classList.add("show");
  } else if (enableSigning && !identity) {
    infoEl.innerHTML = `
      <div class="sig-status sig-warning">
        <span class="sig-icon">⚠️</span>
        <div class="sig-content">
          <strong>Signature Skipped</strong>
          <span class="sig-note">No identity configured. Create an identity to sign files.</span>
        </div>
      </div>
    `;
    infoEl.classList.add("show");
  } else {
    infoEl.innerHTML = `
      <div class="sig-status sig-unsigned">
        <span class="sig-icon">📝</span>
        <div class="sig-content">
          <strong>File Not Signed</strong>
          <span class="sig-note">Recipients cannot verify who uploaded this file.</span>
        </div>
      </div>
    `;
    infoEl.classList.add("show");
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
        <span class="spw-success-icon">🔐</span>
        <span class="spw-success-text">
          <strong>ENHANCED SECURITY:</strong> Even if the link is intercepted, 
          the file cannot be decrypted without the recipient's private key.
        </span>
      </div>
    `;
  }
}
