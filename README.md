# Secure File Sharing System

I’m building a zero-knowledge, end-to-end encrypted web app for sharing files securely. Files are encrypted **in the browser** with a random AES-GCM key per file. For each recipient I wrap that file key to their public key, so the server only stores ciphertext and wrapped keys. I use WebAuthn passkeys (with TOTP as a fallback), RBAC for authorization, expiring/revocable share links, and a tamper-evident audit log (hash-chained entries).

I’m starting **without Docker** to keep momentum. I run the frontend and backend locally, use **SQLite** during development, and store ciphertext on disk. I can add Nginx, PostgreSQL and MinIO later once the core features are stable.

---

## My chosen stack (why I picked it)

- **Backend: Node.js + Express (JavaScript)** — single language front to back, fast to iterate, great ecosystem for auth/crypto, and solid streaming support for large uploads. Easier for me to read/maintain since I already know JavaScript.
- **Frontend: Vanilla JS + HTML/CSS** — I don’t need React/TypeScript to ship this. I’ll use modern ES modules and the Web Crypto API directly for client-side encryption.
- **Styling:** plain CSS (I might add a tiny classless CSS later).
- **Auth:** WebAuthn passkeys (plus TOTP fallback). I’ll keep the flow simple and well-documented.
- **Storage:** local `storage/` folder in dev; switchable to S3/MinIO later.

If I have spare time near the end, I can optionally move the frontend to a framework. Not required for my goals.

---

## How it works (short version)

- **Client-side encryption**: per-file AES-GCM; filenames/metadata can be encrypted too.
- **Key wrapping**: each recipient gets a copy of the file key wrapped to their public key (X25519 + HKDF, or equivalent).
- **Server role**: stores ciphertext, wrapped keys, and access control; cannot read file contents.
- **Auth**: WebAuthn passkeys (TOTP fallback).
- **Links**: time-limited share links; revocation stops future access.
- **Audit**: append-only log with `prev_hash → hash` to detect tampering.

---

## Architecture (current dev setup)

```
Browser (Vanilla JS + Web Crypto)
        ⇅ HTTPS
Backend API (Node.js + Express)
        ├── SQLite (dev)  → switchable to PostgreSQL later
        └── storage/ (ciphertext blobs on disk) → switchable to S3/MinIO later
```

Cleartext never leaves the browser. Only recipients with the right private key can unwrap the file key and decrypt.

---

## Getting started (no Docker)

### Prerequisites

- Node.js 20+
- Git

### 1) Clone and set up

```bash
git clone <your-repo-url>.git sfs
cd sfs
```

#### Backend (Node + Express)

```bash
cd backend
npm init -y
npm i express zod jose cookie-parser cors dotenv pino pino-pretty
npm i -D nodemon
# Add a dev script to package.json:
# "scripts": { "dev": "nodemon --ext js,json --watch src --exec node src/index.js" }
mkdir -p src/{routes,services,crypto} public
cp .env.example .env
npm run dev
```

Backend runs at `http://localhost:8080` (or whatever `PORT` you set). It also serves static files from `backend/public/` for now.

#### Frontend (Vanilla JS)

I’ll keep HTML/CSS/JS in `backend/public/` initially so I don’t need a separate dev server. If I add a bundler later, I’ll document it here.

Open the app at `http://localhost:8080`.

### 2) Environment variables

Create `backend/.env` based on this example.

**backend/.env.example**

```
APP_ENV=development
PORT=8080

# SQLite path for dev (used by whichever DB library I wire up)
SQLITE_PATH=./dev.db

# Storage for ciphertext blobs
STORAGE_DIR=../storage

# Sessions / secrets
SESSION_SECRET=change-me

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
```

---

## Repository layout (what I actually use)

```
/backend
  ├─ src/
  │  ├─ index.js        # Express bootstrap
  │  ├─ routes/         # auth, files, shares, audit
  │  ├─ services/       # key wrap, audit log, RBAC, link logic
  │  └─ crypto/         # thin wrappers around Web Crypto-compatible formats
  ├─ public/            # HTML/CSS/JS (served statically)
  ├─ .env.example
  └─ package.json
/storage           # ciphertext blobs (dev only; gitignored)
/docs
  ├─ architecture.md
  ├─ threat-model.md
  └─ api.md
README.md
```

---

## Notes on security choices

- **Zero-knowledge**: encryption/decryption only in the browser; server keeps ciphertext.
- **Keys**: per-file symmetric keys; per-recipient wrapped keys for sharing.
- **Sessions**: HttpOnly, SameSite cookies; short TTL; rotate on login; CSRF protection on state-changing routes.
- **Headers**: strict CSP + SRI for static assets (I’ll add via Express middleware or later with Nginx).
- **Abuse controls**: rate limits on auth and downloads; size caps; basic IP throttling.
- **Limits**: revocation can’t delete copies users already saved; some metadata (sizes/timestamps) may still leak unless I encrypt filenames and pad sizes.

---

## My near-term plan

- Express skeleton + routes; WebAuthn and TOTP flows
- Browser keypair generation; encrypted recovery bundle for multi-device use
- Upload (chunked), client-side AES-GCM, store ciphertext in `/storage`
- Download + decrypt in browser
- Sharing UI (select user → wrap key → create expiring link)
- Audit trail with hash chaining and a small verifier script
- Tests: unit (crypto wrappers/RBAC), integration (share/revoke), and a simple throughput check

Later, I’ll:

- switch SQLite → PostgreSQL,
- move storage → MinIO/S3,
- add Nginx in front for TLS, headers, and rate limiting,
- and package everything for the demo.

---

## License

Private coursework during development. I’ll decide on a license (e.g., MIT) before any public release.
