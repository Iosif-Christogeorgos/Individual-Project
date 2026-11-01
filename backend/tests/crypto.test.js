// Tests the real browser module (frontend/crypto.js) using Node's WebCrypto.
import { describe, expect, it, vi, afterEach } from "vitest";
import * as CryptoModule from "../../frontend/crypto.js";

globalThis.window = globalThis;

const subtle = globalThis.crypto.subtle;
const CHUNK_SIZE = 64 * 1024;

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  // getRandomValues is capped at 65536 bytes per call
  for (let i = 0; i < size; i += 65536) {
    crypto.getRandomValues(bytes.subarray(i, i + 65536));
  }
  return bytes;
}

async function encrypt(bytes, name = "report.pdf") {
  const key = await CryptoModule.generateAESKey();
  const blob = await CryptoModule.encryptFileChunked(new File([bytes], name), key);
  return { key, encrypted: await blob.arrayBuffer() };
}

// Splits an encrypted file into its parts so tests can tamper like a malicious server
function parseLayout(encrypted) {
  const view = new DataView(encrypted);
  const filenameCipherLength = view.getUint32(15, false);
  const countOffset = 19 + filenameCipherLength;
  const totalChunks = view.getUint32(countOffset, false);
  const chunks = [];
  let offset = countOffset + 4;
  for (let i = 0; i < totalChunks; i++) {
    const length = 16 + view.getUint32(offset + 12, false);
    chunks.push(new Uint8Array(encrypted.slice(offset, offset + length)));
    offset += length;
  }
  return { header: new Uint8Array(encrypted.slice(0, countOffset)), chunks };
}

function assemble(header, chunks, totalChunks = chunks.length) {
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, totalChunks, false);
  return new Blob([header, count, ...chunks]).arrayBuffer();
}

// The previous format: same layout, but no authenticated position data
async function encryptLegacyV2(bytes, name) {
  const key = await CryptoModule.generateAESKey();
  const seal = async (data) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await subtle.encrypt({ name: "AES-GCM", iv }, key, data),
    );
    return { iv, ciphertext };
  };

  const nameBytes = new TextEncoder().encode(name);
  const sealedName = await seal(nameBytes);
  const header = new Uint8Array(19 + sealedName.ciphertext.length);
  header[0] = 2;
  header[1] = nameBytes.length >> 8;
  header[2] = nameBytes.length & 0xff;
  header.set(sealedName.iv, 3);
  new DataView(header.buffer).setUint32(15, sealedName.ciphertext.length, false);
  header.set(sealedName.ciphertext, 19);

  const chunks = [];
  for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
    const sealed = await seal(bytes.subarray(start, start + CHUNK_SIZE));
    const packet = new Uint8Array(16 + sealed.ciphertext.length);
    packet.set(sealed.iv, 0);
    new DataView(packet.buffer).setUint32(12, sealed.ciphertext.length, false);
    packet.set(sealed.ciphertext, 16);
    chunks.push(packet);
  }
  return { key, encrypted: await assemble(header, chunks) };
}

function stubFetchResponse(body) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body)),
  );
}

function memoryWritable() {
  const written = [];
  const state = { closed: false, aborted: false, written };
  const stream = new WritableStream({
    write: (chunk) => void written.push(chunk),
    close: () => void (state.closed = true),
    abort: () => void (state.aborted = true),
  });
  return { stream, state };
}

afterEach(() => vi.unstubAllGlobals());

