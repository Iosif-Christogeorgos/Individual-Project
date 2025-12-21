// =======================================================================
// DEBUGGING UTILITIES
// =======================================================================
function log(msg, type = "info") {
  const logEl = document.getElementById("debug-log");
  const timestamp = new Date().toLocaleTimeString();
  const prefix =
    {
      info: "📘",
      success: "✅",
      error: "❌",
      warn: "⚠️",
    }[type] || "•";

  const line = `[${timestamp}] ${prefix} ${msg}`;
  logEl.innerHTML += `\n<span class="${type}">${line}</span>`;
  logEl.scrollTop = logEl.scrollHeight; // Auto-scroll
  console.log(`[${type.toUpperCase()}]`, msg);
}

function updateProgress(percent, text) {
  document.getElementById("progress-container").style.display = "block";
  document.getElementById("progress-fill").style.width = percent + "%";
  document.getElementById("progress-text").innerText = text;
}

function showError(title, details) {
  log(`${title}: ${details}`, "error");
  alert(`❌ ERROR: ${title}\n\nDetails: ${details}`);
}

function showShareLink(link) {
  const container = document.getElementById("share-link-container");
  const input = document.getElementById("share-link");
  container.style.display = "block";
  input.value = link;
  input.select();
}

function copyLink() {
  const input = document.getElementById("share-link");
  input.select();
  document.execCommand("copy");
  alert("✅ Link copied to clipboard!");
}

