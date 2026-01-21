// =============================================================================
// CrypShare - Upload & Encryption Module (ES Module - Hybrid E2EE)
// =============================================================================
// Main orchestration module for file encryption and upload.
// Delegates to specialized modules for specific concerns:
// - expiry.js: Countdown timer and expiry selection
// - recipients.js: Contact/recipient management
// - file-handler.js: File selection and drag/drop
// =============================================================================

import * as CryptoModule from "./crypto.js";
import * as IdentityManager from "./identity.js";
import {
  showAlert,
  hideAlert,
  showToast,
  escapeHtml,
  updateProgress,
  hideProgress,
} from "./ui-utils.js";
import {
  getSelectedExpiryHours,
  updateExpiryNotice,
  startCountdownTimer,
  initializeExpiryDropdown,
} from "./expiry.js";
import {
  getSelectedRecipients,
  loadContacts,
  toggleRecipient as toggleRecipientBase,
  removeContactUI as removeContactUIBase,
} from "./recipients.js";
import {
  initializeFileHandler,
  clearFile,
  getSelectedFile,
  validateFileForExpiry,
  getMaxFileSizeForExpiry,
} from "./file-handler.js";
import { formatFileSize } from "./ui-utils.js";

// State tracking
let hasActiveLink = false;
let overwriteWarningShown = false;
let linkCopied = false;
let currentIdentity = null;
let isUploading = false; // Prevents checkbox changes from re-enabling button during upload
let uploadAbortController = null; // AbortController for cancelling in-progress uploads

// =============================================================================
// Access Configuration Validation
// =============================================================================

/**
 * Validate access configuration (recipients selected)
 * @param {Object} options - Configuration options
 * @param {boolean} options.showWarning - Whether to show the warning UI (default: true)
 * @returns {{ valid: boolean, canUpload: boolean }}
 */
function validateAccessConfig(options = {}) {
  const { showWarning = true } = options;
  const uploadBtn = document.getElementById("uploadBtn");
  const warningEl = document.getElementById("accessWarning");
  const warningTitle = document.getElementById("accessWarningTitle");
  const warningMessage = document.getElementById("accessWarningMessage");

  if (!warningEl || !uploadBtn)
    return { valid: true, canUpload: true };

  const selectedRecipients = getSelectedRecipients();

  let isValid = true;
  let canUpload = true;

  if (selectedRecipients.length === 0) {
    isValid = false;
    canUpload = false;
    warningTitle.textContent = "No Recipients Selected";
    warningMessage.textContent =
      "Select at least one recipient to encrypt the file for.";
  }

  // Only show/hide warning UI if showWarning is true
  if (showWarning) {
    if (!isValid) {
      warningEl.classList.add("show");
    } else {
      warningEl.classList.remove("show");
    }
  }

  // Don't change button state if upload is in progress
  if (!isUploading) {
    uploadBtn.disabled = !canUpload;
    uploadBtn.classList.toggle("disabled", !canUpload);
  }

  return { valid: isValid, canUpload: canUpload };
}

// =============================================================================
// Recipient Selection Callback
// =============================================================================

function onRecipientChange() {
  validateAccessConfig();
}

// Wrappers for recipient functions that validate after changes
function toggleRecipient(contactId, selected) {
  toggleRecipientBase(contactId, selected, onRecipientChange);
}

function removeContactUI(contactId) {
  removeContactUIBase(contactId, onRecipientChange);
}

// =============================================================================
// UI Helper Functions
// =============================================================================

/**
 * Re-validate currently selected file when expiry duration changes.
 * Shows warning if file exceeds the new limit.
 * Also updates the max size hint in the drop zone.
 */
function validateFileForCurrentExpiry() {
  const expiryHours = getSelectedExpiryHours();

  // Always update the max size hint in the drop zone
  updateMaxSizeHint(expiryHours);

  const file = getSelectedFile();
  if (!file) return; // No file selected yet

  const validation = validateFileForExpiry(file, expiryHours);

  if (!validation.valid) {
    showAlert("File Exceeds Size Limit", validation.message, "warning");
  } else {
    // File is valid for new expiry, hide any previous warning
    hideAlert();
  }
}

