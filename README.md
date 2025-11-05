# CrypShare — Zero-Knowledge Secure File Sharing System

> **CrypShare** is a web-based file sharing platform that provides **end-to-end encryption** with a strict **zero-knowledge** guarantee.
> All files are encrypted _client-side_ using the **Web Crypto API**, and the server only stores ciphertext.
> Access is controlled through **WebAuthn passkeys** (no passwords) and **per-recipient key wrapping** using secure ECDH key exchange.

## 1. Overview

Most cloud storage services rely on server-side encryption, meaning the provider can still access user data. CrypShare ensures privacy by encrypting files **before** they leave the user’s device. Private keys never leave the browser, making server breaches far less damaging.

## 2. Key Features

- **Zero-Knowledge Storage** — The server cannot read user files.
- **Client-Side Encryption** — AES-GCM encryption handled entirely in-browser.
- **Passwordless Authentication** — WebAuthn passkeys replace passwords.
- **Secure File Sharing** — Per-recipient key wrapping using **ECDH P-256 + HKDF**.
- **Access Control** — Owners can grant or revoke access at any time.
- **Tamper-Evident Logs** — Audit log entries are hash-chained to detect manipulation.
- **Modern UI** — Built with React, TypeScript, Vite, and Tailwind CSS.

## 3. Technology Stack

| Layer          | Technology                             |
| -------------- | -------------------------------------- |
| Frontend       | React + TypeScript + Vite              |
| Styling        | Tailwind CSS                           |
| Cryptography   | Web Crypto API (AES-GCM / ECDH / HKDF) |
| Authentication | WebAuthn Passkeys (`@simplewebauthn`)  |
| Backend        | Node.js + Express                      |
| Database       | SQLite (development)                   |
| Storage        | Encrypted file chunks in `/storage`    |
| Auditing       | Hash-linked log entries                |

## 4. Architecture

Browser (React + TS + Web Crypto) → HTTPS → Node.js (Express API) → SQLite + Encrypted Storage

## 5. Development Setup

### Backend

```
cd backend
npm install
cp .env.example .env
npm run dev
```

### Frontend

```
cd frontend
npm install
npm run dev
```

Open in browser:

```
http://localhost:5173
```

## 6. Security Principles

- No plaintext ever leaves the client.
- Private keys are stored securely in **IndexedDB**.
- AES-GCM is used with **unique IVs per file chunk**.
- Key sharing uses ECDH P-256 with HKDF to derive wrapping keys.
- WebAuthn eliminates password vulnerabilities entirely.
- Tamper-evident audit logs protect against silent data manipulation.

---

CrypShare is developed for academic and research purposes but follows real-world secure system architecture standards.