describe("file encryption round trip", () => {
  it.each([
    ["empty file", 0],
    ["one byte", 1],
    ["exactly one chunk", CHUNK_SIZE],
    ["one byte over a chunk", CHUNK_SIZE + 1],
    ["several chunks", CHUNK_SIZE * 3 + 1234],
  ])("%s", async (_name, size) => {
    const bytes = randomBytes(size);
    const { key, encrypted } = await encrypt(bytes, "résumé 📄.pdf");

    const result = await CryptoModule.decryptFileChunked(encrypted, key);
    expect(result.filename).toBe("résumé 📄.pdf");
    expect(new Uint8Array(result.data)).toEqual(bytes);
  });

  it("writes format version 3", async () => {
    const { encrypted } = await encrypt(randomBytes(10));
    expect(new Uint8Array(encrypted)[0]).toBe(3);
    expect(CryptoModule.detectEncryptionFormat(encrypted)).toBe(3);
  });

  it("never contains the plaintext or filename", async () => {
    const plaintext = new TextEncoder().encode("TOP-SECRET-CONTENT");
    const { encrypted } = await encrypt(plaintext, "secret-name.txt");
    const asText = Buffer.from(encrypted).toString("latin1");
    expect(asText).not.toContain("TOP-SECRET-CONTENT");
    expect(asText).not.toContain("secret-name.txt");
  });

  it("uses a fresh IV for every chunk and file", async () => {
    const bytes = randomBytes(CHUNK_SIZE * 3);
    const first = parseLayout((await encrypt(bytes)).encrypted);
    const second = parseLayout((await encrypt(bytes)).encrypted);
    const ivs = [...first.chunks, ...second.chunks].map((c) =>
      Buffer.from(c.subarray(0, 12)).toString("hex"),
    );
    expect(new Set(ivs).size).toBe(ivs.length);
  });

  it("the streaming encryptor produces the same format, with the size it promised", async () => {
    const bytes = randomBytes(CHUNK_SIZE * 2 + 5);
    const key = await CryptoModule.generateAESKey();
    const { stream, totalSize } = await CryptoModule.createEncryptedStream(
      new File([bytes], "stream.bin"),
      key,
    );
    const encrypted = await new Response(stream).arrayBuffer();
    expect(encrypted.byteLength).toBe(totalSize);

    const result = await CryptoModule.decryptFileChunked(encrypted, key);
    expect(result.filename).toBe("stream.bin");
    expect(new Uint8Array(result.data)).toEqual(bytes);
  });

  it("rejects the wrong key", async () => {
    const { encrypted } = await encrypt(randomBytes(100));
    const otherKey = await CryptoModule.generateAESKey();
    await expect(
      CryptoModule.decryptFileChunked(encrypted, otherKey),
    ).rejects.toThrow();
  });

  it("rejects unknown formats", () => {
    expect(() =>
      CryptoModule.detectEncryptionFormat(new Uint8Array([9, 0, 0]).buffer),
    ).toThrow("Unknown encryption format");
  });
});

describe("tampering by a malicious server", () => {
  const size = CHUNK_SIZE * 3 + 100;

  it("detects a flipped ciphertext bit", async () => {
    const { key, encrypted } = await encrypt(randomBytes(size));
    const tampered = new Uint8Array(encrypted.slice(0));
    tampered[tampered.length - 1] ^= 1;
    await expect(
      CryptoModule.decryptFileChunked(tampered.buffer, key),
    ).rejects.toThrow();
  });

  it("detects reordered chunks", async () => {
    const { key, encrypted } = await encrypt(randomBytes(size));
    const { header, chunks } = parseLayout(encrypted);
    [chunks[0], chunks[1]] = [chunks[1], chunks[0]];
    await expect(
      CryptoModule.decryptFileChunked(await assemble(header, chunks), key),
    ).rejects.toThrow();
  });

  it("detects a truncated file with a corrected chunk count", async () => {
    const { key, encrypted } = await encrypt(randomBytes(size));
    const { header, chunks } = parseLayout(encrypted);
    await expect(
      CryptoModule.decryptFileChunked(
        await assemble(header, chunks.slice(0, 2)),
        key,
      ),
    ).rejects.toThrow();
  });

  it("detects a file emptied down to zero chunks", async () => {
    const { key, encrypted } = await encrypt(randomBytes(size));
    const { header } = parseLayout(encrypted);
    await expect(
      CryptoModule.decryptFileChunked(await assemble(header, []), key),
    ).rejects.toThrow();
  });

  it("detects duplicated chunks", async () => {
    const { key, encrypted } = await encrypt(randomBytes(size));
    const { header, chunks } = parseLayout(encrypted);
    chunks.splice(1, 0, chunks[1]);
    await expect(
      CryptoModule.decryptFileChunked(await assemble(header, chunks), key),
    ).rejects.toThrow();
  });

  it("can't be downgraded to the old format to skip the checks", async () => {
    const { key, encrypted } = await encrypt(randomBytes(size));
    const downgraded = new Uint8Array(encrypted.slice(0));
    downgraded[0] = 2;
    await expect(
      CryptoModule.decryptFileChunked(downgraded.buffer, key),
    ).rejects.toThrow();
  });
});

