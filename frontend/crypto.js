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
const AES_IV_LENGTH = 12; // 96 bits for AES-GCM
const CHUNK_SIZE = 64 * 1024; // 64KB chunks for streaming
const ECDH_CURVE = "P-256"; // WebCrypto compatible, ~128-bit security
const ECDSA_CURVE = "P-256";
const FORMAT_VERSION_CHUNKED = 2; // Legacy, decrypt only: chunks not bound to their position
const FORMAT_VERSION_AUTHENTICATED = 3; // Same layout, every ciphertext bound to its position
const CHUNKED_HASH_THRESHOLD = 100 * 1024 * 1024; // Larger files hash per chunk
const PBKDF2_ITERATIONS = 600000; // OWASP recommendation for PBKDF2-HMAC-SHA256
const LEGACY_PBKDF2_ITERATIONS = 100000; // Backups that don't record their iteration count
const MAX_FILENAME_CIPHERTEXT_LENGTH = 0xffff + 16; // 16-bit length plus GCM tag

// ===========================================================================
// Helpers (Internal)
// ===========================================================================

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  // Use chunked approach to avoid O(n²) string concatenation
  const CHUNK = 0x8000; // 32KB chunks
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    parts.push(String.fromCharCode.apply(null, chunk));
  }
  return btoa(parts.join(""));
}

function base64ToArrayBuffer(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    throw new Error(
      "Invalid base64 encoding. The decryption key may be corrupted.",
    );
  }
}

function arrayBufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateRandomId(bytes = 16) {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(bytes));
  return arrayBufferToHex(randomBytes);
}

async function sha256(data) {
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  return arrayBufferToHex(hashBuffer);
}

async function combineChunkHashes(chunkHashes) {
  const concatenatedHashes = new Uint8Array(chunkHashes.length * 32);
  for (let i = 0; i < chunkHashes.length; i++) {
    concatenatedHashes.set(chunkHashes[i], i * 32);
  }
  return await sha256(concatenatedHashes);
}

// Additional authenticated data for format v3. The server can't produce a valid
// ciphertext for a different position or chunk count, so reordering, dropping or
// appending chunks fails decryption.
function buildAAD(label, totalChunks, chunkIndex = 0) {
  const labelBytes = new TextEncoder().encode(label);
  const aad = new Uint8Array(labelBytes.length + 8);
  aad.set(labelBytes, 0);
  const view = new DataView(aad.buffer);
  view.setUint32(labelBytes.length, totalChunks, false);
  view.setUint32(labelBytes.length + 4, chunkIndex, false);
  return aad;
}

function filenameAAD(version, totalChunks) {
  return version === FORMAT_VERSION_AUTHENTICATED
    ? buildAAD("crypshare-v3-filename", totalChunks)
    : undefined;
}

function chunkAAD(version, totalChunks, chunkIndex) {
  return version === FORMAT_VERSION_AUTHENTICATED
    ? buildAAD("crypshare-v3-chunk", totalChunks, chunkIndex)
    : undefined;
}