/**
 * Update the max file size hint in the drop zone.
 * @param {number} expiryHours - Current expiry duration in hours
 */
function updateMaxSizeHint(expiryHours) {
  const maxSizeHint = document.getElementById("maxSizeHint");
  if (maxSizeHint) {
    const maxSize = getMaxFileSizeForExpiry(expiryHours);
    maxSizeHint.textContent = `Maximum file size: ${formatFileSize(maxSize)}`;
  }
}

function showShareLink(link) {
  const container = document.querySelector(".container[data-state]");
  const input = document.getElementById("shareLink");

  input.value = link;
  container.setAttribute("data-state", "success");

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
      btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span> Copied!';
      linkCopied = true;

      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></span> Copy';
      }, 2000);
    })
    .catch(() => {
      // Clipboard API failed (e.g., insecure context) - select text for manual copy
      input.select();
      input.setSelectionRange(0, 99999); // For mobile
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
    copyBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg></span> Copy';
  }
}

// =============================================================================
// Identity Panel Functions
// =============================================================================

// =============================================================================
// Identity Panel Functions
// =============================================================================

async function initializeIdentityPanel() {
  const identityPanel = document.getElementById("identityVaultPanel");
  if (!identityPanel) return;

  try {
    currentIdentity = await IdentityManager.getIdentity();
    updateIdentityUI();
    initializeContactsTabs();
  } catch (error) {
    console.error("Failed to load identity:", error);
  }
}

function initializeContactsTabs() {
  const tabs = document.querySelectorAll(".contacts-tab");
  const tabContents = {
    "my-contacts": document.getElementById("myContactsTab"),
    "add-new": document.getElementById("addNewTab"),
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Remove active from all tabs
      tabs.forEach((t) => t.classList.remove("active"));
      // Hide all tab contents
      Object.values(tabContents).forEach((content) => {
        if (content) content.classList.remove("active");
      });

      // Activate clicked tab
      tab.classList.add("active");
      const tabName = tab.dataset.tab;
      if (tabContents[tabName]) {
        tabContents[tabName].classList.add("active");
      }
    });
  });
}

function updateIdentityUI() {
  const noIdentitySection = document.getElementById("noIdentitySection");
  const identityFingerprint = document.getElementById("identityFingerprint");
  const fingerprintValue = document.getElementById("fingerprintValue");
  const identityUsername = document.getElementById("identityUsername");

  if (currentIdentity) {
    // Hide create identity section
    noIdentitySection?.classList.add("hidden");

    // Show fingerprint card
    identityFingerprint?.classList.remove("hidden");

    // Update username display
    if (identityUsername) {
      const username = currentIdentity.displayName || "@unknown";
      identityUsername.textContent = username.startsWith("@")
        ? username
        : `@${username}`;
    }

    // Update fingerprint display (short 16 char version)
    if (fingerprintValue) {
      fingerprintValue.textContent =
        IdentityManager.getShortFingerprint(currentIdentity);
    }
  } else {
    // Show create identity section
    noIdentitySection?.classList.remove("hidden");

    // Hide fingerprint card
    identityFingerprint?.classList.add("hidden");
  }

  // Re-validate access config after identity state change (silent - no warning shown)
  validateAccessConfig({ showWarning: false });
}

async function createIdentity() {
  const usernameInput = document.getElementById("usernameInput");
  const createBtn = document.getElementById("createIdentityBtn");

  const username = usernameInput?.value.toLowerCase().trim();

  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    showToast("Invalid username (3-20 chars, a-z, 0-9, _) ⚠");
    return;
  }

  createBtn.disabled = true;
  createBtn.innerHTML = '<span><svg class="lucide-icon animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> Creating...';

  try {
    // 1. Generate Identity (using @username as display name)
    const displayName = `@${username}`;
    currentIdentity = await IdentityManager.generateIdentity(displayName);

    // 2. Publish Immediately
    createBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></span> Publishing...';

    const publicIdentity =
      IdentityManager.exportPublicIdentity(currentIdentity);
    const response = await fetch("/pubkey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: currentIdentity.id,
        username: username,
        encryptionPublicKey: publicIdentity.encryptionPublicKey,
        signingPublicKey: publicIdentity.signingPublicKey,
        fingerprint: currentIdentity.fingerprint,
      }),
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Failed to publish");
    }

    // Success
    updateIdentityUI();
    validateAccessConfig();
    showToast(`Identity created & published as @${username} 🚀`);
  } catch (error) {
    console.error("Creation error:", error);
    showToast(error.message || "Failed to create identity ✗");
    // If publishing failed, we might want to delete the local identity to reset state?
    // For now, let's keep it simple. User is likely locally created but not published if that step fails.
    // Ideally we would rollback, but IndexDB rollback is complex here.
  } finally {
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg></span> Create & Publish';
    }
  }
}

