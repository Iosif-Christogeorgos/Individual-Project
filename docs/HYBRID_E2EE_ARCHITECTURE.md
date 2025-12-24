# CrypShare Hybrid E2EE Architecture

## Overview

CrypShare implements a **hybrid end-to-end encrypted (E2EE), zero-knowledge** file sharing system that supports two parallel access models:

1. **Link-Based Access** (Capability-Based) - Original behavior preserved
2. **Identity-Based Access** (Public-Key Cryptography) - New feature

Both models maintain strict zero-knowledge principles: the server never has access to plaintext data or encryption keys.

---

## Threat Model

### Assumptions

- **Client is trusted**: The user's browser executes cryptographic operations correctly
- **Server is untrusted**: The server is assumed to be potentially compromised or malicious
- **TLS is in place**: Transport layer security protects data in transit
- **WebCrypto is secure**: Browser's Web Crypto API provides secure random number generation and cryptographic primitives

### What the Server NEVER Sees

| Data Type                | Server Access                 |
| ------------------------ | ----------------------------- |
| Plaintext file contents  | ❌ NEVER                      |
| AES file encryption keys | ❌ NEVER                      |
| User private keys        | ❌ NEVER                      |
| URL fragments (#key)     | ❌ NEVER (not sent to server) |

### What the Server MAY Store

| Data Type                            | Server Access                                  |
| ------------------------------------ | ---------------------------------------------- |
| Encrypted file blobs                 | ✅ Yes (ciphertext only)                       |
| User public keys                     | ✅ Yes (for key discovery)                     |
| Encrypted AES keys (per recipient)   | ✅ Yes (encrypted with recipient's public key) |
| Digital signatures                   | ✅ Yes (for verification)                      |
| File metadata (filename, size, hash) | ✅ Optional (in metadata file)                 |

### Attack Scenarios Addressed

1. **Malicious Server**: Cannot decrypt files without keys
2. **Database Breach**: Only ciphertext is exposed
3. **Man-in-the-Middle**: TLS + client-side encryption provides defense in depth
4. **Link Leakage**: Link-based access is capability-based; key is in URL fragment (never sent to server)
5. **Replay Attacks**: Each chunk has unique IV; signatures include timestamps

---

## Cryptographic Primitives

### Data Encryption (Confidentiality)

| Algorithm       | Purpose         | Key Size | Notes                                        |
| --------------- | --------------- | -------- | -------------------------------------------- |
| **AES-256-GCM** | File encryption | 256 bits | Authenticated encryption, prevents tampering |

### Key Exchange (Identity-Based Access)

| Algorithm        | Purpose       | Curve | Notes                                   |
| ---------------- | ------------- | ----- | --------------------------------------- |
| **ECDH (P-256)** | Key agreement | P-256 | ~128-bit security, WebCrypto compatible |

### Digital Signatures (Authenticity)

| Algorithm         | Purpose              | Curve | Notes                    |
| ----------------- | -------------------- | ----- | ------------------------ |
| **ECDSA (P-256)** | Signing/verification | P-256 | Proves uploader identity |

### Hashing

| Algorithm   | Purpose                             |
| ----------- | ----------------------------------- |
| **SHA-256** | Content integrity, key fingerprints |

---

## Access Models

### Model A: Link-Based Access (Existing)

```
┌──────────────────────────────────────────────────────────────────┐
│                     LINK-BASED ACCESS FLOW                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. UPLOAD                                                       │
│     ┌─────────┐    ┌──────────┐    ┌─────────────┐              │
│     │  File   │───▶│ Generate │───▶│  Encrypt    │              │
│     │         │    │ AES Key  │    │  with AES   │              │
│     └─────────┘    └────┬─────┘    └──────┬──────┘              │
│                         │                  │                     │
│                         │                  ▼                     │
│                         │           ┌─────────────┐              │
│                         │           │   Upload    │              │
│                         │           │ Ciphertext  │              │
│                         │           └──────┬──────┘              │
│                         │                  │                     │
│                         ▼                  ▼                     │
│                   ┌─────────────────────────────┐                │
│                   │  Share Link:                │                │
│                   │  /download?id=X#<AES_KEY>   │                │
│                   └─────────────────────────────┘                │
│                                                                  │
│  2. DOWNLOAD                                                     │
│     ┌─────────────┐    ┌──────────────┐    ┌───────────┐        │
│     │ Extract Key │───▶│   Fetch      │───▶│  Decrypt  │        │
│     │ from URL #  │    │  Ciphertext  │    │  with AES │        │
│     └─────────────┘    └──────────────┘    └───────────┘        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Characteristics:**

- Anyone with the link can decrypt
- No user accounts or identities required
- Key is in URL fragment (never sent to server)
- Simple, capability-based security

### Model B: Identity-Based Access (New)

```
┌──────────────────────────────────────────────────────────────────┐
│                   IDENTITY-BASED ACCESS FLOW                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SETUP (One-time)                                             │
│     ┌───────────────────────────────────────────────┐            │
│     │  Generate ECDH Key Pair (for key exchange)    │            │
│     │  Generate ECDSA Key Pair (for signing)        │            │
│     │  Store in IndexedDB (private keys never leave)│            │
│     └───────────────────────────────────────────────┘            │
│                                                                  │
│  2. UPLOAD                                                       │
│     ┌─────────┐    ┌──────────┐    ┌─────────────┐              │
│     │  File   │───▶│ Generate │───▶│  Encrypt    │              │
│     │         │    │ AES Key  │    │  with AES   │              │
│     └─────────┘    └────┬─────┘    └──────┬──────┘              │
│                         │                  │                     │
│                         │                  ▼                     │
│                         │           ┌─────────────┐              │
│                         │           │   Upload    │              │
│                         │           │ Ciphertext  │              │
│                         │           └─────────────┘              │
│                         │                                        │
│                         ▼                                        │
│     For each recipient:                                          │
│     ┌────────────────────────────────────────────────┐          │
│     │  1. Generate ephemeral ECDH key pair           │          │
│     │  2. ECDH with recipient's public key           │          │
│     │  3. Derive shared key                          │          │
│     │  4. Encrypt AES file key with shared key       │          │
│     │  5. Store: {ephemeralPubKey, encryptedKey, IV} │          │
│     └────────────────────────────────────────────────┘          │
│                                                                  │
│  3. DOWNLOAD                                                     │
│     ┌─────────────┐    ┌──────────────────────────┐             │
│     │   Fetch     │───▶│ Find encrypted key for   │             │
│     │  Metadata   │    │ our fingerprint          │             │
│     └─────────────┘    └────────────┬─────────────┘             │
│                                     │                            │
│                                     ▼                            │
│     ┌────────────────────────────────────────────────┐          │
│     │  1. Import ephemeral public key                │          │
│     │  2. ECDH with our private key                  │          │
│     │  3. Derive shared key                          │          │
│     │  4. Decrypt AES file key                       │          │
│     │  5. Decrypt file with AES key                  │          │
│     └────────────────────────────────────────────────┘          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Characteristics:**

- Only designated recipients can decrypt
- Requires user identity (key pair)
- Private keys never leave the client
- Ephemeral keys provide forward secrecy
- Multiple recipients supported

---

## Data Structures

### Encrypted File Format

```
┌──────────────────────────────────────────────────┐
│              ENCRYPTED FILE BLOB                 │
├──────────────────────────────────────────────────┤
│  IV (12 bytes)  │  Ciphertext (variable)         │
│  ─────────────  │  ────────────────────────────  │
│  Random nonce   │  AES-GCM encrypted payload     │
└──────────────────────────────────────────────────┘
```

### Payload Format (Before Encryption)

```
┌──────────────────────────────────────────────────┐
│              PLAINTEXT PAYLOAD                   │
├──────────────────────────────────────────────────┤
│  Filename Length (2 bytes)  │  Filename  │ Data  │
│  ────────────────────────   │  ────────  │ ────  │
│  Big-endian uint16          │  UTF-8     │ Bytes │
└──────────────────────────────────────────────────┘
```

### File Metadata (Stored on Server)

```json
{
  "version": 2,
  "filename": "document.pdf",
  "size": 1048576,
  "contentHash": "sha256-hex-string",
  "timestamp": "2025-12-24T12:00:00.000Z",
  "accessModes": ["link", "identity"],

  "encryptedKeys": [
    {
      "recipientId": "abc123...",
      "recipientFingerprint": "sha256-of-recipient-pubkey",
      "ephemeralPublicKey": {
        /* JWK */
      },
      "encryptedKey": "base64-encrypted-aes-key",
      "iv": "base64-iv"
    }
  ],

  "signature": {
    "signerId": "xyz789...",
    "signerFingerprint": "sha256-of-signer-pubkey",
    "signerPublicKey": {
      /* JWK for ECDSA */
    },
    "signature": "base64-signature",
    "timestamp": "2025-12-24T12:00:00.000Z",
    "signedData": "base64-json-payload"
  }
}
```

### User Identity (Stored in IndexedDB)

```json
{
  "id": "32-hex-chars",
  "displayName": "Alice",
  "createdAt": "2025-12-24T12:00:00.000Z",
  "fingerprint": "sha256-hex-of-encryption-pubkey",

  "encryption": {
    "publicKey": {
      /* ECDH JWK */
    },
    "privateKey": {
      /* ECDH JWK - NEVER LEAVES CLIENT */
    }
  },

  "signing": {
    "publicKey": {
      /* ECDSA JWK */
    },
    "privateKey": {
      /* ECDSA JWK - NEVER LEAVES CLIENT */
    }
  }
}
```

### Public Identity (Safe to Share)

```json
{
  "id": "32-hex-chars",
  "displayName": "Alice",
  "encryptionPublicKey": {
    /* ECDH public JWK */
  },
  "signingPublicKey": {
    /* ECDSA public JWK */
  },
  "fingerprint": "sha256-hex"
}
```

---

## Client-Side Flows

### Flow 1: File Encryption & Upload

```
1. User selects file
2. Generate random AES-256 key
3. Read file into ArrayBuffer
4. Create payload: [2-byte filename length][filename][file data]
5. Generate random 12-byte IV
6. Encrypt payload with AES-GCM
7. Combine: [IV][ciphertext]
8. Upload blob to server → receive fileId

If identity-based access enabled:
9. For each recipient:
   a. Generate ephemeral ECDH key pair
   b. Derive shared key using recipient's public key
   c. Encrypt AES file key with shared key
   d. Store: {ephemeralPubKey, encryptedKey, iv}

If signing enabled:
10. Create signed metadata (filename, size, hash, timestamp)
11. Sign with ECDSA private key

12. Upload metadata to server (if identity/signature used)

If link-based access enabled:
13. Generate share link with key in fragment:
    /download?id={fileId}#{base64-aes-key}
Else:
13. Generate share link without key:
    /download?id={fileId}
```

### Flow 2: File Download & Decryption (Link-Based)

```
1. Extract fileId from URL query parameter
2. Extract AES key from URL fragment (#)
3. Fetch encrypted blob from server
4. Import AES key from base64
5. Extract IV (first 12 bytes) and ciphertext
6. Decrypt with AES-GCM
7. Parse payload: extract filename and content
8. Trigger browser download
```

### Flow 3: File Download & Decryption (Identity-Based)

```
1. Extract fileId from URL query parameter
2. Load user's identity from IndexedDB
3. Fetch file metadata from server
4. Find encryptedKey entry matching our fingerprint
5. Import ephemeral public key from metadata
6. ECDH: derive shared key with our private key
7. Decrypt AES file key using shared key
8. Fetch encrypted blob from server
9. Extract IV and ciphertext
10. Decrypt with recovered AES key
11. Parse payload and trigger download

If signature present:
12. Import signer's public key
13. Verify signature over metadata
14. Display verification result to user
```

### Flow 4: Identity Generation

```
1. Generate ECDH key pair (P-256)
2. Generate ECDSA key pair (P-256)
3. Compute fingerprint = SHA-256(ECDH public key JWK)
4. Create identity object
5. Store in IndexedDB
6. Export public identity (safe to share)
```

---

## API Endpoints

### File Operations

| Method | Endpoint            | Purpose                    |
| ------ | ------------------- | -------------------------- |
| POST   | `/upload`           | Upload encrypted file blob |
| GET    | `/download/:fileId` | Download encrypted file    |
| HEAD   | `/download/:fileId` | Check file existence       |

### Metadata Operations

| Method | Endpoint            | Purpose                                          |
| ------ | ------------------- | ------------------------------------------------ |
| POST   | `/metadata/:fileId` | Store file metadata (encrypted keys, signatures) |
| GET    | `/metadata/:fileId` | Retrieve file metadata                           |

### Public Key Directory (Optional)

| Method | Endpoint                  | Purpose               |
| ------ | ------------------------- | --------------------- |
| POST   | `/pubkey`                 | Register public key   |
| GET    | `/pubkey/:id`             | Get public key by ID  |
| GET    | `/pubkey/fingerprint/:fp` | Lookup by fingerprint |

---

## Security Considerations

### Why Ephemeral Keys?

Each encryption to a recipient uses a fresh ephemeral ECDH key pair. This provides:

- **Forward secrecy**: Compromising one message doesn't compromise others
- **No key reuse**: Each encryption is independent

### Why P-256?

- WebCrypto compatible (runs in all modern browsers)
- ~128-bit security level
- Well-tested, widely deployed

### Why Not RSA?

- RSA keys are much larger
- RSA encryption is limited to small data sizes
- ECC provides equivalent security with smaller keys
- Better performance for key exchange operations

### Signature Purpose

Signatures provide:

- **Authenticity**: Proof of who uploaded the file
- **Integrity**: Detection of any tampering
- **Non-repudiation**: Uploader cannot deny creating the file

Signatures do NOT provide:

- Confidentiality (signatures are public)
- Access control (anyone can verify)

---

## File Structure

```
frontend/
├── crypto.js          # Cryptographic primitives
├── identity.js        # Identity/key management
├── upload-hybrid.js   # Upload with hybrid access
├── download-hybrid.js # Download with hybrid access
├── index-hybrid.html  # Upload page
├── download-hybrid.html # Download page
├── styles.css         # Base styles
└── styles-hybrid.css  # Additional styles

backend/
├── server-hybrid.js   # Server with metadata support
├── uploads/           # Encrypted file blobs
├── metadata/          # File metadata JSON
└── pubkeys/           # Registered public keys
```

---

## Migration Notes

The hybrid system is **backward compatible**:

- Legacy links with `#key` fragments still work
- Legacy files without metadata still download correctly
- New features are additive, not breaking

To use the hybrid system:

1. Replace `server.js` with `server-hybrid.js`
2. Use `index-hybrid.html` and `download-hybrid.html`
3. Ensure `crypto.js` and `identity.js` are included

---

## Limitations & Future Work

### Current Limitations

- No key revocation mechanism
- No group key management
- File size limited to 1GB (chunked encryption for memory efficiency)
- No incremental hashing for very large files

### Potential Enhancements

- Web Streams API for truly streaming encryption
- Key rotation and revocation
- Group/team encryption with key hierarchy
- Server-side expiration enforcement
- Audit logging (while preserving zero-knowledge)