/**
 * Hash an ArrayBuffer or Uint8Array using SHA-256.
 * Used for post-decryption integrity verification.
 * IMPORTANT: Uses same algorithm as hashFile() - chunked hashing for large files
 * to ensure hash matches between upload and download verification.
 * @param {ArrayBuffer|Uint8Array} data - The data to hash
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
export async function hashArrayBuffer(data) {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  const byteLength = buffer.byteLength;

  // Match the threshold used in hashFile()
  if (byteLength <= CHUNKED_HASH_THRESHOLD) {
    return await sha256(buffer);
  }

  // For large files, use chunked hashing (same algorithm as hashFile)
  // Uses subarray() instead of slice() to avoid memory copies - creates views only
  const totalChunks = Math.ceil(byteLength / CHUNK_SIZE);
  const chunkHashes = [];
  const dataView = new Uint8Array(buffer);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, byteLength);
    // subarray() creates a view (no copy), slice() would copy the data
    const chunk = dataView.subarray(start, end);

    const chunkHash = await window.crypto.subtle.digest("SHA-256", chunk);
    chunkHashes.push(new Uint8Array(chunkHash));
  }

  return await combineChunkHashes(chunkHashes);
}

// ===========================================================================
// AES-256-GCM Operations (Data Encryption)
// ===========================================================================

export async function generateAESKey() {
  return await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
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
    ["encrypt", "decrypt"],
  );
}

export async function importAESKeyFromRaw(rawKey) {
  return await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

function aesGcmParams(iv, aad) {
  return aad
    ? { name: "AES-GCM", iv: iv, additionalData: aad }
    : { name: "AES-GCM", iv: iv };
}

export async function encryptAES(data, key, iv, aad) {
  return await window.crypto.subtle.encrypt(aesGcmParams(iv, aad), key, data);
}

export async function decryptAES(ciphertext, key, iv, aad) {
  return await window.crypto.subtle.decrypt(
    aesGcmParams(iv, aad),
    key,
    ciphertext,
  );
}

// ===========================================================================
// File Encryption (Chunked)
// ===========================================================================

export async function encryptFileChunked(file, aesKey, onProgress = () => {}) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const encryptedChunks = await createEncryptedHeader(
    file,
    aesKey,
    totalChunks,
  );

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    encryptedChunks.push(
      await encryptChunkPacket(
        await file.slice(start, end).arrayBuffer(),
        aesKey,
        i,
        totalChunks,
      ),
    );
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  return new Blob(encryptedChunks, { type: "application/octet-stream" });
}

// Packet layout: [12-byte IV][4-byte ciphertext length][ciphertext + tag]
async function encryptChunkPacket(chunkData, aesKey, chunkIndex, totalChunks) {
  const iv = generateIV();
  const ciphertext = await encryptAES(
    chunkData,
    aesKey,
    iv,
    chunkAAD(FORMAT_VERSION_AUTHENTICATED, totalChunks, chunkIndex),
  );
  const ciphertextArray = new Uint8Array(ciphertext);

  const chunkPacket = new Uint8Array(16 + ciphertextArray.length);
  chunkPacket.set(iv, 0);
  new DataView(chunkPacket.buffer).setUint32(
    12,
    ciphertextArray.length,
    false,
  );
  chunkPacket.set(ciphertextArray, 16);
  return chunkPacket;
}

// ===========================================================================
// Streaming Encryption
// ===========================================================================

export async function createEncryptedHeader(file, aesKey, totalChunks) {
  const headerParts = [];

  headerParts.push(new Uint8Array([FORMAT_VERSION_AUTHENTICATED]));

  const filenameBytes = new TextEncoder().encode(file.name);
  const filenameIV = generateIV();
  const encryptedFilename = await encryptAES(
    filenameBytes.buffer,
    aesKey,
    filenameIV,
    filenameAAD(FORMAT_VERSION_AUTHENTICATED, totalChunks),
  );
  const encryptedFilenameArray = new Uint8Array(encryptedFilename);

  const filenameHeader = new Uint8Array(
    2 + 12 + 4 + encryptedFilenameArray.length,
  );
  filenameHeader[0] = (filenameBytes.length >> 8) & 0xff;
  filenameHeader[1] = filenameBytes.length & 0xff;
  filenameHeader.set(filenameIV, 2);
  new DataView(filenameHeader.buffer).setUint32(
    14,
    encryptedFilenameArray.length,
    false,
  );
  filenameHeader.set(encryptedFilenameArray, 18);
  headerParts.push(filenameHeader);

  const chunkCountHeader = new Uint8Array(4);
  new DataView(chunkCountHeader.buffer).setUint32(0, totalChunks, false);
  headerParts.push(chunkCountHeader);

  return headerParts;
}

export async function createEncryptedStream(
  file,
  aesKey,
  onProgress = () => {},
) {
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
      const chunkData = await file.slice(offset, end).arrayBuffer();

      controller.enqueue(
        await encryptChunkPacket(chunkData, aesKey, chunkIndex, totalChunks),
      );

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
  } catch {
    return false;
  }
}

// ===========================================================================
// Decryption
// ===========================================================================

export function detectEncryptionFormat(data) {
  const firstByte = new Uint8Array(data.slice(0, 1))[0];
  if (
    firstByte === FORMAT_VERSION_CHUNKED ||
    firstByte === FORMAT_VERSION_AUTHENTICATED
  ) {
    return firstByte;
  }
  throw new Error("Unknown encryption format.");
}

// Optimized chunked decryption (replaces old implementation)
export async function decryptFileChunked(
  encryptedData,
  aesKey,
  onProgress = () => {},
) {
  const { version, filename, totalChunks, headerSize } =
    await parseEncryptedHeader(new Uint8Array(encryptedData), aesKey);
  const dataView = new DataView(encryptedData);
  let offset = headerSize;

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

    const plaintext = await decryptAES(
      ciphertext,
      aesKey,
      iv,
      chunkAAD(version, totalChunks, i),
    );
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
  onDecryptProgress = () => {},
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const contentLength = parseInt(
    response.headers.get("Content-Length") || "0",
    10,
  );
  const reader = response.body.getReader();
  let receivedLength = 0;

  // FIXED: Always use chunked collection to avoid buffer overflow
  // when Content-Length header is inaccurate (common with proxies/CDNs)
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedLength += value.length;
    if (contentLength > 0) {
      // Cap at 99% until actually complete to avoid confusing progress > 100%
      const progress = Math.min(
        99,
        Math.round((receivedLength / contentLength) * 100),
      );
      onDownloadProgress(progress);
    } else {
      // Indeterminate progress when no Content-Length
      const estimatedProgress = Math.min(90, 10 + (chunks.length % 80));
      onDownloadProgress(estimatedProgress);
    }
  }

  // Concatenate all chunks
  const encryptedData = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    encryptedData.set(chunk, position);
    position += chunk.length;
  }

  // Ensure 100% is reported after download completes
  onDownloadProgress(100);

  detectEncryptionFormat(encryptedData.buffer);
  return await decryptFileChunked(
    encryptedData.buffer,
    aesKey,
    onDecryptProgress,
  );
}

// ===========================================================================
// True Streaming Decryption (Memory-Efficient)
// ===========================================================================

/**
 * Parse the encrypted file header without buffering the whole file.
 * Returns header info and the offset where chunk data begins.
 * @param {Uint8Array} headerData - At least the first ~1KB of encrypted data
 * @param {CryptoKey} aesKey - The AES key for decrypting the filename
 * @returns {Promise<{version: number, filename: string, totalChunks: number, headerSize: number}>}
 */