// =============================================================================
// Link Overwrite Warning Modal
// =============================================================================

async function searchUserByUsername() {
  const searchInput = document.getElementById("searchUsernameInput");
  const searchResult = document.getElementById("searchResult");
  const searchBtn = document.getElementById("searchUserBtn");
  const btnText = searchBtn?.querySelector(".search-submit-text");
  const btnLoader = searchBtn?.querySelector(".search-submit-loader");

  const username = searchInput?.value.toLowerCase().trim();

  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    if (searchResult)
      searchResult.innerHTML =
        '<div class="search-error">Enter a valid username (3-20 chars)</div>';
    return;
  }

  // Storm off animation - button flies away
  searchBtn?.classList.add("storm-off");
  searchBtn?.classList.remove("visible");

  // Show loading state
  if (searchResult)
    searchResult.innerHTML = '<div class="search-loading">Searching...</div>';

  try {
    const response = await fetch(
      `/pubkey/username/${encodeURIComponent(username)}`
    );

    // Reset storm-off animation
    searchBtn?.classList.remove("storm-off");

    if (!response.ok) {
      if (response.status === 404) {
        searchResult.innerHTML =
          '<div class="search-not-found">User not found</div>';
      } else {
        searchResult.innerHTML =
          '<div class="search-error">Search failed</div>';
      }
      return;
    }

    const userData = await response.json();

    // Clear input on success
    searchInput.value = "";

    // Display search result with add button
    searchResult.innerHTML = `
      <div class="search-result-card">
        <div class="search-result-info">
          <div class="search-result-name">@${escapeHtml(
            userData.username
          )}</div>
          <div class="search-result-fingerprint" title="${escapeHtml(
            userData.fingerprint
          )}">
            <svg class="lucide-icon inline-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg> ${escapeHtml(
              userData.fingerprint.substring(0, 8)
            )}...${escapeHtml(userData.fingerprint.substring(56))}
          </div>
        </div>
        <button class="btn btn-small btn-secondary" id="addSearchResultBtn">
          Add Contact
        </button>
      </div>
    `;

    // Add click handler for the add button
    document
      .getElementById("addSearchResultBtn")
      ?.addEventListener("click", async () => {
        const contact = {
          id: userData.id,
          displayName: `@${userData.username}`,
          encryptionPublicKey: userData.encryptionPublicKey,
          signingPublicKey: userData.signingPublicKey,
          fingerprint: userData.fingerprint,
        };

        try {
          await IdentityManager.addContact(contact);
          loadContacts(onRecipientChange);
          searchResult.innerHTML = ""; // Clear - toast handles feedback
          showToast(`Added @${userData.username} as contact ✓`);
        } catch (error) {
          console.error("Add contact error:", error);
          searchResult.innerHTML =
            '<div class="search-error">Failed to add contact</div>';
        }
      });
  } catch (error) {
    console.error("Search error:", error);
    searchBtn?.classList.remove("storm-off");
    if (searchResult)
      searchResult.innerHTML = '<div class="search-error">Search failed</div>';
  }
}

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

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize identity panel
  await initializeIdentityPanel();

  // Reveal page now that auth state is determined
  document.documentElement.classList.add("auth-resolved");

  loadContacts(onRecipientChange);

  // Initialize custom expiry dropdown
  initializeExpiryDropdown();

  // Initialize file handler with validation callback
  initializeFileHandler((file) => {
    // Immediately validate file against current expiry limit
    const expiryHours = getSelectedExpiryHours();
    const validation = validateFileForExpiry(file, expiryHours);

    if (!validation.valid) {
      showAlert("File Exceeds Size Limit", validation.message, "error");
    }
  });

  // Add dropzone click handler to validate recipients before allowing file selection
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  
  dropZone?.addEventListener("click", (e) => {
    // Check if user has selected any recipients
    const selectedRecipients = getSelectedRecipients();
    if (selectedRecipients.length === 0) {
      e.preventDefault();
      e.stopPropagation();
      // Show the warning
      validateAccessConfig();
      return false;
    }
  });

  // Also block drag-and-drop if no recipients selected
  dropZone?.addEventListener("drop", (e) => {
    const selectedRecipients = getSelectedRecipients();
    if (selectedRecipients.length === 0) {
      e.preventDefault();
      e.stopPropagation();
      // Clear any dragged files
      if (fileInput) fileInput.value = "";
      // Show the warning
      validateAccessConfig();
      return false;
    }
  }, true); // Use capture phase to intercept before file-handler.js

  // Expiry selector change listener (for the hidden native select, synced by custom dropdown)
  const expirySelect = document.getElementById("expirySelect");
  if (expirySelect) {
    expirySelect.addEventListener("change", updateExpiryNotice);
    // Re-validate selected file when expiry changes
    expirySelect.addEventListener("change", validateFileForCurrentExpiry);
  }

  // ==========================================================================
  // Event Listeners (replaces inline onclick handlers for strict CSP)
  // ==========================================================================

  // Alert close button
  document
    .getElementById("alertCloseBtn")
    ?.addEventListener("click", hideAlert);

  // File management - handles both file clearing and upload cancellation
  document.getElementById("clearFileBtn")?.addEventListener("click", () => {
    if (isUploading) {
      cancelUpload();
    } else {
      clearFile();
    }
  });

  // Access configuration checkbox
  document
    .getElementById("enableSigning")
    ?.addEventListener("change", validateAccessConfig);

  // Main upload button
  document.getElementById("uploadBtn")?.addEventListener("click", processFile);

  // Success view buttons
  document.getElementById("copyBtn")?.addEventListener("click", copyLink);
  document.getElementById("backBtn")?.addEventListener("click", resetToUpload);

  // Identity management
  document
    .getElementById("createIdentityBtn")
    ?.addEventListener("click", createIdentity);

  // Fingerprint copy button
  document
    .getElementById("fingerprintCopyBtn")
    ?.addEventListener("click", async () => {
      const copyBtn = document.getElementById("fingerprintCopyBtn");
      if (currentIdentity && copyBtn) {
        try {
          // Copy the full fingerprint
          await navigator.clipboard.writeText(currentIdentity.fingerprint);
          copyBtn.classList.add("copied");
          showToast("Fingerprint copied ✓");
          setTimeout(() => copyBtn.classList.remove("copied"), 1500);
        } catch (e) {
          console.error("Copy failed:", e);
        }
      }
    });

  // User directory search
  document
    .getElementById("searchUserBtn")
    ?.addEventListener("click", searchUserByUsername);

  const searchInput = document.getElementById("searchUsernameInput");
  const searchBtn = document.getElementById("searchUserBtn");

  // Show/hide search button based on input length
  searchInput?.addEventListener("input", (e) => {
    const value = e.target.value.trim();
    const isValid = value.length > 2;
    searchBtn?.classList.toggle("visible", isValid);
  });

  // Search on Enter key
  searchInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchUserByUsername();
  });

  // Local contact filter (filters saved contacts list)
  const filterContactsInput = document.getElementById("filterContactsInput");
  filterContactsInput?.addEventListener("input", (e) => {
    const filterValue = e.target.value.toLowerCase().trim();
    const contactItems = document.querySelectorAll(
      "#contactsList .contact-item"
    );

    contactItems.forEach((item) => {
      const name =
        item.querySelector(".contact-name")?.textContent?.toLowerCase() || "";
      const fingerprint =
        item
          .querySelector(".contact-fingerprint")
          ?.textContent?.toLowerCase() || "";
      const matches =
        name.includes(filterValue) || fingerprint.includes(filterValue);
      item.style.display = matches ? "" : "none";
    });

    // Update "no contacts" message visibility
    const noContacts = document.querySelector("#contactsList .no-contacts");
    const visibleContacts = document.querySelectorAll(
      "#contactsList .contact-item:not([style*='display: none'])"
    );
    if (noContacts) {
      noContacts.textContent =
        visibleContacts.length === 0 && filterValue
          ? "No contacts match filter"
          : "No contacts added yet";
    }
  });

  // Contact management

  // Modal buttons
  document
    .getElementById("modalCloseBtn")
    ?.addEventListener("click", hideOverwriteModal);
  document
    .getElementById("modalCancelBtn")
    ?.addEventListener("click", hideOverwriteModal);
  document
    .getElementById("modalConfirmBtn")
    ?.addEventListener("click", confirmNewUpload);

  // ==========================================================================
  // Mobile Identity Panel Toggle
  // ==========================================================================
  const identityToggle = document.getElementById("identityToggle");
  const identityVaultPanel = document.getElementById("identityVaultPanel");
  const mobileOverlay = document.getElementById("mobileOverlay");

  function openIdentityPanel() {
    identityVaultPanel?.classList.add("mobile-open");
    identityToggle?.classList.add("active");
    mobileOverlay?.classList.add("show");
    document.body.style.overflow = "hidden"; // Prevent scroll when panel open
  }

  function closeIdentityPanel() {
    identityVaultPanel?.classList.remove("mobile-open");
    identityToggle?.classList.remove("active");
    mobileOverlay?.classList.remove("show");
    document.body.style.overflow = ""; // Restore scroll
  }

  // Toggle button click
  identityToggle?.addEventListener("click", () => {
    if (identityVaultPanel?.classList.contains("mobile-open")) {
      closeIdentityPanel();
    } else {
      openIdentityPanel();
    }
  });

  // Overlay click closes panel
  mobileOverlay?.addEventListener("click", closeIdentityPanel);

  // Panel header click closes panel (for the X button on mobile)
  const identityPanelHeader =
    identityVaultPanel?.querySelector(".panel-card-header");
  identityPanelHeader?.addEventListener("click", (e) => {
    // Only close if clicking the X area (right side of header) on mobile
    if (window.innerWidth <= 480) {
      const headerRect = identityPanelHeader.getBoundingClientRect();
      const clickX = e.clientX - headerRect.left;
      // X button is in the right 50px of the header
      if (clickX > headerRect.width - 50) {
        closeIdentityPanel();
      }
    }
  });

  // Escape key closes panel
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      identityVaultPanel?.classList.contains("mobile-open")
    ) {
      closeIdentityPanel();
    }
  });
});