describe("files already stored in the old v2 format", () => {
  it("still decrypt", async () => {
    const bytes = randomBytes(CHUNK_SIZE * 2 + 10);
    const { key, encrypted } = await encryptLegacyV2(bytes, "old-file.zip");
    expect(CryptoModule.detectEncryptionFormat(encrypted)).toBe(2);

    const result = await CryptoModule.decryptFileChunked(encrypted, key);
    expect(result.filename).toBe("old-file.zip");
    expect(new Uint8Array(result.data)).toEqual(bytes);
  });

  it("still decrypt when streaming", async () => {
    const bytes = randomBytes(CHUNK_SIZE + 10);
    const { key, encrypted } = await encryptLegacyV2(bytes, "old-file.zip");
    stubFetchResponse(encrypted);
    const { stream, state } = memoryWritable();

    const result = await CryptoModule.downloadAndDecryptToStream("/x", key, stream);
    expect(result.filename).toBe("old-file.zip");
    expect(state.closed).toBe(true);
    expect(new Uint8Array(await new Blob(state.written).arrayBuffer())).toEqual(bytes);
  });
});

describe("streaming to disk", () => {
  it("writes the file and reports the same hash as hashFile", async () => {
    const bytes = randomBytes(CHUNK_SIZE * 2 + 10);
    const { key, encrypted } = await encrypt(bytes, "video.mp4");
    const expectedHash = await CryptoModule.hashFile(new File([bytes], "video.mp4"));
    stubFetchResponse(encrypted);
    const { stream, state } = memoryWritable();

    const result = await CryptoModule.downloadAndDecryptToStream(
      "/x",
      key,
      stream,
      () => {},
      () => {},
      expectedHash,
    );

    expect(result).toEqual({
      filename: "video.mp4",
      bytesWritten: bytes.length,
      contentHash: expectedHash,
    });
    expect(state.closed).toBe(true);
    expect(new Uint8Array(await new Blob(state.written).arrayBuffer())).toEqual(bytes);
  });

  it("discards the output when the content hash doesn't match", async () => {
    const { key, encrypted } = await encrypt(randomBytes(1000));
    stubFetchResponse(encrypted);
    const { stream, state } = memoryWritable();

    await expect(
      CryptoModule.downloadAndDecryptToStream(
        "/x",
        key,
        stream,
        () => {},
        () => {},
        "0".repeat(64),
      ),
    ).rejects.toThrow("integrity check failed");
    expect(state.aborted).toBe(true);
    expect(state.closed).toBe(false);
  });

  it("discards the output when a later chunk is corrupted", async () => {
    const { key, encrypted } = await encrypt(randomBytes(CHUNK_SIZE * 2 + 10));
    const tampered = new Uint8Array(encrypted.slice(0));
    tampered[tampered.length - 1] ^= 1;
    stubFetchResponse(tampered);
    const { stream, state } = memoryWritable();

    await expect(
      CryptoModule.downloadAndDecryptToStream("/x", key, stream),
    ).rejects.toThrow();
    expect(state.aborted).toBe(true);
    expect(state.closed).toBe(false);
  });
});

describe("fetchEncryptedFilename", () => {
  it("reads the name from the header without downloading the rest", async () => {
    const { key, encrypted } = await encrypt(randomBytes(CHUNK_SIZE * 3), "movie.mkv");
    let pulls = 0;
    const bytes = new Uint8Array(encrypted);
    const body = new ReadableStream({
      pull(controller) {
        const start = pulls * 8;
        pulls += 1;
        controller.enqueue(bytes.subarray(start, start + 8));
      },
    });
    stubFetchResponse(body);

    await expect(CryptoModule.fetchEncryptedFilename("/x", key)).resolves.toBe("movie.mkv");
    expect(pulls * 8).toBeLessThan(CHUNK_SIZE);
  });

  it("rejects a header claiming an absurd filename length", async () => {
    const key = await CryptoModule.generateAESKey();
    const header = new Uint8Array(19);
    header[0] = 3;
    new DataView(header.buffer).setUint32(15, 0xffffffff, false);
    stubFetchResponse(header);

    await expect(CryptoModule.fetchEncryptedFilename("/x", key)).rejects.toThrow(
      "Invalid encrypted file header",
    );
  });
});

