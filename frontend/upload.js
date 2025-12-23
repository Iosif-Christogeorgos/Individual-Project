// =============================================================================
// CrypShare - Upload & Encryption Module
// =============================================================================

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// State tracking for link overwrite warning
let hasActiveLink = false;
let overwriteWarningShown = false;
let linkCopied = false;

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

  // Create terminal-style progress bar
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

  // Mark that we have an active link and reset copy status for this new link
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

      // Mark that the link has been copied
      linkCopied = true;

      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = "<span>📋</span> Copy to Clipboard";
      }, 2000);
    })
    .catch(() => {
      // Fallback for older browsers
      input.select();
      document.execCommand("copy");
      btn.classList.add("copied");
      btn.innerHTML = "<span>✓</span> Copied!";

      // Mark that the link has been copied
      linkCopied = true;

      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = "<span>📋</span> Copy to Clipboard";
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
// Link Overwrite Warning Modal
// =============================================================================

function showOverwriteModal(file) {
  const modal = document.getElementById("linkOverwriteModal");
  const linkPreview = document.getElementById("modalLinkPreview");
  const currentLink = document.getElementById("shareLink").value;

  // Show truncated link preview
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

  // Mark warning as shown so it won't appear again
  overwriteWarningShown = true;

  // Proceed with the upload
  executeUpload();
}

// =============================================================================
// Drag & Drop Handlers
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

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

  // Handle dropped files
  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFileSelect(files[0]);
    }
  });

  // Handle file input change
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });
});

function handleFileSelect(file) {
  hideAlert();

  // Proceed with normal file selection
  proceedWithFileSelect(file);
}

function proceedWithFileSelect(file) {
  const fileSelected = document.getElementById("fileSelected");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    showAlert(
      "File Too Large",
      `Maximum file size is 100MB. Your file is ${formatFileSize(file.size)}.`
    );
    clearFile();
    return;
  }

  // Manually set the file to the input (for cases coming from modal)
  const fileInput = document.getElementById("fileInput");
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;

  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileSelected.classList.add("show");
}

// =============================================================================
// Main Encryption & Upload Process
// =============================================================================

async function processFile() {
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");

  // Reset UI
  hideAlert();

  // Validate file selection first
  if (fileInput.files.length === 0) {
    showAlert(
      "No File Selected",
      "Please select a file to encrypt and upload."
    );
    return;
  }

  // Check if we need to show the overwrite warning
  // Only show once, and skip if user already copied the link
  if (hasActiveLink && !overwriteWarningShown && !linkCopied) {
    showOverwriteModal(fileInput.files[0]);
    return;
  }

  // Proceed with upload
  await executeUpload();
}

async function executeUpload() {
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");

  // Hide previous share container
  document.getElementById("shareContainer").classList.remove("show");

  const file = fileInput.files[0];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    showAlert(
      "File Too Large",
      `Maximum file size is 100MB. Your file is ${formatFileSize(file.size)}.`
    );
    return;
  }

  // Disable button during processing
  uploadBtn.disabled = true;
  uploadBtn.innerHTML = "<span>⏳</span> Processing...";

  try {
    // Check for Web Crypto API (requires HTTPS or localhost)
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        "Web Crypto API not available. Please use HTTPS or localhost."
      );
    }

    // Step 1: Generate encryption key
    updateProgress(10, "Generating encryption key...");
    const key = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );

    // Step 2: Generate IV
    updateProgress(20, "Generating initialization vector...");
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // Step 3: Read file
    updateProgress(30, "Reading file...");
    const fileData = await file.arrayBuffer();

    // Step 4: Create payload with embedded filename
    updateProgress(40, "Preparing payload...");
    const filenameBytes = new TextEncoder().encode(file.name);
    const filenameLength = filenameBytes.length;
    const fileDataArray = new Uint8Array(fileData);
    const payload = new Uint8Array(2 + filenameLength + fileDataArray.length);

    // Store filename length as 2 bytes
    payload[0] = (filenameLength >> 8) & 0xff;
    payload[1] = filenameLength & 0xff;
    payload.set(filenameBytes, 2);
    payload.set(fileDataArray, 2 + filenameLength);

    // Step 5: Encrypt
    updateProgress(55, "Encrypting data...");
    const encryptedData = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      payload
    );

    // Step 6: Export key
    updateProgress(65, "Exporting key...");
    const exportedKey = await window.crypto.subtle.exportKey("jwk", key);

    // Combine IV + encrypted data
    const encryptedArray = new Uint8Array(encryptedData);
    const combined = new Uint8Array(iv.length + encryptedArray.length);
    combined.set(iv);
    combined.set(encryptedArray, iv.length);

    // Step 7: Upload
    updateProgress(75, "Uploading encrypted file...");
    const formData = new FormData();
    const blob = new Blob([combined], { type: "application/octet-stream" });
    formData.append("encryptedFile", blob, "encrypted.bin");

    const response = await fetch("/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText}`
      );
    }

    // Step 8: Process response
    updateProgress(90, "Processing response...");
    const serverData = await response.json();

    if (!serverData.fileId) {
      throw new Error("Server did not return a file ID.");
    }

    // Step 9: Generate share link
    updateProgress(100, "Complete!");
    const keyString = exportedKey.k;
    const shareLink = `${
      window.location.origin
    }/download?id=${encodeURIComponent(serverData.fileId)}#${keyString}`;

    // Show success
    setTimeout(() => {
      hideProgress();
      showShareLink(shareLink);
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