// Expose cancelUpload globally for fullscreen overlay cancel button
window.cancelUpload = function () {
  // Forward to the module's cancelUpload function
  if (typeof cancelUpload === "function") {
    // This will be called from the global scope - need to check isUploading
    const uploadBtn = document.getElementById("uploadBtn");

    // Abort any in-progress fetch request
    if (uploadAbortController) {
      uploadAbortController.abort();
      uploadAbortController = null;
    }

    // Reset upload state
    isUploading = false;

    // Reset UI
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> Encrypt & Upload';
    }

    // Hide progress and reset animation
    hideProgress();
    if (window.encryptionAnimator) {
      window.encryptionAnimator.reset();
    }

    // Clear the file selection
    clearFile();

    // Show feedback to user
    showToast("Upload cancelled ✓");
  }
};

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

  // Validate file size against current expiry limit
  const expiryHours = getSelectedExpiryHours();
  const sizeValidation = validateFileForExpiry(file, expiryHours);
  if (!sizeValidation.valid) {
    showAlert(
      "File Too Large for Selected Expiry",
      sizeValidation.message,
      "error"
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

/**
 * Cancel an in-progress upload.
 * Aborts the fetch request, resets UI state, and clears the file.
 */
function cancelUpload() {
  if (!isUploading) return;

  // Abort any in-progress fetch request
  if (uploadAbortController) {
    uploadAbortController.abort();
    uploadAbortController = null;
  }

  // Reset upload state
  isUploading = false;

  // Reset UI
  const uploadBtn = document.getElementById("uploadBtn");
  if (uploadBtn) {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> Encrypt & Upload';
  }

  // Hide progress and reset animation
  hideProgress();
  if (window.encryptionAnimator) {
    window.encryptionAnimator.reset();
  }

  // Clear the file selection
  clearFile();

  // Show feedback to user
  showToast("Upload cancelled ✓");
}

async function executeUpload() {
  const uploadBtn = document.getElementById("uploadBtn");
  // Secure Share always signs files and never includes key in link
  const includeLinkKey = false;

  const container = document.querySelector(".container[data-state]");
  if (container) {
    container.setAttribute("data-state", "upload");
  }

  const file = getSelectedFile();
  const expiryHours = getSelectedExpiryHours();
  const sizeValidation = validateFileForExpiry(file, expiryHours);

  if (!sizeValidation.valid) {
    showAlert(
      "File Too Large for Selected Expiry",
      sizeValidation.message,
      "error"
    );
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<span><svg class="lucide-icon animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></span> Processing...';
  isUploading = true; // Lock button during upload

  // Create AbortController for cancellation support
  uploadAbortController = new AbortController();

  // Start cinematic encryption animation
  if (window.encryptionAnimator && file) {
    window.encryptionAnimator.startEncryptionSequence(file.name);
  }

  try {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        "Web Crypto API not available. Please use HTTPS or localhost."
      );
    }

    // Streaming uploads require HTTP/2 (HTTPS only)
    // On HTTP, skip directly to buffered to avoid console errors
    const isSecureContext = window.location.protocol === "https:";
    const useStreaming =
      isSecureContext &&
      file.size > STREAMING_THRESHOLD &&
      CryptoModule.supportsStreamingUpload();

    if (useStreaming) {
      try {
        await executeStreamingUpload(file, includeLinkKey);
      } catch (streamError) {
        // Don't fallback if user cancelled
        if (streamError.name === "AbortError") {
          throw streamError;
        }
        console.warn(
          "⚠️ Streaming upload failed, falling back to buffered:",
          streamError.message
        );
        await executeBufferedUpload(file, includeLinkKey);
      }
    } else {
      await executeBufferedUpload(file, includeLinkKey);
    }
  } catch (error) {
    // Don't show error alert if user cancelled
    if (error.name === "AbortError") {
      return; // cancelUpload() already handled the UI reset
    }
    hideProgress();
    showAlert(
      "Encryption Failed",
      error.message || "An unexpected error occurred.",
      "error"
    );
  } finally {
    isUploading = false; // Unlock button state
    uploadAbortController = null; // Clean up controller
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<span><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> Encrypt & Upload';
  }
}

async function executeStreamingUpload(file, includeLinkKey) {
  updateProgress(5, "Generating encryption key...");
  const aesKey = await CryptoModule.generateAESKey();
  const exportedKey = await CryptoModule.exportAESKey(aesKey);

  // Always compute hash for signing (secure page always signs)
  updateProgress(10, "Computing file hash for signature...");
  const originalFileHash = await CryptoModule.hashFile(file, (hashProgress) => {
    const overallProgress = 10 + Math.round(hashProgress * 0.15);
    updateProgress(overallProgress, `Hashing... ${hashProgress}%`);
  });

  updateProgress(25, "Preparing metadata...");
  const metadata = await prepareMetadata(
    file,
    originalFileHash,
    aesKey,
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
    signal: uploadAbortController?.signal,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status}`);
  }

  updateProgress(98, "Finalizing...");
  const serverData = await uploadResponse.json();

  if (!serverData.fileId) {
    throw new Error("Server did not return a file ID.");
  }

  await uploadMetadata(serverData.fileId, metadata);

  updateProgress(100, "Encryption complete!");
  const shareLink = generateShareLink(
    serverData.fileId,
    exportedKey.k,
    includeLinkKey
  );
  showUploadSuccess(
    shareLink,
    includeLinkKey,
    metadata.expiresAt
  );
}

async function executeBufferedUpload(file, includeLinkKey) {
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

  // Always compute hash for signing (secure page always signs)
  updateProgress(50, "Computing file hash for signature...");
  const originalFileHash = await CryptoModule.hashFile(file);

  updateProgress(55, "Preparing metadata...");
  const metadata = await prepareMetadata(
    file,
    originalFileHash,
    aesKey,
    includeLinkKey
  );

  updateProgress(70, "Uploading encrypted file...");
  const formData = new FormData();
  formData.append("encryptedFile", encryptedBlob, "encrypted.bin");

  const uploadResponse = await fetch("/upload", {
    method: "POST",
    body: formData,
    signal: uploadAbortController?.signal,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status}`);
  }

  updateProgress(85, "Upload complete...");
  const serverData = await uploadResponse.json();

  if (!serverData.fileId) {
    throw new Error("Server did not return a file ID.");
  }

  await uploadMetadata(serverData.fileId, metadata);

  updateProgress(100, "Encryption complete!");
  const shareLink = generateShareLink(
    serverData.fileId,
    exportedKey.k,
    includeLinkKey
  );
  showUploadSuccess(
    shareLink,
    includeLinkKey,
    metadata.expiresAt
  );
}

