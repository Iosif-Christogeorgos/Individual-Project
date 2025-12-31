// =============================================================================
// CrypShare - Cryptographic Operations Module (ES Module)
// =============================================================================
// This module provides all cryptographic primitives for the hybrid E2EE system.
//
// THREAT MODEL:
// - Server is untrusted (zero-knowledge)
// - All secrets remain client-side
// - AES-256-GCM encrypts file data
// - ECDH (P-256) for key exchange / identity-based access
// - ECDSA (P-256) for digital signatures
// - Link-based access uses key embedded in URL fragment
// =============================================================================

// ===========================================================================
// Constants
// ===========================================================================

const AES_KEY_LENGTH = 256;
export const AES_IV_LENGTH = 12; // 96 bits for AES-GCM
export const CHUNK_SIZE = 64 * 1024; // 64KB chunks for streaming
const ECDH_CURVE = "P-256"; // WebCrypto compatible, ~128-bit security
const ECDSA_CURVE = "P-256";
const FORMAT_VERSION_CHUNKED = 2; // Chunked: [version][filename header][chunks]

// ===========================================================================
// Helpers
// ===========================================================================

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  // Use chunked approach to avoid O(n²) string concatenation
  const CHUNK_SIZE = 0x8000; // 32KB chunks
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    parts.push(String.fromCharCode.apply(null, chunk));
  }
  return btoa(parts.join(''));
}

export function base64ToArrayBuffer(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (e) {
    throw new Error("Invalid base64 encoding. The decryption key may be corrupted.");
  }
}

export function arrayBufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateRandomId(bytes = 16) {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(bytes));
  return arrayBufferToHex(randomBytes);
}

export async function sha256(data) {
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  return arrayBufferToHex(hashBuffer);
}

// ===========================================================================
// AES-256-GCM Operations (Data Encryption)
// ===========================================================================