describe("hashing", () => {
  it("hashFile and hashArrayBuffer agree", async () => {
    const bytes = randomBytes(1000);
    const copy = bytes.slice();
    expect(await CryptoModule.hashFile(new File([bytes], "a"))).toBe(
      await CryptoModule.hashArrayBuffer(copy.buffer),
    );
  });

  it("matches a known SHA-256 value", async () => {
    const bytes = new TextEncoder().encode("abc");
    expect(await CryptoModule.hashArrayBuffer(bytes.buffer)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("recipient key exchange", () => {
  it("only the recipient can recover the file key", async () => {
    const fileKey = await CryptoModule.generateAESKey();
    const recipient = await CryptoModule.generateECDHKeyPair();
    const stranger = await CryptoModule.generateECDHKeyPair();

    const bundle = await CryptoModule.encryptKeyForRecipient(fileKey, recipient.publicKey);
    const recovered = await CryptoModule.decryptKeyWithPrivateKey(
      bundle,
      recipient.privateKey,
    );
    expect(await CryptoModule.exportAESKeyRaw(recovered)).toEqual(
      await CryptoModule.exportAESKeyRaw(fileKey),
    );

    await expect(
      CryptoModule.decryptKeyWithPrivateKey(bundle, stranger.privateKey),
    ).rejects.toThrow();
  });

  it("uses a new ephemeral key for every recipient bundle", async () => {
    const fileKey = await CryptoModule.generateAESKey();
    const recipient = await CryptoModule.generateECDHKeyPair();
    const first = await CryptoModule.encryptKeyForRecipient(fileKey, recipient.publicKey);
    const second = await CryptoModule.encryptKeyForRecipient(fileKey, recipient.publicKey);
    expect(first.ephemeralPublicKey.x).not.toBe(second.ephemeralPublicKey.x);
  });
});

describe("file signatures", () => {
  const file = { filename: "a.txt", size: 3, contentHash: "h".repeat(64) };

  async function signed() {
    const keys = await CryptoModule.generateSigningKeyPair();
    const bundle = await CryptoModule.signFileMetadata(file, keys.privateKey);
    return { keys, bundle };
  }

  it("verifies a genuine signature over the same file", async () => {
    const { keys, bundle } = await signed();
    const result = await CryptoModule.verifyFileMetadataSignature(bundle, keys.publicKey);
    expect(result.valid).toBe(true);
    expect(await CryptoModule.signedMetadataMatchesFile(result.metadata, file)).toBe(true);
  });

  it("rejects a signature from a different key", async () => {
    const { bundle } = await signed();
    const other = await CryptoModule.generateSigningKeyPair();
    const result = await CryptoModule.verifyFileMetadataSignature(bundle, other.publicKey);
    expect(result.valid).toBe(false);
  });

  it("rejects altered signed data", async () => {
    const { keys, bundle } = await signed();
    const forged = { ...bundle, signedData: btoa('{"size":999}') };
    const result = await CryptoModule.verifyFileMetadataSignature(forged, keys.publicKey);
    expect(result.valid).toBe(false);
  });

  it.each([
    ["content", { contentHash: "x".repeat(64) }],
    ["size", { size: 4 }],
    ["filename", { filename: "b.txt" }],
  ])("a valid signature doesn't cover a file with a different %s", async (_name, change) => {
    const { keys, bundle } = await signed();
    const { metadata } = await CryptoModule.verifyFileMetadataSignature(bundle, keys.publicKey);
    expect(
      await CryptoModule.signedMetadataMatchesFile(metadata, { ...file, ...change }),
    ).toBe(false);
  });
});

describe("fingerprints", () => {
  it("doesn't depend on JWK key order", async () => {
    const a = await CryptoModule.generateKeyFingerprint({ kty: "EC", x: "1", y: "2" });
    const b = await CryptoModule.generateKeyFingerprint({ y: "2", x: "1", kty: "EC" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("identity backups", () => {
  const secrets = { identity: { privateKey: "secret" } };

  it("round-trips with the right password at the current strength", async () => {
    const backup = await CryptoModule.encryptBackup(secrets, "correct horse");
    expect(backup.iterations).toBe(600000);
    expect(JSON.stringify(backup)).not.toContain("secret");
    await expect(CryptoModule.decryptBackup(backup, "correct horse")).resolves.toEqual(secrets);
  });

  it("rejects the wrong password", async () => {
    const backup = await CryptoModule.encryptBackup(secrets, "correct horse");
    await expect(CryptoModule.decryptBackup(backup, "wrong")).rejects.toThrow(
      "Incorrect password",
    );
  });

  it("still restores old backups made with 100,000 iterations", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await subtle.importKey(
      "raw",
      new TextEncoder().encode("old password"),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const data = await subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(secrets)),
    );
    const oldBackup = {
      salt: Array.from(salt),
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(data)),
    };

    await expect(CryptoModule.decryptBackup(oldBackup, "old password")).resolves.toEqual(secrets);
  });

  it.each([[1], [1e12], ["600000"]])("refuses an iteration count of %s", async (iterations) => {
    const backup = await CryptoModule.encryptBackup(secrets, "pw");
    await expect(
      CryptoModule.decryptBackup({ ...backup, iterations }, "pw"),
    ).rejects.toThrow();
  });
});