async function parseEncryptedHeader(headerData, aesKey) {
  // 1. Verify version
  const version = headerData[0];
  if (
    version !== FORMAT_VERSION_CHUNKED &&
    version !== FORMAT_VERSION_AUTHENTICATED
  ) {
    throw new Error("Invalid chunked format version");
  }
  let offset = 1;

  // 2. Read filename
  const dataView = new DataView(
    headerData.buffer,
    headerData.byteOffset,
    headerData.byteLength,
  );
  offset += 2; // Skip original length storage
  const filenameIV = headerData.slice(offset, offset + 12);
  offset += 12;

  const filenameCipherLength = dataView.getUint32(offset, false);
  offset += 4;

  const filenameCiphertext = headerData.slice(
    offset,
    offset + filenameCipherLength,
  );
  offset += filenameCipherLength;

  // 3. Read chunk count (authenticated along with the filename in v3)
  const totalChunks = dataView.getUint32(offset, false);
  offset += 4;

  const decryptedFilenameBuffer = await decryptAES(
    filenameCiphertext.buffer.slice(
      filenameCiphertext.byteOffset,
      filenameCiphertext.byteOffset + filenameCiphertext.byteLength,
    ),
    aesKey,
    filenameIV,
    filenameAAD(version, totalChunks),
  );
  const filename = new TextDecoder().decode(decryptedFilenameBuffer);

  return { version, filename, totalChunks, headerSize: offset };
}

/**
 * Read just enough of an encrypted file to recover its original filename,
 * then cancel the rest of the download.
 * @param {string} url - URL to download from
 * @param {CryptoKey} aesKey - The AES decryption key
 * @returns {Promise<string>} The original filename
 */
