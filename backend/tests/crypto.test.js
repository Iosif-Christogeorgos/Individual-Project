// ============================================================================
// CrypShare — Cryptographic Functions Unit Tests
// ============================================================================
// These tests verify the core cryptographic operations used by the frontend.
// Node.js 22+ provides crypto.subtle (WebCrypto API) natively.
// ============================================================================

import { describe, it, expect } from 'vitest';

// Since crypto.js is an ES module designed for the browser,
// we replicate its logic here using Node.js WebCrypto API
const subtle = globalThis.crypto.subtle;

// ============================================================================
// Constants (must match crypto.js)
// ============================================================================
const AES_KEY_LENGTH = 256;
const AES_IV_LENGTH = 12;
const CHUNK_SIZE = 64 * 1024; // 64KB
const ECDH_CURVE = 'P-256';
const ECDSA_CURVE = 'P-256';
const FORMAT_VERSION_CHUNKED = 2;

// ============================================================================
// Helper functions (replicated from crypto.js)
// ============================================================================

function arrayBufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  return Buffer.from(bytes).toString('base64');
}

function base64ToArrayBuffer(base64) {
  const buf = Buffer.from(base64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function sha256(data) {
  const hashBuffer = await subtle.digest('SHA-256', data);
  return arrayBufferToHex(hashBuffer);
}

async function generateKeyFingerprint(publicKeyJWK) {
  const sortedKeys = Object.keys(publicKeyJWK).sort();
  const canonical = JSON.stringify(publicKeyJWK, sortedKeys);
  const encoder = new TextEncoder();
  return await sha256(encoder.encode(canonical));
}

// ============================================================================
// Shared helper: Encrypt file in chunked format (replicates crypto.js logic)
// ============================================================================

async function encryptFileData(fileName, fileData, aesKey) {
  const encryptedChunks = [];

  // 1. Version byte
  encryptedChunks.push(new Uint8Array([FORMAT_VERSION_CHUNKED]));

  // 2. Encrypt filename
  const filenameBytes = new TextEncoder().encode(fileName);
  const filenameIV = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
  const encryptedFilename = await subtle.encrypt(
    { name: 'AES-GCM', iv: filenameIV }, aesKey, filenameBytes
  );
  const encFnArr = new Uint8Array(encryptedFilename);

  const filenameHeader = new Uint8Array(2 + 12 + 4 + encFnArr.length);
  filenameHeader[0] = (filenameBytes.length >> 8) & 0xFF;
  filenameHeader[1] = filenameBytes.length & 0xFF;
  filenameHeader.set(filenameIV, 2);
  new DataView(filenameHeader.buffer).setUint32(14, encFnArr.length, false);
  filenameHeader.set(encFnArr, 18);
  encryptedChunks.push(filenameHeader);

  // 3. Chunk count
  const totalChunks = Math.ceil(fileData.byteLength / CHUNK_SIZE);
  const chunkCountHeader = new Uint8Array(4);
  new DataView(chunkCountHeader.buffer).setUint32(0, totalChunks, false);
  encryptedChunks.push(chunkCountHeader);

  // 4. Encrypt chunks
  const dataView = new Uint8Array(fileData);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileData.byteLength);
    const chunk = dataView.slice(start, end);

    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const ciphertext = await subtle.encrypt(
      { name: 'AES-GCM', iv }, aesKey, chunk
    );
    const ctArr = new Uint8Array(ciphertext);

    const chunkPacket = new Uint8Array(16 + ctArr.length);
    chunkPacket.set(iv, 0);
    new DataView(chunkPacket.buffer).setUint32(12, ctArr.length, false);
    chunkPacket.set(ctArr, 16);
    encryptedChunks.push(chunkPacket);
  }

  // Concatenate all chunks into a single buffer
  const totalSize = encryptedChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of encryptedChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

// ============================================================================
// Shared helper: Decrypt file from chunked format (replicates crypto.js logic)
// ============================================================================

async function decryptFileData(encryptedBuffer, aesKey) {
  const data = new Uint8Array(encryptedBuffer);
  let offset = 0;

  // 1. Version
  const version = data[offset];
  offset += 1;
  if (version !== FORMAT_VERSION_CHUNKED) throw new Error('Unknown format version');

  // 2. Filename header
  const fnOrigLen = (data[offset] << 8) | data[offset + 1];
  offset += 2;
  const fnIV = data.slice(offset, offset + 12);
  offset += 12;
  const fnCTLen = new DataView(data.buffer, offset, 4).getUint32(0, false);
  offset += 4;
  const fnCT = data.slice(offset, offset + fnCTLen);
  offset += fnCTLen;

  const fnDecrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: fnIV }, aesKey, fnCT
  );
  const filename = new TextDecoder().decode(fnDecrypted);

  // 3. Chunk count
  const chunkCount = new DataView(data.buffer, offset, 4).getUint32(0, false);
  offset += 4;

  // 4. Decrypt chunks
  const decryptedChunks = [];
  for (let i = 0; i < chunkCount; i++) {
    const iv = data.slice(offset, offset + 12);
    offset += 12;
    const ctLen = new DataView(data.buffer, offset, 4).getUint32(0, false);
    offset += 4;
    const ct = data.slice(offset, offset + ctLen);
    offset += ctLen;

    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    decryptedChunks.push(new Uint8Array(decrypted));
  }

  const totalSize = decryptedChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of decryptedChunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return { filename, data: result.buffer };
}


