// Boots the real server.js against the mock backend and exercises its HTTP API.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockBackend } from "./helpers/mock-backend.js";

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendDir = path.join(backendDir, "../frontend");
const PORT = 39872;
const BASE = `http://127.0.0.1:${PORT}`;
const ALL_ZERO_ID = `file-${"0".repeat(64)}.bin`;

let mock;
let server;
let serverOutput = "";
let clientCounter = 0;

// Each test gets its own client IP so rate limits don't leak between tests
function freshClient() {
  clientCounter += 1;
  return { "x-forwarded-for": `198.51.100.${clientCounter}` };
}

function postJson(url, body, headers = {}) {
  return fetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...freshClient(), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function uploadMultipart(bytes) {
  const form = new FormData();
  form.append("encryptedFile", new Blob([bytes]), "blob.bin");
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    body: form,
    headers: freshClient(),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function uploadStream(bytes) {
  const res = await fetch(`${BASE}/upload-stream`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...freshClient() },
    body: bytes,
  });
  expect(res.status).toBe(201);
  return res.json();
}

function fingerprintOf(jwk) {
  const canonical = JSON.stringify(jwk, Object.keys(jwk).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

async function createIdentity() {
  const subtle = globalThis.crypto.subtle;
  const ecdh = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
  ]);
  const signing = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const encryptionPublicKey = await subtle.exportKey("jwk", ecdh.publicKey);
  const fingerprint = fingerprintOf(encryptionPublicKey);
  return {
    id: fingerprint.slice(0, 32),
    fingerprint,
    encryptionPublicKey,
    signingPublicKey: await subtle.exportKey("jwk", signing.publicKey),
    signingPrivateKey: signing.privateKey,
  };
}

async function registerRequest(identity, username, signingIdentity = identity) {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(32).toString("hex");
  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingIdentity.signingPrivateKey,
    new TextEncoder().encode(`${identity.id}:${username}:${timestamp}:${nonce}`),
  );
  return {
    id: identity.id,
    username,
    fingerprint: identity.fingerprint,
    encryptionPublicKey: identity.encryptionPublicKey,
    signingPublicKey: signingIdentity.signingPublicKey,
    ownershipProof: {
      signature: Buffer.from(signature).toString("base64"),
      timestamp,
      nonce,
    },
  };
}