export async function fetchEncryptedFilename(url, aesKey) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const FIXED_HEADER_SIZE = 1 + 2 + 12 + 4; // version, length, IV, cipher length
  const reader = response.body.getReader();
  let received = new Uint8Array(0);
  let needed = FIXED_HEADER_SIZE;

  try {
    while (received.length < needed) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Encrypted file is truncated.");

      const combined = new Uint8Array(received.length + value.length);
      combined.set(received, 0);
      combined.set(value, received.length);
      received = combined;

      if (received.length >= FIXED_HEADER_SIZE) {
        const cipherLength = new DataView(received.buffer).getUint32(
          FIXED_HEADER_SIZE - 4,
          false,
        );
        if (cipherLength > MAX_FILENAME_CIPHERTEXT_LENGTH) {
          throw new Error("Invalid encrypted file header.");
        }
        needed = FIXED_HEADER_SIZE + cipherLength + 4; // plus chunk count
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const { filename } = await parseEncryptedHeader(received, aesKey);
  return filename;
}

/**
 * Streaming decryption that yields decrypted chunks one at a time.
 * This is memory-efficient as it never holds the whole file in RAM.
 *
 * @param {ArrayBuffer} encryptedData - The full encrypted file (for now, will be improved)
 * @param {CryptoKey} aesKey - The AES decryption key
 * @param {function} onProgress - Progress callback (0-100)
 * @yields {{chunk: Uint8Array, filename?: string, isFirst: boolean, isLast: boolean}}
 */
export async function* decryptFileChunkedStreaming(
  encryptedData,
  aesKey,
  onProgress = () => {},
) {
  const data = new Uint8Array(encryptedData);

  // Parse header
  const { version, filename, totalChunks, headerSize } =
    await parseEncryptedHeader(data, aesKey);

  let offset = headerSize;
  const dataView = new DataView(encryptedData);

  for (let i = 0; i < totalChunks; i++) {
    const iv = data.slice(offset, offset + 12);
    offset += 12;

    const ciphertextLength = dataView.getUint32(offset, false);
    offset += 4;

    const ciphertext = encryptedData.slice(offset, offset + ciphertextLength);
    offset += ciphertextLength;

    const plaintext = await decryptAES(
      ciphertext,
      aesKey,
      iv,
      chunkAAD(version, totalChunks, i),
    );
    const plaintextArray = new Uint8Array(plaintext);

    const progress = Math.round(((i + 1) / totalChunks) * 100);
    onProgress(progress);

    yield {
      chunk: plaintextArray,
      filename: i === 0 ? filename : undefined,
      isFirst: i === 0,
      isLast: i === totalChunks - 1,
    };
  }
}

/**
 * Download and decrypt a file using true streaming to a WritableStream.
 * This is the most memory-efficient approach - data flows directly to disk.
 *
 * @param {string} url - URL to download from
 * @param {CryptoKey} aesKey - The AES decryption key
 * @param {WritableStream} writableStream - Destination stream (e.g., from showSaveFilePicker)
 * @param {function} onDownloadProgress - Download progress callback (0-100)
 * @param {function} onDecryptProgress - Decryption progress callback (0-100)
 * @param {string|null} expectedContentHash - Discard the output if the plaintext doesn't match
 * @returns {Promise<{filename: string, bytesWritten: number, contentHash: string}>}
 */
export async function downloadAndDecryptToStream(
  url,
  aesKey,
  writableStream,
  onDownloadProgress = () => {},
  onDecryptProgress = () => {},
  expectedContentHash = null,
) {
  // Step 1: Download the encrypted file
  // NOTE: For true streaming we'd need a different encrypted format that allows
  // reading chunks without knowing total size upfront. For now, we buffer during
  // download but stream during decryption to reduce peak memory.
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const contentLength = parseInt(
    response.headers.get("Content-Length") || "0",
    10,
  );
  const reader = response.body.getReader();
  const chunks = [];
  let receivedLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedLength += value.length;
    if (contentLength > 0) {
      onDownloadProgress(
        Math.min(99, Math.round((receivedLength / contentLength) * 100)),
      );
    }
  }
  onDownloadProgress(100);

  // Concatenate download chunks
  const encryptedData = new Uint8Array(receivedLength);
  let pos = 0;
  for (const chunk of chunks) {
    encryptedData.set(chunk, pos);
    pos += chunk.length;
  }
  // Release download chunks from memory
  chunks.length = 0;

  // Step 2: Stream decrypted chunks to the writable stream
  const writer = writableStream.getWriter();
  let filename = "";
  let bytesWritten = 0;
  let contentHash;
  // Same scheme as hashFile(): small files hash whole, large files per chunk
  const chunkHashes = [];
  let smallFileChunks = [];

  try {
    for await (const {
      chunk,
      filename: fname,
      isFirst,
    } of decryptFileChunkedStreaming(
      encryptedData.buffer,
      aesKey,
      onDecryptProgress,
    )) {
      if (isFirst && fname) {
        filename = fname;
      }
      await writer.write(chunk);
      bytesWritten += chunk.length;

      const chunkHash = await window.crypto.subtle.digest("SHA-256", chunk);
      chunkHashes.push(new Uint8Array(chunkHash));
      if (bytesWritten <= CHUNKED_HASH_THRESHOLD) {
        smallFileChunks.push(chunk);
      } else {
        smallFileChunks = [];
      }
    }

    contentHash =
      bytesWritten <= CHUNKED_HASH_THRESHOLD
        ? await sha256(await new Blob(smallFileChunks).arrayBuffer())
        : await combineChunkHashes(chunkHashes);

    if (expectedContentHash && contentHash !== expectedContentHash) {
      throw new Error(
        "SECURITY ALERT: File integrity check failed. " +
          "The file may have been tampered with. Do not trust this file.",
      );
    }
  } catch (error) {
    // Discard the output: never leave a partial or unverified file on disk
    await writer.abort(error).catch(() => {});
    throw error;
  }

  await writer.close();
  return { filename, bytesWritten, contentHash };
}