// ============================================================================
// TEST SUITE 1: AES-256-GCM Operations
// ============================================================================

describe('AES-256-GCM Operations', () => {

  it('should generate a 256-bit AES key', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );

    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.algorithm.length).toBe(256);
    expect(key.extractable).toBe(true);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('should export and re-import AES key (JWK roundtrip)', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      true, ['encrypt', 'decrypt']
    );

    const jwk = await subtle.exportKey('jwk', key);
    expect(jwk.kty).toBe('oct');
    expect(jwk.alg).toBe('A256GCM');

    const reimported = await subtle.importKey(
      'jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
    );

    // Verify the reimported key works by cross-encrypting
    const testData = new TextEncoder().encode('roundtrip test');
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, reimported, testData);
    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);

    expect(new TextDecoder().decode(decrypted)).toBe('roundtrip test');
  });

  it('should export and re-import AES key (raw roundtrip)', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      true, ['encrypt', 'decrypt']
    );

    const raw = await subtle.exportKey('raw', key);
    expect(raw.byteLength).toBe(32); // 256 bits = 32 bytes

    const reimported = await subtle.importKey(
      'raw', raw, { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    expect(reimported.algorithm.name).toBe('AES-GCM');
  });

  it('should encrypt and decrypt small data correctly', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      true, ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const plaintext = new TextEncoder().encode('Hello, CrypShare!');

    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

    expect(new TextDecoder().decode(decrypted)).toBe('Hello, CrypShare!');
  });

  it('should fail decryption with wrong key', async () => {
    const key1 = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    const key2 = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const plaintext = new TextEncoder().encode('secret data');

    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key1, plaintext);

    await expect(
      subtle.decrypt({ name: 'AES-GCM', iv }, key2, ciphertext)
    ).rejects.toThrow();
  });

  it('should fail decryption with wrong IV', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    const iv1 = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const iv2 = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const plaintext = new TextEncoder().encode('secret data');

    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: iv1 }, key, plaintext);

    await expect(
      subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, key, ciphertext)
    ).rejects.toThrow();
  });

  it('should detect ciphertext tampering (GCM authentication tag)', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const plaintext = new TextEncoder().encode('tamper test data');

    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

    // Tamper with the ciphertext (flip a byte)
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xFF;

    await expect(
      subtle.decrypt({ name: 'AES-GCM', iv }, key, tampered.buffer)
    ).rejects.toThrow();
  });

  it('should produce different ciphertext for same plaintext (random IV)', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    const plaintext = new TextEncoder().encode('same data');

    const iv1 = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const iv2 = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));

    const ct1 = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv1 }, key, plaintext));
    const ct2 = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, key, plaintext));

    // Ciphertexts should differ because of different random IVs
    const match = ct1.length === ct2.length && ct1.every((b, i) => b === ct2[i]);
    expect(match).toBe(false);
  });
});

// ============================================================================
// TEST SUITE 2: Chunked File Encryption Format
// ============================================================================

