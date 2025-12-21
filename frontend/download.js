// Helper: Convert base64url to standard base64
function base64urlToBase64(str) {
  // Replace base64url characters with standard base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return base64;
}

async function startDownload() {
  const btn = document.getElementById("btnDownload");
  const status = document.getElementById("status");
  btn.disabled = true;

  try {
    // 1. Get Parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get("id");
    const keyString = window.location.hash.substring(1); // Remove '#'

    console.log("DEBUG - fileId:", fileId);
    console.log("DEBUG - keyString:", keyString);
    console.log("DEBUG - keyString length:", keyString ? keyString.length : 0);

    if (!fileId || !keyString)
      throw new Error("Missing File ID or Key in URL.");

    status.innerText = "1. Fetching encrypted blob...";

    // 2. Download the Encrypted Blob
    const response = await fetch(`/download/${fileId}`);
    if (!response.ok) throw new Error("File not found on server.");
    const encryptedBlob = await response.arrayBuffer();

    console.log("DEBUG - Encrypted blob size:", encryptedBlob.byteLength);
    status.innerText += `\n2. Blob received (${encryptedBlob.byteLength} bytes). Importing key...`;

    // 3. Import the Key
    const jwk = {
      kty: "oct",
      k: keyString,
      alg: "A256GCM",
      ext: true,
    };

    console.log("DEBUG - JWK object:", JSON.stringify(jwk));

    const key = await window.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );

    console.log("DEBUG - Key imported successfully");
    status.innerText += "\n3. Key imported! Decrypting...";

    // 4. Split IV and Data
    const iv = new Uint8Array(encryptedBlob.slice(0, 12));
    const data = encryptedBlob.slice(12);

    console.log("DEBUG - IV (first 12 bytes):", Array.from(iv));
    console.log("DEBUG - Encrypted data size:", data.byteLength);

    // 5. Decrypt
    let decryptedBuffer;
    try {
      decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        data
      );
      console.log(
        "DEBUG - Decryption successful! Decrypted size:",
        decryptedBuffer.byteLength
      );
    } catch (decryptError) {
      console.error("DEBUG - Decryption FAILED:", decryptError);
      throw new Error(
        "Decryption failed: " +
          decryptError.message +
          ". Wrong key or corrupted data."
      );
    }

    // 6. Extract filename from decrypted payload
    const decryptedArray = new Uint8Array(decryptedBuffer);

    // First 2 bytes contain filename length
    const filenameLength = (decryptedArray[0] << 8) | decryptedArray[1];
    console.log("DEBUG - Filename length:", filenameLength);

    // Extract filename
    const filenameBytes = decryptedArray.slice(2, 2 + filenameLength);
    const originalFilename = new TextDecoder().decode(filenameBytes);
    console.log("DEBUG - Original filename:", originalFilename);

    // Extract actual file data
    const fileContent = decryptedArray.slice(2 + filenameLength);
    console.log("DEBUG - File content size:", fileContent.byteLength);

    status.innerText += `\n4. Decrypted! Original file: "${originalFilename}" (${fileContent.byteLength} bytes)`;

    // 7. Trigger Download with original filename
    const blob = new Blob([fileContent]);
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = originalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    status.innerText += "\n✅ Download started!";
    btn.disabled = false;
    btn.innerText = "Download Again";
  } catch (err) {
    console.error("FULL ERROR:", err);
    status.innerText += "\n❌ Error: " + err.message;
    btn.disabled = false;
  }
}