export async function generateAESKey() {
  return await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export function generateIV() {
  return window.crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
}

export async function exportAESKey(key) {
  return await window.crypto.subtle.exportKey("jwk", key);
}

export async function exportAESKeyRaw(key) {
  return await window.crypto.subtle.exportKey("raw", key);
}

export async function importAESKeyFromJWK(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function importAESKeyFromRaw(rawKey) {
  return await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptAES(data, key, iv) {
  return await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    data
  );
}

export async function decryptAES(ciphertext, key, iv) {
  return await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );
}

// ===========================================================================
// File Encryption (Chunked)
// ===========================================================================

export async function encryptFileChunked(file, aesKey, onProgress = () => {}) {
  const encryptedChunks = [];

  // 1. Version byte
  encryptedChunks.push(new Uint8Array([FORMAT_VERSION_CHUNKED]));

  // 2. Encrypt and store filename
  const filenameBytes = new TextEncoder().encode(file.name);
  const filenameIV = generateIV();
  const encryptedFilename = await encryptAES(
    filenameBytes.buffer,
    aesKey,
    filenameIV
  );
  const encryptedFilenameArray = new Uint8Array(encryptedFilename);

  // Filename header
  const filenameHeader = new Uint8Array(
    2 + 12 + 4 + encryptedFilenameArray.length
  );
  filenameHeader[0] = (filenameBytes.length >> 8) & 0xff;
  filenameHeader[1] = filenameBytes.length & 0xff;
  filenameHeader.set(filenameIV, 2);
  new DataView(filenameHeader.buffer).setUint32(
    14,
    encryptedFilenameArray.length,
    false
  );
  filenameHeader.set(encryptedFilenameArray, 18);
  encryptedChunks.push(filenameHeader);

  // 3. Chunk count
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const chunkCountHeader = new Uint8Array(4);
  new DataView(chunkCountHeader.buffer).setUint32(0, totalChunks, false);
  encryptedChunks.push(chunkCountHeader);

  // 4. Encrypt file chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBlob = file.slice(start, end);
    const chunkData = await chunkBlob.arrayBuffer();

    const iv = generateIV();
    const ciphertext = await encryptAES(chunkData, aesKey, iv);
    const ciphertextArray = new Uint8Array(ciphertext);

    const chunkPacket = new Uint8Array(16 + ciphertextArray.length);
    chunkPacket.set(iv, 0);
    new DataView(chunkPacket.buffer).setUint32(
      12,
      ciphertextArray.length,
      false
    );
    chunkPacket.set(ciphertextArray, 16);

    encryptedChunks.push(chunkPacket);
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  return new Blob(encryptedChunks, { type: "application/octet-stream" });
}

// ===========================================================================
// Streaming Encryption
// ===========================================================================

export async function createEncryptedHeader(file, aesKey, totalChunks) {
  const headerParts = [];

  headerParts.push(new Uint8Array([FORMAT_VERSION_CHUNKED]));

  const filenameBytes = new TextEncoder().encode(file.name);
  const filenameIV = generateIV();
  const encryptedFilename = await encryptAES(
    filenameBytes.buffer,
    aesKey,
    filenameIV
  );
  const encryptedFilenameArray = new Uint8Array(encryptedFilename);

  const filenameHeader = new Uint8Array(
    2 + 12 + 4 + encryptedFilenameArray.length
  );
  filenameHeader[0] = (filenameBytes.length >> 8) & 0xff;
  filenameHeader[1] = filenameBytes.length & 0xff;
  filenameHeader.set(filenameIV, 2);
  new DataView(filenameHeader.buffer).setUint32(
    14,
    encryptedFilenameArray.length,
    false
  );
  filenameHeader.set(encryptedFilenameArray, 18);
  headerParts.push(filenameHeader);

  const chunkCountHeader = new Uint8Array(4);
  new DataView(chunkCountHeader.buffer).setUint32(0, totalChunks, false);
  headerParts.push(chunkCountHeader);

  return headerParts;
}

export async function createEncryptedStream(file, aesKey, onProgress = () => {}) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let chunkIndex = 0;
  let offset = 0;

  const headerParts = await createEncryptedHeader(file, aesKey, totalChunks);
  let headerIndex = 0;
  let headerSent = false;

  const headerSize = headerParts.reduce((sum, part) => sum + part.length, 0);
  const perChunkOverhead = 12 + 4 + 16;
  const totalSize = headerSize + file.size + totalChunks * perChunkOverhead;

  const stream = new ReadableStream({
    async pull(controller) {
      if (!headerSent) {
        if (headerIndex < headerParts.length) {
          controller.enqueue(headerParts[headerIndex]);
          headerIndex++;
          return;
        }
        headerSent = true;
      }

      if (offset >= file.size) {
        controller.close();
        return;
      }

      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(offset, end);
      const chunkData = await chunkBlob.arrayBuffer();

      const iv = generateIV();
      const ciphertext = await encryptAES(chunkData, aesKey, iv);
      const ciphertextArray = new Uint8Array(ciphertext);

      const chunkPacket = new Uint8Array(16 + ciphertextArray.length);
      chunkPacket.set(iv, 0);
      new DataView(chunkPacket.buffer).setUint32(
        12,
        ciphertextArray.length,
        false
      );
      chunkPacket.set(ciphertextArray, 16);

      controller.enqueue(chunkPacket);

      offset = end;
      chunkIndex++;
      onProgress(Math.round((chunkIndex / totalChunks) * 100));
    },
  });

  return { stream, totalSize };
}