async function prepareMetadata(
  file,
  contentHash,
  aesKey,
  includeLinkKey
) {
  const expiryHours = getSelectedExpiryHours();
  const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;
  const selectedRecipients = getSelectedRecipients();

  const metadata = {
    version: 2,
    // NOTE: filename intentionally omitted - it's encrypted in the file blob header
    // Storing it here would break zero-knowledge architecture
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

  // Always sign on secure page when user has identity
  if (currentIdentity) {
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
      signerDisplayName: currentIdentity.displayName,
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

function showUploadSuccess(
  shareLink,
  includeLinkKey,
  expiresAt
) {
  // Wait for lock animation to complete before showing success view
  // The lock closing animation takes about 1.5 seconds
  setTimeout(() => {
    hideProgress();
    showShareLink(shareLink);

    if (expiresAt) {
      startCountdownTimer(expiresAt);
    }

    // Signing is always enabled on secure page when user has identity
    const enableSigning = !!currentIdentity;

    showUploadStatusBadges(
      includeLinkKey,
      getSelectedRecipients().length,
      enableSigning && currentIdentity
    );
    showShareModeInfo(includeLinkKey, getSelectedRecipients().length);
    showSignatureStatusInfo(enableSigning, currentIdentity);
    updateSecurityWarning(includeLinkKey);
  }, 2000);
}

function showShareModeInfo(hasLinkKey, recipientCount) {
  const infoEl = document.getElementById("shareModeInfo");
  if (!infoEl) return;

  let message = "";
  let icon = "";

  if (hasLinkKey && recipientCount > 0) {
    icon = '<svg class="lucide-icon inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>';
    message = `Hybrid access: Anyone with link can decrypt + ${recipientCount} identity recipient(s)`;
  } else if (hasLinkKey) {
    icon = '<svg class="lucide-icon inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    message = "Link-based access: Anyone with this link can decrypt the file";
  } else if (recipientCount > 0) {
    icon = '<svg class="lucide-icon inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    message = `Identity-only access: Only ${recipientCount} selected recipient(s) can decrypt`;
  } else {
    icon = '<svg class="lucide-icon inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
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
    `<span class="status-badge badge-encrypted"><svg class="lucide-icon inline-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> AES-256-GCM Encrypted</span>`
  );

  if (recipientCount > 0) {
    badges.push(
      `<span class="status-badge badge-identity"><svg class="lucide-icon inline-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${recipientCount} Recipient(s)</span>`
    );
  }

  if (isSigned) {
    badges.push(`<span class="status-badge badge-signed"><svg class="lucide-icon inline-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg> Signed</span>`);
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
        <span class="spw-warning-icon"><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
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
        <span class="spw-success-icon"><svg class="lucide-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg></span>
        <span class="spw-success-text">
          <strong>ENHANCED SECURITY:</strong> Even if the link is intercepted, 
          the file cannot be decrypted without the recipient's private key.
        </span>
      </div>
    `;
  }
}

// =============================================================================
// Global Function Exports (only for dynamically generated HTML)
// =============================================================================
// These remain global because recipients.js generates HTML with onclick handlers
// for dynamically added contact items. The static HTML now uses addEventListener.

window.toggleRecipient = toggleRecipient;
window.removeContactUI = removeContactUI;