beforeAll(async () => {
  mock = await startMockBackend();
  server = spawn(process.execPath, ["server.js"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      SUPABASE_URL: mock.url,
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
      R2_ENDPOINT: mock.url,
      R2_ACCESS_KEY_ID: "test",
      R2_SECRET_ACCESS_KEY: "test",
      R2_BUCKET_NAME: "crypshare-test",
      ALLOWED_ORIGINS: "http://localhost:3000",
    },
  });
  server.stdout.on("data", (data) => (serverOutput += data));
  server.stderr.on("data", (data) => (serverOutput += data));

  for (let i = 0; i < 100 && !serverOutput.includes("running on port"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(serverOutput).toContain("running on port");
}, 20000);

afterAll(async () => {
  server?.kill();
  await mock?.close();
});

describe("static pages", () => {
  it.each(["/", "/quick", "/secure", "/download"])("serves %s", async (page) => {
    const res = await fetch(`${BASE}${page}`, { headers: freshClient() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it.each(["index.html", "quick.html", "secure.html", "download.html"])(
    "%s only references files that exist",
    (page) => {
      const html = fs.readFileSync(path.join(frontendDir, page), "utf8");
      const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
        .map((match) => match[1])
        .filter((ref) => !/^(https?:|mailto:|data:)/.test(ref))
        .filter((ref) => !["/", "/quick", "/secure", "/download"].includes(ref));

      for (const ref of refs) {
        expect(fs.existsSync(path.join(frontendDir, ref)), ref).toBe(true);
      }
    },
  );

  it("sends security headers and blocks inline scripts", async () => {
    const res = await fetch(`${BASE}/`, { headers: freshClient() });
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // The referrer must not leak: share links carry IDs in the query string
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("redirects /favicon.ico instead of failing", async () => {
    const res = await fetch(`${BASE}/favicon.ico`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/favicon.svg");
  });
});

describe("CORS", () => {
  it("allows configured origins", async () => {
    const res = await fetch(`${BASE}/upload`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects other origins with 403", async () => {
    const res = await fetch(`${BASE}/metadata/abc`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });
});

describe("upload and download", () => {
  it("round-trips a multipart upload byte for byte", async () => {
    const bytes = crypto.randomBytes(1024 * 1024 + 17);
    const { fileId, size } = await uploadMultipart(bytes);
    expect(size).toBe(bytes.length);

    const head = await fetch(`${BASE}/download/${fileId}`, {
      method: "HEAD",
      headers: freshClient(),
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(bytes.length));

    const res = await fetch(`${BASE}/download/${fileId}`, { headers: freshClient() });
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("round-trips a large streamed upload through multipart R2 upload", async () => {
    const bytes = crypto.randomBytes(12 * 1024 * 1024 + 5);
    const { fileId, size } = await uploadStream(bytes);
    expect(size).toBe(bytes.length);

    const res = await fetch(`${BASE}/download/${fileId}`, { headers: freshClient() });
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  }, 30000);

  it("round-trips a small streamed upload", async () => {
    const bytes = crypto.randomBytes(10240);
    const { fileId } = await uploadStream(bytes);
    const res = await fetch(`${BASE}/download/${fileId}`, { headers: freshClient() });
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("rejects streams declaring more than 375MB", async () => {
    // fetch won't send a Content-Length that doesn't match its body
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`${BASE}/upload-stream`, {
        method: "POST",
        headers: { "content-length": 376 * 1024 * 1024, ...freshClient() },
      });
      req.on("response", (res) => {
        resolve(res.statusCode);
        req.destroy();
      });
      req.on("error", reject);
      req.write("x");
    });
    expect(status).toBe(413);
  });

  it("returns 400 for uploads without a file and for unexpected fields", async () => {
    const empty = await fetch(`${BASE}/upload`, {
      method: "POST",
      body: new FormData(),
      headers: freshClient(),
    });
    expect(empty.status).toBe(400);

    const wrong = new FormData();
    wrong.append("other", new Blob(["x"]), "a");
    const res = await fetch(`${BASE}/upload`, {
      method: "POST",
      body: wrong,
      headers: freshClient(),
    });
    expect(res.status).toBe(400);
  });

  it("validates file IDs and returns 404 for missing files", async () => {
    const bad = await fetch(`${BASE}/download/..%2f..%2fetc%2fpasswd`, {
      headers: freshClient(),
    });
    expect(bad.status).toBe(400);

    const missing = await fetch(`${BASE}/download/${ALL_ZERO_ID}`, {
      headers: freshClient(),
    });
    expect(missing.status).toBe(404);
  });

  it("only lets the uploader delete a file", async () => {
    const { fileId, uploadToken } = await uploadMultipart(crypto.randomBytes(64));

    const noToken = await fetch(`${BASE}/file/${fileId}`, {
      method: "DELETE",
      headers: freshClient(),
    });
    expect(noToken.status).toBe(401);

    const ok = await fetch(`${BASE}/file/${fileId}`, {
      method: "DELETE",
      headers: { "x-upload-token": uploadToken, ...freshClient() },
    });
    expect(ok.status).toBe(200);

    const gone = await fetch(`${BASE}/download/${fileId}`, {
      method: "HEAD",
      headers: freshClient(),
    });
    expect(gone.status).toBe(404);
  });
});

describe("metadata", () => {
  const fingerprint = "ab".repeat(32);
  const metadata = (overrides = {}) => ({
    size: 10,
    contentHash: "c".repeat(64),
    expiryHours: 24,
    accessModes: ["identity"],
    encryptedKeys: [
      {
        recipientFingerprint: fingerprint.toUpperCase(),
        ephemeralPublicKey: { kty: "EC" },
        encryptedKey: "ek",
        iv: "iv",
      },
    ],
    ...overrides,
  });

  it("stores metadata once and keeps recipient keys out of it", async () => {
    const { fileId, uploadToken } = await uploadMultipart(crypto.randomBytes(16));

    const noToken = await postJson(`/metadata/${fileId}`, metadata());
    expect(noToken.status).toBe(401);

    const ok = await postJson(`/metadata/${fileId}`, metadata(), {
      "x-upload-token": uploadToken,
    });
    expect(ok.status).toBe(201);

    const replay = await postJson(`/metadata/${fileId}`, metadata(), {
      "x-upload-token": uploadToken,
    });
    expect(replay.status).toBe(401);

    const stored = await (
      await fetch(`${BASE}/metadata/${fileId}`, { headers: freshClient() })
    ).json();
    expect(stored.encryptedKeys).toEqual([]);

    const key = await (
      await fetch(`${BASE}/recipient-key/${fileId}/${fingerprint}`, {
        headers: freshClient(),
      })
    ).json();
    expect(key.encryptedKey).toBe("ek");
  });

  it.each([
    ["HTML in expiryHours", { expiryHours: "24<svg onload=alert(1)>" }],
    ["unsupported expiry", { expiryHours: 5 }],
    ["non-numeric size", { size: "big" }],
    ["malformed content hash", { contentHash: "<b>nope</b>" }],
    ["encryptedKeys that isn't a list", { encryptedKeys: "nope" }],
    ["recipient key without fingerprint", { encryptedKeys: [{ encryptedKey: "x" }] }],
    ["plaintext key", { aesKey: "secret" }],
  ])("rejects %s", async (_name, overrides) => {
    const { fileId, uploadToken } = await uploadMultipart(crypto.randomBytes(16));
    const res = await postJson(`/metadata/${fileId}`, metadata(overrides), {
      "x-upload-token": uploadToken,
    });
    expect(res.status).toBe(400);
  });

  it("stores the validated expiry instead of what the uploader sent", async () => {
    const { fileId, uploadToken } = await uploadMultipart(crypto.randomBytes(16));
    const before = Date.now();
    await postJson(
      `/metadata/${fileId}`,
      metadata({ expiryHours: "1", expiresAt: "<script>" }),
      { "x-upload-token": uploadToken },
    );
    const stored = await (
      await fetch(`${BASE}/metadata/${fileId}`, { headers: freshClient() })
    ).json();
    expect(stored.expiryHours).toBe(1);
    expect(stored.expiresAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
  });

  it("returns null for unknown files", async () => {
    const res = await fetch(`${BASE}/metadata/${ALL_ZERO_ID}`, { headers: freshClient() });
    expect(await res.json()).toBeNull();
  });
});

describe("public key directory", () => {
  it("registers an identity and finds it by username, fingerprint and ID", async () => {
    const identity = await createIdentity();
    const res = await postJson("/pubkey", await registerRequest(identity, "alice_01"));
    expect(res.status).toBe(201);

    for (const url of [
      "/pubkey/username/alice_01",
      `/pubkey/fingerprint/${identity.fingerprint}`,
      `/pubkey/${identity.id}`,
    ]) {
      const found = await (await fetch(`${BASE}${url}`, { headers: freshClient() })).json();
      expect(found.fingerprint).toBe(identity.fingerprint);
    }

    const check = await fetch(`${BASE}/pubkey/check/alice_01`, { headers: freshClient() });
    expect(await check.json()).toEqual({ available: false });
  });

  it("rejects a signature made with a different key", async () => {
    const identity = await createIdentity();
    const attacker = await createIdentity();
    const request = await registerRequest(identity, "victim_02", attacker);
    request.signingPublicKey = identity.signingPublicKey;

    const res = await postJson("/pubkey", request);
    expect(res.status).toBe(401);
  });

  it("does not let anyone take over an existing identity", async () => {
    const victim = await createIdentity();
    await postJson("/pubkey", await registerRequest(victim, "victim_03"));

    // The victim's public key is public, so an attacker can compute the same ID
    // and sign with a key of their own
    const attacker = await createIdentity();
    const res = await postJson("/pubkey", await registerRequest(victim, "evil_03", attacker));
    expect(res.status).toBe(401);

    const row = mock.tables.public_keys.find((r) => r.id === victim.id);
    expect(row.username).toBe("victim_03");
    expect(row.signing_public_key.x).toBe(victim.signingPublicKey.x);
  });

  it("lets the owner re-register with their own key", async () => {
    const identity = await createIdentity();
    await postJson("/pubkey", await registerRequest(identity, "owner_04"));
    const res = await postJson("/pubkey", await registerRequest(identity, "owner_04b"));
    expect(res.status).toBe(201);
    const row = mock.tables.public_keys.find((r) => r.id === identity.id);
    expect(row.username).toBe("owner_04b");
  });

  it("rejects replayed proofs and taken usernames", async () => {
    const identity = await createIdentity();
    const request = await registerRequest(identity, "replay_05");
    expect((await postJson("/pubkey", request)).status).toBe(201);
    expect((await postJson("/pubkey", request)).status).toBe(400);

    const other = await createIdentity();
    const taken = await postJson("/pubkey", await registerRequest(other, "replay_05"));
    expect(taken.status).toBe(409);
  });

  it("rejects bad input with 400, not 500", async () => {
    const empty = await postJson("/pubkey", {});
    expect(empty.status).toBe(400);

    const wrongTypes = await postJson("/pubkey", {
      id: "a".repeat(32),
      username: 12345,
      fingerprint: "b".repeat(64),
      encryptionPublicKey: "nope",
    });
    expect(wrongTypes.status).toBe(400);

    const malformed = await postJson("/pubkey", "{oops");
    expect(malformed.status).toBe(400);
  });

  it("returns 413 for oversized JSON", async () => {
    const res = await postJson("/pubkey", { pad: "x".repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe("rate limiting", () => {
  it("limits per client and treats IPv4-mapped IPv6 as the same client", async () => {
    const ip = "203.0.113.9";
    const request = (forwardedFor) =>
      fetch(`${BASE}/pubkey/check/bob_01`, {
        headers: { "x-forwarded-for": forwardedFor },
      });

    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await request(ip)).status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(30);
    expect(statuses.at(-1)).toBe(429);

    expect((await request(`::ffff:${ip}`)).status).toBe(429);
    expect((await request("203.0.113.10")).status).toBe(200);
  });
});