export function supportsStreamingUpload() {
  if (typeof ReadableStream === "undefined") return false;
  try {
    new Request("", {
      method: "POST",
      body: new ReadableStream(),
      duplex: "half",
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ===========================================================================
// Decryption
// ===========================================================================

export function detectEncryptionFormat(data) {
  const firstByte = new Uint8Array(data.slice(0, 1))[0];
  if (firstByte === FORMAT_VERSION_CHUNKED) {
    return FORMAT_VERSION_CHUNKED;
  }
  throw new Error("Unknown encryption format.");
}

// Optimized chunked decryption (replaces old implementation)
export async function decryptFileChunked(
  encryptedData,
  aesKey,
  onProgress = () => {}
) {
  let offset = 0;

  // 1. Verify version
  const version = new Uint8Array(encryptedData.slice(0, 1))[0];
  if (version !== FORMAT_VERSION_CHUNKED) {
    throw new Error("Invalid chunked format version");
  }
  offset = 1;

  // 2. Read filename
  const dataView = new DataView(encryptedData);
  offset += 2; // Skip original length storage
  const filenameIV = new Uint8Array(encryptedData.slice(offset, offset + 12));
  offset += 12;

  const filenameCipherLength = dataView.getUint32(offset, false);
  offset += 4;

  const filenameCiphertext = encryptedData.slice(
    offset,
    offset + filenameCipherLength
  );
  offset += filenameCipherLength;

  const decryptedFilenameBuffer = await decryptAES(
    filenameCiphertext,
    aesKey,
    filenameIV
  );
  const filename = new TextDecoder().decode(decryptedFilenameBuffer);

  // 3. Read chunk count
  const totalChunks = dataView.getUint32(offset, false);
  offset += 4;

  // 4. Calculate total size
  let tempOffset = offset;
  let totalDecryptedSize = 0;

  for (let i = 0; i < totalChunks; i++) {
    tempOffset += 12; // Skip IV
    const ciphertextLength = dataView.getUint32(tempOffset, false);
    tempOffset += 4;
    totalDecryptedSize += ciphertextLength - 16;
    tempOffset += ciphertextLength;
  }

  // 5. Decrypt chunks into pre-allocated buffer
  const result = new Uint8Array(totalDecryptedSize);
  let writePosition = 0;

  for (let i = 0; i < totalChunks; i++) {
    const iv = new Uint8Array(encryptedData.slice(offset, offset + 12));
    offset += 12;

    const ciphertextLength = dataView.getUint32(offset, false);
    offset += 4;

    const ciphertext = encryptedData.slice(offset, offset + ciphertextLength);
    offset += ciphertextLength;

    const plaintext = await decryptAES(ciphertext, aesKey, iv);
    const plaintextArray = new Uint8Array(plaintext);

    result.set(plaintextArray, writePosition);
    writePosition += plaintextArray.length;

    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  return { filename, data: result.buffer };
}

export async function downloadAndDecryptStreaming(
  url,
  aesKey,
  onDownloadProgress = () => {},
  onDecryptProgress = () => {}
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const contentLength = parseInt(
    response.headers.get("Content-Length") || "0",
    10
  );
  const reader = response.body.getReader();
  let encryptedData;
  let receivedLength = 0;

  if (contentLength > 0) {
    encryptedData = new Uint8Array(contentLength);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      encryptedData.set(value, receivedLength);
      receivedLength += value.length;
      onDownloadProgress(Math.round((receivedLength / contentLength) * 100));
    }
  } else {
    // No Content-Length header (common with some CDN/proxy configurations)
    // Report progress as bytes received, capped at 99% until complete
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      // Report indeterminate progress - oscillate between 10-90% based on chunks received
      // This gives visual feedback that download is progressing
      const estimatedProgress = Math.min(90, 10 + (chunks.length % 80));
      onDownloadProgress(estimatedProgress);
    }
    encryptedData = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      encryptedData.set(chunk, position);
      position += chunk.length;
    }
  }
  
  // Ensure 100% is reported after download completes
  onDownloadProgress(100);

  const format = detectEncryptionFormat(encryptedData.buffer);
  if (format === FORMAT_VERSION_CHUNKED) {
    return await decryptFileChunked(
      encryptedData.buffer,
      aesKey,
      onDecryptProgress
    );
  } else {
    throw new Error("Unsupported file format");
  }
}

// ===========================================================================
// ECDH Operations (Identity)
// ===========================================================================

export async function generateECDHKeyPair() {
  return await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    ["deriveKey", "deriveBits"]
  );
}

export async function exportECDHPublicKey(publicKey) {
  return await window.crypto.subtle.exportKey("jwk", publicKey);
}

export async function exportECDHPrivateKey(privateKey) {
  return await window.crypto.subtle.exportKey("jwk", privateKey);
}

export async function importECDHPublicKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    []
  );
}

export async function importECDHPrivateKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    ["deriveKey", "deriveBits"]
  );
}

export async function deriveSharedKey(privateKey, publicKey) {
  return await window.crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptKeyForRecipient(fileAESKey, recipientPublicKey) {
  const ephemeralKeyPair = await generateECDHKeyPair();
  const sharedKey = await deriveSharedKey(
    ephemeralKeyPair.privateKey,
    recipientPublicKey
  );
  const rawFileKey = await exportAESKeyRaw(fileAESKey);
  const iv = generateIV();
  const encryptedKeyData = await encryptAES(rawFileKey, sharedKey, iv);
  const ephemeralPublicKeyJWK = await exportECDHPublicKey(
    ephemeralKeyPair.publicKey
  );

  return {
    ephemeralPublicKey: ephemeralPublicKeyJWK,
    encryptedKey: arrayBufferToBase64(encryptedKeyData),
    iv: arrayBufferToBase64(iv),
  };
}

export async function decryptKeyWithPrivateKey(encryptedKeyBundle, ourPrivateKey) {
  const { ephemeralPublicKey, encryptedKey, iv } = encryptedKeyBundle;
  const ephemeralPubKey = await importECDHPublicKey(ephemeralPublicKey);
  const sharedKey = await deriveSharedKey(ourPrivateKey, ephemeralPubKey);
  const ivBytes = base64ToArrayBuffer(iv);
  const encryptedKeyBytes = base64ToArrayBuffer(encryptedKey);
  const rawFileKey = await decryptAES(
    encryptedKeyBytes,
    sharedKey,
    new Uint8Array(ivBytes)
  );
  return await importAESKeyFromRaw(rawFileKey);
}

// ===========================================================================
// ECDSA Operations (Signatures)
// ===========================================================================

export async function generateSigningKeyPair() {
  return await window.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: ECDSA_CURVE },
    true,
    ["sign", "verify"]
  );
}