// ===========================================================================
// ECDH Operations (Identity)
// ===========================================================================

export async function generateECDHKeyPair() {
  return await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    ["deriveKey", "deriveBits"],
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
    [],
  );
}

export async function importECDHPrivateKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: ECDH_CURVE },
    true,
    ["deriveKey", "deriveBits"],
  );
}

export async function deriveSharedKey(privateKey, publicKey) {
  return await window.crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptKeyForRecipient(fileAESKey, recipientPublicKey) {
  const ephemeralKeyPair = await generateECDHKeyPair();
  const sharedKey = await deriveSharedKey(
    ephemeralKeyPair.privateKey,
    recipientPublicKey,
  );
  const rawFileKey = await exportAESKeyRaw(fileAESKey);
  const iv = generateIV();
  const encryptedKeyData = await encryptAES(rawFileKey, sharedKey, iv);
  const ephemeralPublicKeyJWK = await exportECDHPublicKey(
    ephemeralKeyPair.publicKey,
  );

  return {
    ephemeralPublicKey: ephemeralPublicKeyJWK,
    encryptedKey: arrayBufferToBase64(encryptedKeyData),
    iv: arrayBufferToBase64(iv),
  };
}

export async function decryptKeyWithPrivateKey(
  encryptedKeyBundle,
  ourPrivateKey,
) {
  const { ephemeralPublicKey, encryptedKey, iv } = encryptedKeyBundle;
  const ephemeralPubKey = await importECDHPublicKey(ephemeralPublicKey);
  const sharedKey = await deriveSharedKey(ourPrivateKey, ephemeralPubKey);
  const ivBytes = base64ToArrayBuffer(iv);
  const encryptedKeyBytes = base64ToArrayBuffer(encryptedKey);
  const rawFileKey = await decryptAES(
    encryptedKeyBytes,
    sharedKey,
    new Uint8Array(ivBytes),
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
    ["sign", "verify"],
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
    ["verify"],
  );
}

export async function importSigningPrivateKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: ECDSA_CURVE },
    true,
    ["sign"],
  );
}

export async function sign(data, privateKey) {
  return await window.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    data,
  );
}

export async function verify(data, signature, publicKey) {
  return await window.crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    data,
  );
}

export async function signFileMetadata(metadata, signingPrivateKey) {
  const timestamp = new Date().toISOString();

  // Hash the filename to avoid storing plaintext in the signature bundle
  // This maintains zero-knowledge while still allowing verification that
  // the file wasn't tampered with (since we sign the hash)
  const encoder = new TextEncoder();
  const filenameHashBuffer = await window.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(metadata.filename),
  );
  const filenameHash = arrayBufferToHex(filenameHashBuffer);

  const dataToSign = JSON.stringify({
    filenameHash: filenameHash, // Hash instead of plaintext filename
    size: metadata.size,
    contentHash: metadata.contentHash,
    timestamp: timestamp,
  });

  const dataBytes = encoder.encode(dataToSign);
  const signature = await sign(dataBytes, signingPrivateKey);

  return {
    signature: arrayBufferToBase64(signature),
    timestamp: timestamp,
    signedData: arrayBufferToBase64(dataBytes),
  };
}

export async function verifyFileMetadataSignature(
  signatureBundle,
  signerPublicKey,
) {
  try {
    const signatureBytes = base64ToArrayBuffer(signatureBundle.signature);
    const signedDataBytes = base64ToArrayBuffer(signatureBundle.signedData);

    const valid = await verify(
      signedDataBytes,
      signatureBytes,
      signerPublicKey,
    );

    if (valid) {
      const decoder = new TextDecoder();
      const metadata = JSON.parse(decoder.decode(signedDataBytes));
      return { valid: true, metadata };
    }
    return { valid: false, metadata: null };
  } catch {
    return { valid: false, metadata: null };
  }
}

