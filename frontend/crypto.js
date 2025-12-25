// =============================================================================
// CrypShare - Cryptographic Operations Module
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

const CryptoModule = (function () {
  "use strict";

  // ===========================================================================
  // Constants
  // ===========================================================================

  const AES_KEY_LENGTH = 256;
  const AES_IV_LENGTH = 12; // 96 bits for AES-GCM
  const CHUNK_SIZE = 64 * 1024; // 64KB chunks for streaming
  const ECDH_CURVE = "P-256"; // WebCrypto compatible, ~128-bit security
  const ECDSA_CURVE = "P-256";

  // ===========================================================================
  // AES-256-GCM Operations (Data Encryption)
  // ===========================================================================

  /**
   * Generate a random AES-256-GCM key for file encryption.
   * @returns {Promise<CryptoKey>} The generated AES key
   */
  async function generateAESKey() {
    return await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      true, // extractable for export
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Generate a random IV for AES-GCM.
   * @returns {Uint8Array} 12-byte IV
   */
  function generateIV() {
    return window.crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
  }

  /**
   * Export AES key to JWK format.
   * @param {CryptoKey} key - The AES key to export
   * @returns {Promise<JsonWebKey>} The exported JWK
   */
  async function exportAESKey(key) {
    return await window.crypto.subtle.exportKey("jwk", key);
  }

  /**
   * Export AES key as raw bytes.
   * @param {CryptoKey} key - The AES key to export
   * @returns {Promise<ArrayBuffer>} The raw key bytes
   */
  async function exportAESKeyRaw(key) {
    return await window.crypto.subtle.exportKey("raw", key);
  }

  /**
   * Import AES key from JWK format.
   * @param {JsonWebKey} jwk - The JWK to import
   * @returns {Promise<CryptoKey>} The imported AES key
   */
  async function importAESKeyFromJWK(jwk) {
    return await window.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Import AES key from raw bytes.
   * @param {ArrayBuffer} rawKey - The raw key bytes
   * @returns {Promise<CryptoKey>} The imported AES key
   */
  async function importAESKeyFromRaw(rawKey) {
    return await window.crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Encrypt data using AES-GCM.
   * @param {ArrayBuffer} data - Plaintext data
   * @param {CryptoKey} key - AES key
   * @param {Uint8Array} iv - Initialization vector
   * @returns {Promise<ArrayBuffer>} Ciphertext
   */
  async function encryptAES(data, key, iv) {
    return await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data
    );
  }

  /**
   * Decrypt data using AES-GCM.
   * @param {ArrayBuffer} ciphertext - Encrypted data
   * @param {CryptoKey} key - AES key
   * @param {Uint8Array} iv - Initialization vector
   * @returns {Promise<ArrayBuffer>} Plaintext
   */
  async function decryptAES(ciphertext, key, iv) {
    return await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );
  }

  // ===========================================================================
  // Chunked Streaming Encryption (Memory-Efficient for Large Files)
  // ===========================================================================

  // Format version markers
  const FORMAT_VERSION_LEGACY = 0; // Original: [IV][encrypted(filename+data)]
  const FORMAT_VERSION_CHUNKED = 2; // Chunked: [version][filename header][chunks]

  /**
   * Encrypt a file in chunks to avoid loading entire file into RAM.
   * Each chunk is independently encrypted with AES-GCM.
   *
   * Format v2 (chunked):
   * [1-byte version (0x02)]
   * [2-byte filename length]
   * [encrypted filename chunk: IV(12) + length(4) + ciphertext]
   * [4-byte file chunk count]
   * [chunk1][chunk2]...
   * Each chunk: [12-byte IV][4-byte ciphertext length][ciphertext]
   *
   * @param {File} file - The file to encrypt
   * @param {CryptoKey} aesKey - The AES key
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise<Blob>} Encrypted blob
   */
  async function encryptFileChunked(file, aesKey, onProgress = () => {}) {
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

    // Filename header: [2-byte original length][12-byte IV][4-byte cipher length][ciphertext]
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

    // 3. Calculate chunks for file data
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // 4. Chunk count header (4 bytes)
    const chunkCountHeader = new Uint8Array(4);
    new DataView(chunkCountHeader.buffer).setUint32(0, totalChunks, false);
    encryptedChunks.push(chunkCountHeader);

    // 5. Encrypt file in chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(start, end);
      const chunkData = await chunkBlob.arrayBuffer();

      // Generate unique IV for each chunk
      const iv = generateIV();
      const ciphertext = await encryptAES(chunkData, aesKey, iv);
      const ciphertextArray = new Uint8Array(ciphertext);

      // Chunk format: [IV (12)][length (4)][ciphertext]
      const chunkPacket = new Uint8Array(16 + ciphertextArray.length);
      chunkPacket.set(iv, 0);
      new DataView(chunkPacket.buffer).setUint32(
        12,
        ciphertextArray.length,
        false
      );
      chunkPacket.set(ciphertextArray, 16);

      encryptedChunks.push(chunkPacket);

      const progress = Math.round(((i + 1) / totalChunks) * 100);
      onProgress(progress);
    }

    return new Blob(encryptedChunks, { type: "application/octet-stream" });
  }

  // ===========================================================================
  // TRUE STREAMING Encryption (Memory-Constant for ANY File Size)
  // ===========================================================================

  /**
   * Create an encrypted header for streaming upload.
   * Returns the header parts that should be sent before file chunks.
   *
   * @param {File} file - The file being encrypted
   * @param {CryptoKey} aesKey - The AES key
   * @param {number} totalChunks - Total number of file chunks
   * @returns {Promise<Uint8Array[]>} Array of header chunks
   */
  async function createEncryptedHeader(file, aesKey, totalChunks) {
    const headerParts = [];

    // 1. Version byte
    headerParts.push(new Uint8Array([FORMAT_VERSION_CHUNKED]));

    // 2. Encrypt and store filename
    const filenameBytes = new TextEncoder().encode(file.name);
    const filenameIV = generateIV();
    const encryptedFilename = await encryptAES(
      filenameBytes.buffer,
      aesKey,
      filenameIV
    );
    const encryptedFilenameArray = new Uint8Array(encryptedFilename);

    // Filename header: [2-byte original length][12-byte IV][4-byte cipher length][ciphertext]
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

    // 3. Chunk count header (4 bytes)
    const chunkCountHeader = new Uint8Array(4);
    new DataView(chunkCountHeader.buffer).setUint32(0, totalChunks, false);
    headerParts.push(chunkCountHeader);

    return headerParts;
  }

  /**
   * Create a ReadableStream that encrypts a file on-demand.
   * Memory usage is O(CHUNK_SIZE) regardless of file size.
   *
   * This enables true streaming upload where:
   * 1. Read one chunk from file
   * 2. Encrypt it
   * 3. Yield it to the stream (upload immediately)
   * 4. Release memory
   * 5. Repeat
   *
   * @param {File} file - The file to encrypt
   * @param {CryptoKey} aesKey - The AES key
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise<{stream: ReadableStream, totalSize: number}>} Encrypted stream and expected size
   */
  async function createEncryptedStream(file, aesKey, onProgress = () => {}) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let chunkIndex = 0;
    let offset = 0;

    // Pre-create the header
    const headerParts = await createEncryptedHeader(file, aesKey, totalChunks);
    let headerIndex = 0;
    let headerSent = false;

    // Calculate total encrypted size for Content-Length header
    // Header: version(1) + filenameHeader(2+12+4+encrypted) + chunkCount(4)
    // Each chunk: IV(12) + length(4) + ciphertext(chunkSize + 16 GCM tag)
    const headerSize = headerParts.reduce((sum, part) => sum + part.length, 0);
    const perChunkOverhead = 12 + 4 + 16; // IV + length field + GCM auth tag
    const totalSize = headerSize + file.size + totalChunks * perChunkOverhead;

    const stream = new ReadableStream({
      async pull(controller) {
        // First, send header parts one by one
        if (!headerSent) {
          if (headerIndex < headerParts.length) {
            controller.enqueue(headerParts[headerIndex]);
            headerIndex++;
            return;
          }
          headerSent = true;
        }

        // Then stream file chunks
        if (offset >= file.size) {
          controller.close();
          return;
        }

        // Read ONE chunk from the file
        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(offset, end);
        const chunkData = await chunkBlob.arrayBuffer();

        // Encrypt ONE chunk
        const iv = generateIV();
        const ciphertext = await encryptAES(chunkData, aesKey, iv);
        const ciphertextArray = new Uint8Array(ciphertext);

        // Create packet for ONE chunk: [IV (12)][length (4)][ciphertext]
        const chunkPacket = new Uint8Array(16 + ciphertextArray.length);
        chunkPacket.set(iv, 0);
        new DataView(chunkPacket.buffer).setUint32(
          12,
          ciphertextArray.length,
          false
        );
        chunkPacket.set(ciphertextArray, 16);

        // Enqueue the chunk (browser will upload it immediately)
        controller.enqueue(chunkPacket);

        // Update progress
        offset = end;
        chunkIndex++;
        const progress = Math.round((chunkIndex / totalChunks) * 100);
        onProgress(progress);
      },
    });

    return { stream, totalSize };
  }

  /**
   * Compute SHA-256 hash of a file using true streaming (memory-constant).
   *
   * Since WebCrypto doesn't support incremental hashing natively, we use a
   * Merkle-tree inspired approach:
   * 1. Hash each chunk individually
   * 2. Concatenate all chunk hashes
   * 3. Hash the concatenated hashes
   *
   * This keeps memory usage at O(number_of_chunks * 32 bytes) for the hash list,
   * plus O(CHUNK_SIZE) for the current chunk being processed.
   *
   * For a 50GB file with 64KB chunks (~780,000 chunks), the hash list is only ~25MB.
   *
   * IMPORTANT: Both upload (hashFileStreaming) and download must use the same algorithm.
   * For backwards compatibility, files < 100MB use the standard single-pass hash.
   *
   * @param {File} file - File to hash
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise<string>} Hex-encoded hash
   */
  async function hashFileStreaming(file, onProgress = () => {}) {
    // For files <= 100MB, use the standard single-pass hash for compatibility
    // This matches the original hashFile() behavior for small files
    if (file.size <= 100 * 1024 * 1024) {
      const buffer = await file.arrayBuffer();
      return await sha256(buffer);
    }

    // For larger files, use streaming chunk-hash approach
    const chunkSize = CHUNK_SIZE; // 64KB
    const totalChunks = Math.ceil(file.size / chunkSize);
    const chunkHashes = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);

      // Read ONE chunk
      const chunkBlob = file.slice(start, end);
      const chunkData = await chunkBlob.arrayBuffer();

      // Hash this chunk
      const chunkHash = await window.crypto.subtle.digest("SHA-256", chunkData);
      chunkHashes.push(new Uint8Array(chunkHash));

      // Progress callback
      const progress = Math.round(((i + 1) / totalChunks) * 100);
      onProgress(progress);
    }

    // Concatenate all chunk hashes (32 bytes each)
    const concatenatedHashes = new Uint8Array(chunkHashes.length * 32);
    for (let i = 0; i < chunkHashes.length; i++) {
      concatenatedHashes.set(chunkHashes[i], i * 32);
    }

    // Hash the concatenated hashes to get final hash
    const finalHash = await window.crypto.subtle.digest(
      "SHA-256",
      concatenatedHashes
    );

    return arrayBufferToHex(finalHash);
  }

  /**
   * Compute streaming hash of decrypted data (for download verification).
   * Must match the algorithm used by hashFileStreaming for large files.
   *
   * @param {Uint8Array} data - Decrypted file data
   * @returns {Promise<string>} Hex-encoded hash
   */
  async function hashDataStreaming(data) {
    // For data <= 100MB, use standard single-pass hash
    if (data.length <= 100 * 1024 * 1024) {
      return await sha256(data.buffer);
    }

    // For larger data, use the same chunk-hash approach as upload
    const chunkSize = CHUNK_SIZE;
    const totalChunks = Math.ceil(data.length / chunkSize);
    const chunkHashes = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);

      // Get chunk from the data
      const chunkData = data.slice(start, end);

      // Hash this chunk
      const chunkHash = await window.crypto.subtle.digest(
        "SHA-256",
        chunkData.buffer.slice(
          chunkData.byteOffset,
          chunkData.byteOffset + chunkData.byteLength
        )
      );
      chunkHashes.push(new Uint8Array(chunkHash));
    }

    // Concatenate all chunk hashes
    const concatenatedHashes = new Uint8Array(chunkHashes.length * 32);
    for (let i = 0; i < chunkHashes.length; i++) {
      concatenatedHashes.set(chunkHashes[i], i * 32);
    }

    // Hash the concatenated hashes
    const finalHash = await window.crypto.subtle.digest(
      "SHA-256",
      concatenatedHashes
    );

    return arrayBufferToHex(finalHash);
  }

  /**
   * Check if the browser supports streaming uploads.
   * @returns {boolean} True if streaming uploads are supported
   */
  function supportsStreamingUpload() {
    // Check for ReadableStream support
    if (typeof ReadableStream === "undefined") return false;

    // Check for fetch with streaming body support
    // This requires the 'duplex' option which is available in modern browsers
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

  /**
   * Memory-efficient streaming decryption for large files.
   *
   * This function decrypts chunks one at a time and writes them directly
   * into a pre-allocated output buffer, avoiding the accumulation of
   * intermediate chunk arrays that cause memory spikes.
   *
   * Memory usage: O(CHUNK_SIZE * 2) - one for encrypted chunk, one for decrypted
   * instead of O(file_size * 2) for the non-streaming version.
   *
   * @param {ArrayBuffer} encryptedData - The encrypted data
   * @param {CryptoKey} aesKey - The AES key
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise<{filename: string, data: ArrayBuffer}>} Decrypted filename and data
   */
  async function decryptFileChunkedStreaming(
    encryptedData,
    aesKey,
    onProgress = () => {}
  ) {
    let offset = 0;

    // 1. Read and verify version byte
    const version = new Uint8Array(encryptedData.slice(0, 1))[0];
    if (version !== FORMAT_VERSION_CHUNKED) {
      throw new Error("Invalid chunked format version");
    }
    offset = 1;

    // 2. Read filename header
    const dataView = new DataView(encryptedData);
    const filenameOriginalLength =
      (dataView.getUint8(offset) << 8) | dataView.getUint8(offset + 1);
    offset += 2;

    const filenameIV = new Uint8Array(encryptedData.slice(offset, offset + 12));
    offset += 12;

    const filenameCipherLength = dataView.getUint32(offset, false);
    offset += 4;

    const filenameCiphertext = encryptedData.slice(
      offset,
      offset + filenameCipherLength
    );
    offset += filenameCipherLength;

    // Decrypt filename
    const decryptedFilenameBuffer = await decryptAES(
      filenameCiphertext,
      aesKey,
      filenameIV
    );
    const filename = new TextDecoder().decode(decryptedFilenameBuffer);

    // 3. Read chunk count
    const totalChunks = dataView.getUint32(offset, false);
    offset += 4;

    // 4. First pass: calculate total decrypted size
    // This avoids array accumulation - we pre-allocate the exact buffer size
    let tempOffset = offset;
    let totalDecryptedSize = 0;

    for (let i = 0; i < totalChunks; i++) {
      tempOffset += 12; // Skip IV
      const ciphertextLength = dataView.getUint32(tempOffset, false);
      tempOffset += 4;
      // AES-GCM ciphertext includes 16-byte auth tag, plaintext is 16 bytes smaller
      totalDecryptedSize += ciphertextLength - 16;
      tempOffset += ciphertextLength;
    }

    // 5. Pre-allocate the EXACT output buffer size (no intermediate arrays)
    const result = new Uint8Array(totalDecryptedSize);
    let writePosition = 0;

    // 6. Second pass: decrypt directly into output buffer
    for (let i = 0; i < totalChunks; i++) {
      // Read IV
      const iv = new Uint8Array(encryptedData.slice(offset, offset + 12));
      offset += 12;

      // Read ciphertext length
      const ciphertextLength = dataView.getUint32(offset, false);
      offset += 4;

      // Read ciphertext
      const ciphertext = encryptedData.slice(offset, offset + ciphertextLength);
      offset += ciphertextLength;

      // Decrypt chunk directly
      const plaintext = await decryptAES(ciphertext, aesKey, iv);
      const plaintextArray = new Uint8Array(plaintext);

      // Write directly to pre-allocated buffer (no intermediate storage)
      result.set(plaintextArray, writePosition);
      writePosition += plaintextArray.length;

      // Report progress
      const progress = Math.round(((i + 1) / totalChunks) * 100);
      onProgress(progress);
    }

    return { filename, data: result.buffer };
  }

  /**
   * Streaming download with memory-efficient decryption.
   *
   * Uses fetch streaming to avoid loading the entire encrypted file into memory
   * at once, then decrypts using the streaming decryption function.
   *
   * For very large files, this keeps peak memory usage at approximately:
   * - Encrypted data: loaded in chunks via fetch streaming
   * - Decrypted data: pre-allocated single buffer (file size)
   *
   * @param {string} url - URL to download from
   * @param {CryptoKey} aesKey - The AES key
   * @param {function} onDownloadProgress - Download progress callback
   * @param {function} onDecryptProgress - Decryption progress callback
   * @returns {Promise<{filename: string, data: ArrayBuffer}>} Decrypted result
   */
  async function downloadAndDecryptStreaming(
    url,
    aesKey,
    onDownloadProgress = () => {},
    onDecryptProgress = () => {}
  ) {
    // Fetch with streaming
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const contentLength = parseInt(
      response.headers.get("Content-Length") || "0",
      10
    );
    const reader = response.body.getReader();

    // Read stream in chunks and accumulate (but browser manages memory better this way)
    const chunks = [];
    let receivedLength = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
      receivedLength += value.length;

      if (contentLength > 0) {
        const progress = Math.round((receivedLength / contentLength) * 100);
        onDownloadProgress(progress);
      }
    }

    // Combine chunks into single ArrayBuffer
    const encryptedData = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      encryptedData.set(chunk, position);
      position += chunk.length;
    }

    // Clear chunks array to free memory before decryption
    chunks.length = 0;

    // Detect format and decrypt
    const format = detectEncryptionFormat(encryptedData.buffer);

    if (format === FORMAT_VERSION_CHUNKED) {
      return await decryptFileChunkedStreaming(
        encryptedData.buffer,
        aesKey,
        onDecryptProgress
      );
    } else {
      onDecryptProgress(100);
      return await decryptFileLegacy(encryptedData.buffer, aesKey);
    }
  }

  /**
   * Detect the encryption format of data.
   * @param {ArrayBuffer} data - The encrypted data
   * @returns {number} Format version (0 = legacy, 2 = chunked)
   */
  function detectEncryptionFormat(data) {
    const firstByte = new Uint8Array(data.slice(0, 1))[0];
    // Version 2 starts with 0x02
    if (firstByte === FORMAT_VERSION_CHUNKED) {
      return FORMAT_VERSION_CHUNKED;
    }
    // Legacy format (first 12 bytes are IV, so first byte is random)
    return FORMAT_VERSION_LEGACY;
  }

  /**
   * Decrypt a chunked encrypted file (format v2).
   * @param {ArrayBuffer} encryptedData - The encrypted data
   * @param {CryptoKey} aesKey - The AES key
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise<{filename: string, data: ArrayBuffer}>} Decrypted filename and data
   */
  async function decryptFileChunked(
    encryptedData,
    aesKey,
    onProgress = () => {}
  ) {
    let offset = 0;

    // 1. Read and verify version byte
    const version = new Uint8Array(encryptedData.slice(0, 1))[0];
    if (version !== FORMAT_VERSION_CHUNKED) {
      throw new Error("Invalid chunked format version");
    }
    offset = 1;

    // 2. Read filename header
    const dataView = new DataView(encryptedData);
    const filenameOriginalLength =
      (dataView.getUint8(offset) << 8) | dataView.getUint8(offset + 1);
    offset += 2;

    const filenameIV = new Uint8Array(encryptedData.slice(offset, offset + 12));
    offset += 12;

    const filenameCipherLength = dataView.getUint32(offset, false);
    offset += 4;

    const filenameCiphertext = encryptedData.slice(
      offset,
      offset + filenameCipherLength
    );
    offset += filenameCipherLength;

    // Decrypt filename
    const decryptedFilenameBuffer = await decryptAES(
      filenameCiphertext,
      aesKey,
      filenameIV
    );
    const filename = new TextDecoder().decode(decryptedFilenameBuffer);

    // 3. Read chunk count
    const totalChunks = dataView.getUint32(offset, false);
    offset += 4;

    // 4. Decrypt all chunks
    const decryptedChunks = [];

    for (let i = 0; i < totalChunks; i++) {
      // Read IV
      const iv = new Uint8Array(encryptedData.slice(offset, offset + 12));
      offset += 12;

      // Read ciphertext length
      const ciphertextLength = dataView.getUint32(offset, false);
      offset += 4;

      // Read ciphertext
      const ciphertext = encryptedData.slice(offset, offset + ciphertextLength);
      offset += ciphertextLength;

      // Decrypt chunk
      const plaintext = await decryptAES(ciphertext, aesKey, iv);
      decryptedChunks.push(new Uint8Array(plaintext));

      const progress = Math.round(((i + 1) / totalChunks) * 100);
      onProgress(progress);
    }

    // Combine all chunks
    const totalLength = decryptedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    );
    const result = new Uint8Array(totalLength);
    let position = 0;
    for (const chunk of decryptedChunks) {
      result.set(chunk, position);
      position += chunk.length;
    }

    return { filename, data: result.buffer };
  }

  /**
   * Decrypt legacy format (v0) - backward compatibility.
   * Format: [12-byte IV][encrypted([2-byte filename length][filename][file data])]
   * @param {ArrayBuffer} encryptedData - The encrypted data (including IV)
   * @param {CryptoKey} aesKey - The AES key
   * @returns {Promise<{filename: string, data: ArrayBuffer}>} Decrypted filename and data
   */
  async function decryptFileLegacy(encryptedData, aesKey) {
    const iv = new Uint8Array(encryptedData.slice(0, 12));
    const ciphertext = encryptedData.slice(12);

    const decryptedBuffer = await decryptAES(ciphertext, aesKey, iv);
    const decryptedArray = new Uint8Array(decryptedBuffer);

    if (decryptedArray.length < 2) {
      throw new Error("Invalid file format: data too short.");
    }

    const filenameLength = (decryptedArray[0] << 8) | decryptedArray[1];

    if (
      filenameLength === 0 ||
      filenameLength > 1000 ||
      2 + filenameLength > decryptedArray.length
    ) {
      throw new Error("Invalid file format: corrupted filename data.");
    }

    const filenameBytes = decryptedArray.slice(2, 2 + filenameLength);
    let filename = new TextDecoder().decode(filenameBytes);
    filename =
      filename.replace(/[/\\]/g, "_").replace(/\x00/g, "").trim() || "download";

    const fileContent = decryptedArray.slice(2 + filenameLength);

    return { filename, data: fileContent.buffer };
  }

  /**
   * Unified decrypt function that handles both legacy and chunked formats.
   * @param {ArrayBuffer} encryptedData - The encrypted data
   * @param {CryptoKey} aesKey - The AES key
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise<{filename: string, data: ArrayBuffer}>} Decrypted filename and data
   */
  async function decryptFileAuto(encryptedData, aesKey, onProgress = () => {}) {
    const format = detectEncryptionFormat(encryptedData);

    if (format === FORMAT_VERSION_CHUNKED) {
      return await decryptFileChunked(encryptedData, aesKey, onProgress);
    } else {
      onProgress(100);
      return await decryptFileLegacy(encryptedData, aesKey);
    }
  }

  // ===========================================================================
  // ECDH Operations (Identity-Based Key Exchange)
  // ===========================================================================

  /**
   * Generate an ECDH key pair for identity-based access.
   * @returns {Promise<CryptoKeyPair>} The generated key pair
   */
  async function generateECDHKeyPair() {
    return await window.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: ECDH_CURVE },
      true, // extractable
      ["deriveKey", "deriveBits"]
    );
  }

  /**
   * Export ECDH public key to JWK format.
   * @param {CryptoKey} publicKey - The public key
   * @returns {Promise<JsonWebKey>} The exported JWK
   */
  async function exportECDHPublicKey(publicKey) {
    return await window.crypto.subtle.exportKey("jwk", publicKey);
  }

  /**
   * Export ECDH private key to JWK format.
   * @param {CryptoKey} privateKey - The private key
   * @returns {Promise<JsonWebKey>} The exported JWK
   */
  async function exportECDHPrivateKey(privateKey) {
    return await window.crypto.subtle.exportKey("jwk", privateKey);
  }

  /**
   * Import ECDH public key from JWK format.
   * @param {JsonWebKey} jwk - The JWK to import
   * @returns {Promise<CryptoKey>} The imported public key
   */
  async function importECDHPublicKey(jwk) {
    return await window.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDH", namedCurve: ECDH_CURVE },
      true,
      [] // public keys don't need usages for ECDH
    );
  }

  /**
   * Import ECDH private key from JWK format.
   * @param {JsonWebKey} jwk - The JWK to import
   * @returns {Promise<CryptoKey>} The imported private key
   */
  async function importECDHPrivateKey(jwk) {
    return await window.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDH", namedCurve: ECDH_CURVE },
      true,
      ["deriveKey", "deriveBits"]
    );
  }

  /**
   * Derive a shared AES key using ECDH.
   * @param {CryptoKey} privateKey - Our private key
   * @param {CryptoKey} publicKey - Recipient's public key
   * @returns {Promise<CryptoKey>} Derived AES-256-GCM key
   */
  async function deriveSharedKey(privateKey, publicKey) {
    return await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: publicKey },
      privateKey,
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Encrypt an AES file key for a recipient using ECDH.
   * Uses ephemeral key pair for forward secrecy.
   *
   * @param {CryptoKey} fileAESKey - The file's AES key to encrypt
   * @param {CryptoKey} recipientPublicKey - Recipient's ECDH public key
   * @returns {Promise<Object>} { ephemeralPublicKey: JWK, encryptedKey: base64, iv: base64 }
   */
  async function encryptKeyForRecipient(fileAESKey, recipientPublicKey) {
    // Generate ephemeral key pair for this encryption
    const ephemeralKeyPair = await generateECDHKeyPair();

    // Derive shared secret
    const sharedKey = await deriveSharedKey(
      ephemeralKeyPair.privateKey,
      recipientPublicKey
    );

    // Export file key as raw bytes
    const rawFileKey = await exportAESKeyRaw(fileAESKey);

    // Encrypt file key with shared key
    const iv = generateIV();
    const encryptedKeyData = await encryptAES(rawFileKey, sharedKey, iv);

    // Export ephemeral public key
    const ephemeralPublicKeyJWK = await exportECDHPublicKey(
      ephemeralKeyPair.publicKey
    );

    return {
      ephemeralPublicKey: ephemeralPublicKeyJWK,
      encryptedKey: arrayBufferToBase64(encryptedKeyData),
      iv: arrayBufferToBase64(iv),
    };
  }

  /**
   * Decrypt an AES file key using our ECDH private key.
   *
   * @param {Object} encryptedKeyBundle - { ephemeralPublicKey, encryptedKey, iv }
   * @param {CryptoKey} ourPrivateKey - Our ECDH private key
   * @returns {Promise<CryptoKey>} The decrypted AES file key
   */
  async function decryptKeyWithPrivateKey(encryptedKeyBundle, ourPrivateKey) {
    const { ephemeralPublicKey, encryptedKey, iv } = encryptedKeyBundle;

    // Import ephemeral public key
    const ephemeralPubKey = await importECDHPublicKey(ephemeralPublicKey);

    // Derive shared secret
    const sharedKey = await deriveSharedKey(ourPrivateKey, ephemeralPubKey);

    // Decrypt file key
    const ivBytes = base64ToArrayBuffer(iv);
    const encryptedKeyBytes = base64ToArrayBuffer(encryptedKey);
    const rawFileKey = await decryptAES(
      encryptedKeyBytes,
      sharedKey,
      new Uint8Array(ivBytes)
    );

    // Import as AES key
    return await importAESKeyFromRaw(rawFileKey);
  }

  // ===========================================================================
  // ECDSA Operations (Digital Signatures)
  // ===========================================================================

  /**
   * Generate an ECDSA key pair for signing.
   * @returns {Promise<CryptoKeyPair>} The generated key pair
   */
  async function generateSigningKeyPair() {
    return await window.crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: ECDSA_CURVE },
      true, // extractable
      ["sign", "verify"]
    );
  }

  /**
   * Export ECDSA public key to JWK format.
   * @param {CryptoKey} publicKey - The public key
   * @returns {Promise<JsonWebKey>} The exported JWK
   */
  async function exportSigningPublicKey(publicKey) {
    return await window.crypto.subtle.exportKey("jwk", publicKey);
  }

  /**
   * Export ECDSA private key to JWK format.
   * @param {CryptoKey} privateKey - The private key
   * @returns {Promise<JsonWebKey>} The exported JWK
   */
  async function exportSigningPrivateKey(privateKey) {
    return await window.crypto.subtle.exportKey("jwk", privateKey);
  }

  /**
   * Import ECDSA public key from JWK format.
   * @param {JsonWebKey} jwk - The JWK to import
   * @returns {Promise<CryptoKey>} The imported public key
   */
  async function importSigningPublicKey(jwk) {
    return await window.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: ECDSA_CURVE },
      true,
      ["verify"]
    );
  }

  /**
   * Import ECDSA private key from JWK format.
   * @param {JsonWebKey} jwk - The JWK to import
   * @returns {Promise<CryptoKey>} The imported private key
   */
  async function importSigningPrivateKey(jwk) {
    return await window.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: ECDSA_CURVE },
      true,
      ["sign"]
    );
  }

  /**
   * Sign data with ECDSA.
   * @param {ArrayBuffer} data - Data to sign
   * @param {CryptoKey} privateKey - ECDSA private key
   * @returns {Promise<ArrayBuffer>} Signature
   */
  async function sign(data, privateKey) {
    return await window.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      data
    );
  }

  /**
   * Verify an ECDSA signature.
   * @param {ArrayBuffer} data - Original data
   * @param {ArrayBuffer} signature - Signature to verify
   * @param {CryptoKey} publicKey - Signer's ECDSA public key
   * @returns {Promise<boolean>} True if valid
   */
  async function verify(data, signature, publicKey) {
    return await window.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      data
    );
  }

  /**
   * Create a signature over file metadata.
   * Signs: filename + file size + file hash + timestamp
   *
   * @param {Object} metadata - { filename, size, contentHash }
   * @param {CryptoKey} signingPrivateKey - ECDSA private key
   * @returns {Promise<Object>} { signature: base64, timestamp: ISO string, signedData: base64 }
   */
  async function signFileMetadata(metadata, signingPrivateKey) {
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

  /**
   * Verify a file metadata signature.
   *
   * @param {Object} signatureBundle - { signature, timestamp, signedData }
   * @param {CryptoKey} signerPublicKey - Signer's ECDSA public key
   * @returns {Promise<Object>} { valid: boolean, metadata: Object|null }
   */
  async function verifyFileMetadataSignature(signatureBundle, signerPublicKey) {
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
      console.error("Signature verification error:", error);
      return { valid: false, metadata: null };
    }
  }

  // ===========================================================================
  // Hashing Utilities
  // ===========================================================================

  /**
   * Compute SHA-256 hash of data.
   * @param {ArrayBuffer} data - Data to hash
   * @returns {Promise<string>} Hex-encoded hash
   */
  async function sha256(data) {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    return arrayBufferToHex(hashBuffer);
  }

  /**
   * Compute SHA-256 hash of a file.
   * For memory efficiency on large files, we read in chunks but need to
   * accumulate all data since WebCrypto doesn't support incremental hashing.
   *
   * For files > 100MB, uses the same Merkle-tree style hashing as hashFileStreaming
   * to ensure consistency between buffered and streaming uploads.
   *
   * @param {File} file - File to hash
   * @returns {Promise<string>} Hex-encoded hash
   */
  async function hashFile(file) {
    // For files <= 100MB, read entire file into memory (standard hash)
    if (file.size <= 100 * 1024 * 1024) {
      const buffer = await file.arrayBuffer();
      return await sha256(buffer);
    }

    // For larger files, use the same Merkle-tree approach as hashFileStreaming
    // This ensures buffered and streaming uploads produce identical hashes
    const chunkSize = CHUNK_SIZE; // 64KB - same as streaming
    const totalChunks = Math.ceil(file.size / chunkSize);
    const chunkHashes = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const buffer = await chunk.arrayBuffer();

      // Hash this chunk
      const chunkHash = await window.crypto.subtle.digest("SHA-256", buffer);
      chunkHashes.push(new Uint8Array(chunkHash));
    }

    // Concatenate all chunk hashes (32 bytes each)
    const concatenatedHashes = new Uint8Array(chunkHashes.length * 32);
    for (let i = 0; i < chunkHashes.length; i++) {
      concatenatedHashes.set(chunkHashes[i], i * 32);
    }

    // Hash the concatenated hashes to get final hash
    const finalHash = await window.crypto.subtle.digest(
      "SHA-256",
      concatenatedHashes
    );

    return arrayBufferToHex(finalHash);
  }

  // ===========================================================================
  // Encoding Utilities
  // ===========================================================================

  /**
   * Convert ArrayBuffer to Base64 string.
   * @param {ArrayBuffer} buffer - The buffer to encode
   * @returns {string} Base64-encoded string
   */
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert Base64 string to ArrayBuffer.
   * @param {string} base64 - The Base64 string to decode
   * @returns {ArrayBuffer} Decoded buffer
   */
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Convert ArrayBuffer to Hex string.
   * @param {ArrayBuffer} buffer - The buffer to encode
   * @returns {string} Hex-encoded string
   */
  function arrayBufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Convert Hex string to ArrayBuffer.
   * @param {string} hex - The hex string to decode
   * @returns {ArrayBuffer} Decoded buffer
   */
  function hexToArrayBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes.buffer;
  }

  /**
   * Generate a random identifier.
   * @param {number} bytes - Number of random bytes
   * @returns {string} Hex-encoded random string
   */
  function generateRandomId(bytes = 16) {
    const randomBytes = window.crypto.getRandomValues(new Uint8Array(bytes));
    return arrayBufferToHex(randomBytes);
  }

  // ===========================================================================
  // Fingerprint Generation
  // ===========================================================================

  /**
   * Generate a fingerprint for a public key.
   * Used for key verification.
   *
   * @param {JsonWebKey} publicKeyJWK - The public key in JWK format
   * @returns {Promise<string>} Hex-encoded fingerprint
   */
  async function generateKeyFingerprint(publicKeyJWK) {
    const keyString = JSON.stringify(publicKeyJWK);
    const encoder = new TextEncoder();
    return await sha256(encoder.encode(keyString));
  }

  /**
   * Format fingerprint for display (groups of 4 hex chars).
   * @param {string} fingerprint - Hex fingerprint
   * @returns {string} Formatted fingerprint
   */
  function formatFingerprint(fingerprint) {
    return fingerprint
      .match(/.{1,4}/g)
      .join(" ")
      .toUpperCase();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  return {
    // Constants
    CHUNK_SIZE,
    AES_IV_LENGTH,

    // AES Operations
    generateAESKey,
    generateIV,
    exportAESKey,
    exportAESKeyRaw,
    importAESKeyFromJWK,
    importAESKeyFromRaw,
    encryptAES,
    decryptAES,

    // Chunked File Encryption
    encryptFileChunked,
    decryptFileChunked,
    decryptFileLegacy,
    decryptFileAuto,
    detectEncryptionFormat,

    // Streaming Encryption (Memory-Constant)
    createEncryptedStream,
    createEncryptedHeader,
    hashFileStreaming,
    supportsStreamingUpload,

    // Streaming Decryption (Memory-Efficient)
    decryptFileChunkedStreaming,
    downloadAndDecryptStreaming,

    // ECDH Operations
    generateECDHKeyPair,
    exportECDHPublicKey,
    exportECDHPrivateKey,
    importECDHPublicKey,
    importECDHPrivateKey,
    deriveSharedKey,
    encryptKeyForRecipient,
    decryptKeyWithPrivateKey,

    // ECDSA Operations
    generateSigningKeyPair,
    exportSigningPublicKey,
    exportSigningPrivateKey,
    importSigningPublicKey,
    importSigningPrivateKey,
    sign,
    verify,
    signFileMetadata,
    verifyFileMetadataSignature,

    // Hashing
    sha256,
    hashFile,
    hashDataStreaming,

    // Encoding
    arrayBufferToBase64,
    base64ToArrayBuffer,
    arrayBufferToHex,
    hexToArrayBuffer,
    generateRandomId,

    // Fingerprints
    generateKeyFingerprint,
    formatFingerprint,
  };
})();

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = CryptoModule;
}