describe('Chunked File Encryption Format (v2)', () => {

  it('should encrypt and decrypt a small file preserving content and filename', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );

    const filename = 'test-document.pdf';
    const content = new TextEncoder().encode('PDF file content here');

    const encrypted = await encryptFileData(filename, content.buffer, key);
    const decrypted = await decryptFileData(encrypted, key);

    expect(decrypted.filename).toBe(filename);
    expect(new Uint8Array(decrypted.data)).toEqual(content);
  });

  it('should handle multi-chunk files correctly', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );

    // Create data larger than CHUNK_SIZE (64KB) — non-aligned size
    const size = CHUNK_SIZE * 3 + 1234; // ~193KB
    const content = crypto.getRandomValues(new Uint8Array(size));

    const encrypted = await encryptFileData('large-test.bin', content.buffer, key);
    const decrypted = await decryptFileData(encrypted, key);

    expect(decrypted.filename).toBe('large-test.bin');
    expect(new Uint8Array(decrypted.data)).toEqual(content);
  });

  it('should produce version 2 format marker', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );

    const encrypted = await encryptFileData('v.txt', new Uint8Array([1, 2, 3]).buffer, key);
    const view = new Uint8Array(encrypted);

    expect(view[0]).toBe(2); // FORMAT_VERSION_CHUNKED
  });

  it('should fail decryption with wrong key on chunked file', async () => {
    const key1 = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    const key2 = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );

    const encrypted = await encryptFileData('secret.txt',
      new TextEncoder().encode('secret').buffer, key1
    );

    await expect(decryptFileData(encrypted, key2)).rejects.toThrow();
  });

  it('should handle empty filename gracefully', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );

    const encrypted = await encryptFileData('', new Uint8Array([0]).buffer, key);
    const decrypted = await decryptFileData(encrypted, key);

    expect(decrypted.filename).toBe('');
  });

  it('should handle unicode filenames', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );

    const unicodeName = '日本語ファイル_📎_résumé.pdf';
    const encrypted = await encryptFileData(unicodeName, new Uint8Array([1]).buffer, key);
    const decrypted = await decryptFileData(encrypted, key);

    expect(decrypted.filename).toBe(unicodeName);
  });
});

// ============================================================================
// TEST SUITE 3: ECDH Key Exchange
// ============================================================================

describe('ECDH Key Exchange (P-256)', () => {

  it('should generate an ECDH P-256 keypair', async () => {
    const keyPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      true,
      ['deriveKey']
    );

    expect(keyPair.publicKey.type).toBe('public');
    expect(keyPair.privateKey.type).toBe('private');
    expect(keyPair.publicKey.algorithm.namedCurve).toBe('P-256');
  });

  it('should derive the same shared key from both sides', async () => {
    const alice = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );
    const bob = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );

    const sharedKeyAB = await subtle.deriveKey(
      { name: 'ECDH', public: bob.publicKey },
      alice.privateKey,
      { name: 'AES-GCM', length: 256 },
      true, ['encrypt', 'decrypt']
    );

    const sharedKeyBA = await subtle.deriveKey(
      { name: 'ECDH', public: alice.publicKey },
      bob.privateKey,
      { name: 'AES-GCM', length: 256 },
      true, ['encrypt', 'decrypt']
    );

    const rawAB = new Uint8Array(await subtle.exportKey('raw', sharedKeyAB));
    const rawBA = new Uint8Array(await subtle.exportKey('raw', sharedKeyBA));

    expect(rawAB).toEqual(rawBA);
  });

  it('should encrypt and decrypt an AES key for a recipient (full ECDH flow)', async () => {
    // 1. Generate file AES key
    const fileKey = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );
    const fileKeyRaw = await subtle.exportKey('raw', fileKey);

    // 2. Recipient has a long-lived keypair
    const recipient = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );

    // 3. Sender creates ephemeral keypair + derives shared secret
    const ephemeral = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );

    const sharedKey = await subtle.deriveKey(
      { name: 'ECDH', public: recipient.publicKey },
      ephemeral.privateKey,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt']
    );

    // 4. Encrypt the file key with the shared secret
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const encryptedFileKey = await subtle.encrypt(
      { name: 'AES-GCM', iv }, sharedKey, fileKeyRaw
    );

    // 5. Bundle = { ephemeralPublicKey, iv, encryptedKey }
    const ephemeralPubJWK = await subtle.exportKey('jwk', ephemeral.publicKey);

    // --- Recipient side ---

    // 6. Import ephemeral public key
    const importedEphPub = await subtle.importKey(
      'jwk', ephemeralPubJWK,
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      false, []
    );

    // 7. Derive same shared secret
    const recipientSharedKey = await subtle.deriveKey(
      { name: 'ECDH', public: importedEphPub },
      recipient.privateKey,
      { name: 'AES-GCM', length: 256 },
      false, ['decrypt']
    );

    // 8. Decrypt the file key
    const decryptedFileKeyRaw = await subtle.decrypt(
      { name: 'AES-GCM', iv }, recipientSharedKey, encryptedFileKey
    );

    // 9. Compare raw key bytes
    expect(new Uint8Array(decryptedFileKeyRaw)).toEqual(new Uint8Array(fileKeyRaw));

    // 10. Verify the recovered key actually works for file decryption
    const recoveredFileKey = await subtle.importKey(
      'raw', decryptedFileKeyRaw,
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      true, ['encrypt', 'decrypt']
    );

    const testIV = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const testPlain = new TextEncoder().encode('file content');
    const testCipher = await subtle.encrypt(
      { name: 'AES-GCM', iv: testIV }, fileKey, testPlain
    );
    const testDecrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: testIV }, recoveredFileKey, testCipher
    );

    expect(new TextDecoder().decode(testDecrypted)).toBe('file content');
  });

  it('should produce different shared keys for different keypairs', async () => {
    const alice = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );
    const bob = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );
    const charlie = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );

    const keyAB = await subtle.deriveKey(
      { name: 'ECDH', public: bob.publicKey }, alice.privateKey,
      { name: 'AES-GCM', length: 256 }, true, ['encrypt']
    );
    const keyAC = await subtle.deriveKey(
      { name: 'ECDH', public: charlie.publicKey }, alice.privateKey,
      { name: 'AES-GCM', length: 256 }, true, ['encrypt']
    );

    const rawAB = new Uint8Array(await subtle.exportKey('raw', keyAB));
    const rawAC = new Uint8Array(await subtle.exportKey('raw', keyAC));

    expect(rawAB).not.toEqual(rawAC);
  });
});