/**
 * Check that a verified signature actually covers this file. A valid signature
 * alone proves nothing: it could be copied from any other file.
 * @param {Object} signedMetadata - The metadata returned by verifyFileMetadataSignature
 * @param {{filename: string, size: number, contentHash: string}} file - The decrypted file
 * @returns {Promise<boolean>} True if the signed values match the file
 */
export async function signedMetadataMatchesFile(signedMetadata, file) {
  const filenameHash = await sha256(new TextEncoder().encode(file.filename));
  return (
    signedMetadata?.filenameHash === filenameHash &&
    signedMetadata?.size === file.size &&
    signedMetadata?.contentHash === file.contentHash
  );
}

// ===========================================================================
// Hashing
// ===========================================================================

export async function hashFile(file, onProgress = () => {}) {
  if (file.size <= CHUNKED_HASH_THRESHOLD) {
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

  return await combineChunkHashes(chunkHashes);
}

// ===========================================================================
// Fingerprints
// ===========================================================================

export async function generateKeyFingerprint(publicKeyJWK) {
  // CRITICAL: Use canonical JSON (sorted keys) to match server-side computation
  // Without sorted keys, the same JWK can produce different fingerprints
  // depending on property insertion order, causing "identity not authorized" errors
  const sortedKeys = Object.keys(publicKeyJWK).sort();
  const canonical = JSON.stringify(publicKeyJWK, sortedKeys);
  const encoder = new TextEncoder();
  return await sha256(encoder.encode(canonical));
}

export function formatFingerprint(fingerprint) {
  return fingerprint
    .match(/.{1,4}/g)
    .join(" ")
    .toUpperCase();
}

// ===========================================================================
// Identity Backup Encryption (Password-Based)
// ===========================================================================
// These functions enable secure client-side backup of identity keys.
// The backup file is encrypted with a user-provided password using PBKDF2 + AES-GCM.
// This maintains zero-knowledge: the server never sees the keys or password.
// ===========================================================================

/**
 * Derives a cryptographic key from a user password using PBKDF2.
 *
 * @param {string} password - User-provided backup password
 * @param {Uint8Array} salt - Random salt (16 bytes recommended)
 * @param {number} iterations - PBKDF2 iteration count
 * @returns {Promise<CryptoKey>} AES-GCM key derived from password
 */
async function deriveKeyFromPassword(password, salt, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // Not extractable
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts an object (identity data) with a user-provided password.
 * Returns a portable JSON structure containing salt, IV, and encrypted data.
 *
 * @param {Object} dataObj - The data to encrypt (identity, contacts, etc.)
 * @param {string} password - User-provided backup password
 * @returns {Promise<Object>} Encrypted backup package { salt, iv, iterations, data }
 */
export async function encryptBackup(dataObj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveKeyFromPassword(password, salt, PBKDF2_ITERATIONS);
  const encodedData = new TextEncoder().encode(JSON.stringify(dataObj));

  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encodedData,
  );

  // Return portable JSON format (arrays instead of Uint8Arrays for JSON serialization)
  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    iterations: PBKDF2_ITERATIONS,
    data: Array.from(new Uint8Array(encryptedContent)),
  };
}

/**
 * Decrypts a backup package using the user's password.
 * Throws descriptive error if password is wrong or file is corrupted.
 *
 * @param {Object} backupObj - The encrypted backup { salt, iv, iterations?, data }
 * @param {string} password - User-provided backup password
 * @returns {Promise<Object>} The decrypted identity data
 * @throws {Error} If password is incorrect or backup is corrupted
 */
export async function decryptBackup(backupObj, password) {
  const salt = new Uint8Array(backupObj.salt);
  const iv = new Uint8Array(backupObj.iv);
  const data = new Uint8Array(backupObj.data);
  const iterations = backupObj.iterations ?? LEGACY_PBKDF2_ITERATIONS;

  // Bounded so a crafted backup file can't lock up the tab
  if (
    !Number.isInteger(iterations) ||
    iterations < LEGACY_PBKDF2_ITERATIONS ||
    iterations > PBKDF2_ITERATIONS * 10
  ) {
    throw new Error("Incorrect password or corrupted backup file.");
  }

  const key = await deriveKeyFromPassword(password, salt, iterations);

  try {
    const decryptedContent = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data,
    );
    return JSON.parse(new TextDecoder().decode(decryptedContent));
  } catch {
    // AES-GCM authentication failure means wrong password or corrupted data
    throw new Error("Incorrect password or corrupted backup file.");
  }
}

// Default export removed in favor of named imports