// =======================================================================
// MAIN PROCESS: Encrypt & Upload
// =======================================================================
async function processFile() {
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");

  // Reset UI
  document.getElementById("share-link-container").style.display = "none";
  document.getElementById("debug-log").innerHTML =
    "[ CrypShare Debug Console ]\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

  // Validate file selection
  if (fileInput.files.length === 0) {
    showError("No File Selected", "Please select a file first!");
    return;
  }

  const file = fileInput.files[0];
  uploadBtn.disabled = true;
  uploadBtn.innerText = "⏳ Processing...";

  log(
    `Selected File: "${file.name}" (${(file.size / 1024).toFixed(2)} KB)`,
    "info"
  );

  try {
    // Check for secure context (HTTPS or localhost)
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error(
        "Web Crypto API not available. This app requires HTTPS or localhost. " +
          "You are accessing via: " +
          window.location.origin +
          ". " +
          "Please use 'localhost' instead of an IP address, or set up HTTPS."
      );
    }

    // -----------------------------------------------------------------
    // STEP 1: Generate Encryption Key
    // -----------------------------------------------------------------
    updateProgress(10, "Step 1/5: Generating encryption key...");
    log("Step 1: Generating AES-256-GCM encryption key...", "info");

    const key = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    log("Step 1: ✓ Key generated successfully!", "success");

    // -----------------------------------------------------------------
    // STEP 2: Generate IV (Initialization Vector)
    // -----------------------------------------------------------------
    updateProgress(20, "Step 2/5: Generating IV...");
    log("Step 2: Generating random 12-byte IV...", "info");

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    log("Step 2: ✓ IV generated successfully!", "success");

    // -----------------------------------------------------------------
    // STEP 3: Read File Contents
    // -----------------------------------------------------------------
    updateProgress(30, "Step 3/5: Reading file...");
    log("Step 3: Reading file contents into memory...", "info");

    const fileData = await file.arrayBuffer();
    log(
      `Step 3: ✓ File read complete (${fileData.byteLength} bytes)`,
      "success"
    );

    // -----------------------------------------------------------------
    // STEP 4: Create payload with filename + file data
    // -----------------------------------------------------------------
    updateProgress(40, "Step 4/6: Preparing payload...");
    log("Step 4: Embedding filename in payload...", "info");

    // Encode filename as UTF-8 bytes
    const filenameBytes = new TextEncoder().encode(file.name);
    const filenameLength = filenameBytes.length;

    // Create payload: [2 bytes for filename length] + [filename] + [file data]
    const fileDataArray = new Uint8Array(fileData);
    const payload = new Uint8Array(2 + filenameLength + fileDataArray.length);

    // Store filename length as 2 bytes (supports filenames up to 65535 chars)
    payload[0] = (filenameLength >> 8) & 0xff;
    payload[1] = filenameLength & 0xff;
    payload.set(filenameBytes, 2);
    payload.set(fileDataArray, 2 + filenameLength);

    log(`Step 4: ✓ Payload created with filename "${file.name}"`, "success");

    // -----------------------------------------------------------------
    // STEP 5: Encrypt the payload
    // -----------------------------------------------------------------
    updateProgress(50, "Step 5/6: Encrypting data...");
    log("Step 5: Encrypting payload with AES-GCM...", "info");

    const encryptedData = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      payload
    );
    log(
      `Step 5: ✓ Encryption complete! (${encryptedData.byteLength} bytes)`,
      "success"
    );

    // -----------------------------------------------------------------
    // STEP 6: Export Key for URL Hash
    // -----------------------------------------------------------------
    updateProgress(60, "Step 6/6: Preparing upload...");
    log("Step 6: Exporting key as JWK format...", "info");

    const exportedKey = await window.crypto.subtle.exportKey("jwk", key);
    log("Step 5: ✓ Key exported!", "success");

    // Combine IV + encrypted data for transmission
    // The IV is needed for decryption and is safe to transmit publicly
    const ivArray = Array.from(iv);
    const encryptedArray = new Uint8Array(encryptedData);
    const combined = new Uint8Array(iv.length + encryptedArray.length);
    combined.set(iv);
    combined.set(encryptedArray, iv.length);

    log(
      `Payload prepared: ${combined.length} bytes (IV: ${iv.length}, Data: ${encryptedArray.length})`,
      "info"
    );

    // -----------------------------------------------------------------
    // STEP 6: Upload to Server
    // -----------------------------------------------------------------
    updateProgress(75, "Uploading to server...");
    log("Step 6: Uploading encrypted blob to server...", "info");
    log(`  → Target: POST http://localhost:3000/upload`, "info");

    // Create FormData with the encrypted file
    const formData = new FormData();
    const blob = new Blob([combined], {
      type: "application/octet-stream",
    });
    formData.append("encryptedFile", blob, "encrypted.bin");

    let response;
    try {
      response = await fetch("http://localhost:3000/upload", {
        method: "POST",
        body: formData,
      });
      log(
        `  → Server responded with status: ${response.status} ${response.statusText}`,
        "info"
      );
    } catch (networkError) {
      // Network error (server offline, CORS issue, etc.)
      showError(
        "Network Error - Cannot reach server",
        `The server at http://localhost:3000 is not responding.\n\nPossible causes:\n• Server is not running (run 'node server.js')\n• CORS policy blocking request\n• Firewall blocking port 3000\n\nTechnical: ${networkError.message}`
      );
      uploadBtn.disabled = false;
      uploadBtn.innerText = "🔒 Encrypt & Upload";
      return;
    }

    // Check HTTP status
    if (!response.ok) {
      const errorText = await response.text();
      showError(
        `Server Error (HTTP ${response.status})`,
        `The server returned an error.\n\nResponse body:\n${errorText}`
      );
      uploadBtn.disabled = false;
      uploadBtn.innerText = "🔒 Encrypt & Upload";
      return;
    }

    // -----------------------------------------------------------------
    // STEP 7: Parse and Validate Server Response
    // -----------------------------------------------------------------
    updateProgress(90, "Processing server response...");
    log("Step 7: Parsing server response...", "info");

    let serverData;
    const rawResponse = await response.text();
    log(`  → Raw response: ${rawResponse}`, "info");

    try {
      serverData = JSON.parse(rawResponse);
    } catch (parseError) {
      showError(
        "Invalid Server Response",
        `Server did not return valid JSON.\n\nRaw response:\n${rawResponse}`
      );
      uploadBtn.disabled = false;
      uploadBtn.innerText = "🔒 Encrypt & Upload";
      return;
    }

    // Validate fileId exists
    if (!serverData.fileId) {
      showError(
        "Missing fileId in Response",
        `Server response is missing 'fileId' field.\n\nReceived:\n${JSON.stringify(
          serverData,
          null,
          2
        )}`
      );
      uploadBtn.disabled = false;
      uploadBtn.innerText = "🔒 Encrypt & Upload";
      return;
    }

    log(`Step 7: ✓ Received fileId: "${serverData.fileId}"`, "success");

    // -----------------------------------------------------------------
    // STEP 8: Generate Share Link
    // -----------------------------------------------------------------
    updateProgress(100, "Complete!");
    log("Step 8: Generating share link...", "info");

    // The key goes in the URL hash (#) so it's never sent to the server
    const keyString = exportedKey.k; // The raw key material in base64url
    const shareLink = `${window.location.origin}/download.html?id=${serverData.fileId}#${keyString}`;

    log(`Step 8: ✓ Share link generated!`, "success");
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    log(`🎉 SUCCESS! File encrypted and uploaded!`, "success");
    log(`📎 FileId: ${serverData.fileId}`, "info");
    log(
      `🔑 Key (in URL hash, never sent to server): ${keyString.substring(
        0,
        20
      )}...`,
      "info"
    );

    // Show the link in the UI
    showShareLink(shareLink);
  } catch (err) {
    log(`UNEXPECTED ERROR: ${err.message}`, "error");
    log(`Stack trace: ${err.stack}`, "error");
    showError("Unexpected Error", err.message);
    console.error("Full error object:", err);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerText = "🔒 Encrypt & Upload";
  }
}