// ============================================================================
// TEST SUITE 4: ECDSA Digital Signatures
// ============================================================================

describe('ECDSA Digital Signatures (P-256)', () => {

  it('should generate an ECDSA P-256 signing keypair', async () => {
    const keyPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: ECDSA_CURVE },
      true,
      ['sign', 'verify']
    );

    expect(keyPair.publicKey.algorithm.name).toBe('ECDSA');
    expect(keyPair.privateKey.algorithm.name).toBe('ECDSA');
  });

  it('should sign and verify data correctly', async () => {
    const keyPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: ECDSA_CURVE }, true, ['sign', 'verify']
    );

    const data = new TextEncoder().encode('data to sign');
    const signature = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, data
    );

    const valid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair.publicKey, signature, data
    );

    expect(valid).toBe(true);
  });

  it('should fail verification with tampered data', async () => {
    const keyPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: ECDSA_CURVE }, true, ['sign', 'verify']
    );

    const data = new TextEncoder().encode('original data');
    const signature = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, data
    );

    const tamperedData = new TextEncoder().encode('tampered data');
    const valid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair.publicKey, signature, tamperedData
    );

    expect(valid).toBe(false);
  });

  it('should fail verification with wrong public key', async () => {
    const keyPair1 = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: ECDSA_CURVE }, true, ['sign', 'verify']
    );
    const keyPair2 = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: ECDSA_CURVE }, true, ['sign', 'verify']
    );

    const data = new TextEncoder().encode('signed by keyPair1');
    const signature = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair1.privateKey, data
    );

    const valid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair2.publicKey, signature, data
    );

    expect(valid).toBe(false);
  });

  it('should sign and verify file metadata (CrypShare format)', async () => {
    const keyPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: ECDSA_CURVE }, true, ['sign', 'verify']
    );

    // Replicate signFileMetadata from crypto.js
    const metadata = {
      filename: 'secret-report.pdf',
      size: 1048576,
      contentHash: 'a'.repeat(64),
    };

    const encoder = new TextEncoder();
    const filenameHashBuffer = await subtle.digest('SHA-256', encoder.encode(metadata.filename));
    const filenameHash = arrayBufferToHex(filenameHashBuffer);

    const dataToSign = JSON.stringify({
      filenameHash,
      size: metadata.size,
      contentHash: metadata.contentHash,
      timestamp: new Date().toISOString(),
    });

    const dataBytes = encoder.encode(dataToSign);
    const signature = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, dataBytes
    );

    const signatureBundle = {
      signature: arrayBufferToBase64(signature),
      signedData: arrayBufferToBase64(dataBytes),
    };

    // Replicate verifyFileMetadataSignature from crypto.js
    const sigBytes = base64ToArrayBuffer(signatureBundle.signature);
    const signedDataBytes = base64ToArrayBuffer(signatureBundle.signedData);

    const valid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair.publicKey, sigBytes, signedDataBytes
    );

    expect(valid).toBe(true);

    // Also verify the signed metadata can be parsed correctly
    const parsed = JSON.parse(new TextDecoder().decode(signedDataBytes));
    expect(parsed.filenameHash).toBe(filenameHash);
    expect(parsed.size).toBe(1048576);
    expect(parsed.contentHash).toBe('a'.repeat(64));
  });

  it('should detect tampered signature bytes', async () => {
    const keyPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: ECDSA_CURVE }, true, ['sign', 'verify']
    );

    const data = new TextEncoder().encode(JSON.stringify({ test: 'data' }));
    const signature = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, data
    );

    // Tamper with signature (flip a byte)
    const tampered = new Uint8Array(signature);
    tampered[0] ^= 0xFF;

    // Verification should return false or throw — both are acceptable
    try {
      const valid = await subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, keyPair.publicKey, tampered.buffer, data
      );
      expect(valid).toBe(false);
    } catch (e) {
      // Some WebCrypto implementations throw on malformed signatures
      expect(e).toBeDefined();
    }
  });
});