export async function exportSigningPublicKey(publicKey) {
  return await window.crypto.subtle.exportKey("jwk", publicKey);
}

export async function exportSigningPrivateKey(privateKey) {
  return await window.crypto.subtle.exportKey("jwk", privateKey);
}

export async function importSigningPublicKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: ECDSA_CURVE },
    true,
    ["verify"]
  );
}

export async function importSigningPrivateKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: ECDSA_CURVE },
    true,
    ["sign"]
  );
}

export async function sign(data, privateKey) {
  return await window.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    data
  );
}

export async function verify(data, signature, publicKey) {
  return await window.crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    data
  );
}

export async function signFileMetadata(metadata, signingPrivateKey) {
  const timestamp = new Date().toISOString();
  const dataToSign = JSON.stringify({
    filename: metadata.filename,
    size: metadata.size,
    contentHash: metadata.contentHash,
    timestamp: timestamp,
  });

  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(dataToSign);
  const signature = await sign(dataBytes, signingPrivateKey);

  return {
    signature: arrayBufferToBase64(signature),
    timestamp: timestamp,
    signedData: arrayBufferToBase64(dataBytes),
  };
}

export async function verifyFileMetadataSignature(signatureBundle, signerPublicKey) {
  try {
    const signatureBytes = base64ToArrayBuffer(signatureBundle.signature);
    const signedDataBytes = base64ToArrayBuffer(signatureBundle.signedData);

    const valid = await verify(
      signedDataBytes,
      signatureBytes,
      signerPublicKey
    );

    if (valid) {
      const decoder = new TextDecoder();
      const metadata = JSON.parse(decoder.decode(signedDataBytes));
      return { valid: true, metadata };
    }
    return { valid: false, metadata: null };
  } catch (error) {
    return { valid: false, metadata: null };
  }
}

// ===========================================================================
// Hashing
// ===========================================================================

export async function hashFile(file, onProgress = () => {}) {
  if (file.size <= 100 * 1024 * 1024) {
    const buffer = await file.arrayBuffer();
    onProgress(100);
    return await sha256(buffer);
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const chunkHashes = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const buffer = await chunk.arrayBuffer();

    const chunkHash = await window.crypto.subtle.digest("SHA-256", buffer);
    chunkHashes.push(new Uint8Array(chunkHash));
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  const concatenatedHashes = new Uint8Array(chunkHashes.length * 32);
  for (let i = 0; i < chunkHashes.length; i++) {
    concatenatedHashes.set(chunkHashes[i], i * 32);
  }

  const finalHash = await window.crypto.subtle.digest(
    "SHA-256",
    concatenatedHashes
  );
  return arrayBufferToHex(finalHash);
}

// For verifying decrypted data (which can be memory-resident)
export async function hashDataStreaming(data) {
  if (data.length <= 100 * 1024 * 1024) {
    return await sha256(data.buffer);
  }

  const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
  const chunkHashes = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, data.length);
    const chunkData = data.slice(start, end);

    const chunkHash = await window.crypto.subtle.digest(
      "SHA-256",
      chunkData.buffer.slice(
        chunkData.byteOffset,
        chunkData.byteOffset + chunkData.byteLength
      )
    );
    chunkHashes.push(new Uint8Array(chunkHash));
  }

  const concatenatedHashes = new Uint8Array(chunkHashes.length * 32);
  for (let i = 0; i < chunkHashes.length; i++) {
    concatenatedHashes.set(chunkHashes[i], i * 32);
  }

  const finalHash = await window.crypto.subtle.digest(
    "SHA-256",
    concatenatedHashes
  );
  return arrayBufferToHex(finalHash);
}

// ===========================================================================
// Fingerprints
// ===========================================================================

export async function generateKeyFingerprint(publicKeyJWK) {
  const keyString = JSON.stringify(publicKeyJWK);
  const encoder = new TextEncoder();
  return await sha256(encoder.encode(keyString));
}

export function formatFingerprint(fingerprint) {
  return fingerprint
    .match(/.{1,4}/g)
    .join(" ")
    .toUpperCase();
}

// Default export removed in favor of named imports