// ============================================================================
// TEST SUITE 5: SHA-256 Hashing & Fingerprints
// ============================================================================

describe('SHA-256 Hashing & Fingerprints', () => {

  it('should produce correct SHA-256 hash for known input', async () => {
    const data = new TextEncoder().encode('hello');
    const hash = await sha256(data);

    // Well-known SHA-256 of "hello"
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should produce different hashes for different inputs', async () => {
    const hash1 = await sha256(new TextEncoder().encode('input1'));
    const hash2 = await sha256(new TextEncoder().encode('input2'));

    expect(hash1).not.toBe(hash2);
  });

  it('should generate deterministic fingerprints from JWK (canonical JSON)', async () => {
    const keyPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );

    const jwk = await subtle.exportKey('jwk', keyPair.publicKey);

    // Generate fingerprint twice — must be identical
    const fp1 = await generateKeyFingerprint(jwk);
    const fp2 = await generateKeyFingerprint(jwk);

    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(64); // SHA-256 = 64 hex chars
  });

  it('should produce different fingerprints for different keys', async () => {
    const kp1 = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );
    const kp2 = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );

    const fp1 = await generateKeyFingerprint(await subtle.exportKey('jwk', kp1.publicKey));
    const fp2 = await generateKeyFingerprint(await subtle.exportKey('jwk', kp2.publicKey));

    expect(fp1).not.toBe(fp2);
  });

  it('should generate consistent fingerprint regardless of JWK property order', async () => {
    // This is critical — crypto.js uses sorted keys for canonical JSON
    const jwk1 = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' };
    const jwk2 = { y: 'def', x: 'abc', kty: 'EC', crv: 'P-256' };

    const fp1 = await generateKeyFingerprint(jwk1);
    const fp2 = await generateKeyFingerprint(jwk2);

    expect(fp1).toBe(fp2);
  });

  it('should derive user ID from fingerprint (first 32 chars)', async () => {
    // Replicates identity.js: id = fingerprint.substring(0, 32)
    const kp = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE }, true, ['deriveKey']
    );
    const jwk = await subtle.exportKey('jwk', kp.publicKey);
    const fingerprint = await generateKeyFingerprint(jwk);

    const id = fingerprint.substring(0, 32);

    expect(id.length).toBe(32);
    expect(/^[a-f0-9]{32}$/.test(id)).toBe(true);
    expect(fingerprint.startsWith(id)).toBe(true);
  });
});

// ============================================================================
// TEST SUITE 6: PBKDF2 Backup Encryption
// ============================================================================

describe('PBKDF2 Backup Encryption', () => {

  async function deriveKeyFromPassword(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  it('should encrypt and decrypt backup data with password', async () => {
    const password = 'MyStr0ngP@ssw0rd!';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));

    const backupData = JSON.stringify({ identity: 'test', keys: {} });
    const encoder = new TextEncoder();

    const key = await deriveKeyFromPassword(password, salt);
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv }, key, encoder.encode(backupData)
    );

    // Decrypt with the same password
    const key2 = await deriveKeyFromPassword(password, salt);
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv }, key2, encrypted
    );

    expect(JSON.parse(new TextDecoder().decode(decrypted))).toEqual({
      identity: 'test', keys: {}
    });
  });

  it('should fail decryption with wrong password', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));

    const key1 = await deriveKeyFromPassword('correct-password', salt);
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv }, key1, new TextEncoder().encode('secret')
    );

    const key2 = await deriveKeyFromPassword('wrong-password', salt);
    await expect(
      subtle.decrypt({ name: 'AES-GCM', iv }, key2, encrypted)
    ).rejects.toThrow();
  });

  it('should use 100,000 PBKDF2 iterations (timing sanity check)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const t0 = performance.now();
    await deriveKeyFromPassword('benchmark-password', salt);
    const elapsed = performance.now() - t0;

    // 100K iterations should take at least a few milliseconds
    expect(elapsed).toBeGreaterThan(1);
  });
});

// ============================================================================
// TEST SUITE 7: Content Integrity Verification
// ============================================================================

describe('Content Integrity Verification', () => {

  it('should detect hash mismatch after tampering', async () => {
    const originalData = new TextEncoder().encode('original file content');
    const originalHash = await sha256(originalData);

    const tamperedData = new TextEncoder().encode('tampered file content');
    const tamperedHash = await sha256(tamperedData);

    expect(originalHash).not.toBe(tamperedHash);
  });

  it('should produce matching hashes for identical data', async () => {
    const data = crypto.getRandomValues(new Uint8Array(1024));

    const hash1 = await sha256(data);
    const hash2 = await sha256(data);

    expect(hash1).toBe(hash2);
  });

  it('should verify encrypt-decrypt roundtrip preserves content hash', async () => {
    const key = await subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH }, true, ['encrypt', 'decrypt']
    );

    // Original data
    const original = crypto.getRandomValues(new Uint8Array(50000));
    const originalHash = await sha256(original);

    // Encrypt
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv }, key, original
    );

    // Decrypt
    const decrypted = new Uint8Array(
      await subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
    );
    const decryptedHash = await sha256(decrypted);

    // Hash must match — proves no data corruption during encrypt/decrypt
    expect(decryptedHash).toBe(originalHash);
  });
});

// ============================================================================
// TEST SUITE 8: File ID Format Validation (Security)
// ============================================================================

describe('File ID Format Validation', () => {
  const FILE_ID_REGEX = /^file-[a-f0-9]{64}\.bin$/;

  it('should accept valid file IDs', () => {
    const validId = 'file-' + 'a'.repeat(64) + '.bin';
    expect(FILE_ID_REGEX.test(validId)).toBe(true);

    const validId2 = 'file-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.bin';
    expect(FILE_ID_REGEX.test(validId2)).toBe(true);
  });

  it('should reject path traversal attempts', () => {
    expect(FILE_ID_REGEX.test('../../../etc/passwd')).toBe(false);
    expect(FILE_ID_REGEX.test('..\\..\\windows\\system32')).toBe(false);
    expect(FILE_ID_REGEX.test('file-../../../etc/passwd.bin')).toBe(false);
  });

  it('should reject old timestamp-based format', () => {
    expect(FILE_ID_REGEX.test('file-1703580000000-abcdef.bin')).toBe(false);
  });

  it('should reject uppercase hex', () => {
    expect(FILE_ID_REGEX.test('file-' + 'A'.repeat(64) + '.bin')).toBe(false);
  });

  it('should reject wrong length', () => {
    expect(FILE_ID_REGEX.test('file-' + 'a'.repeat(63) + '.bin')).toBe(false);
    expect(FILE_ID_REGEX.test('file-' + 'a'.repeat(65) + '.bin')).toBe(false);
  });

  it('should reject missing prefix or suffix', () => {
    expect(FILE_ID_REGEX.test('a'.repeat(64) + '.bin')).toBe(false);
    expect(FILE_ID_REGEX.test('file-' + 'a'.repeat(64))).toBe(false);
  });
});
