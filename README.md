# 🔐 CrypShare

**Zero-Knowledge End-to-End Encrypted File Sharing with Hybrid Access Control**

CrypShare is a secure file sharing application that implements true zero-knowledge encryption with hybrid access control. Files are encrypted entirely in your browser before being uploaded—the server never sees your data or encryption keys.

![Node.js](https://img.shields.io/badge/Node.js-20.x-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-5.x-lightgrey?logo=express)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

### Core Security

- **🔒 True Zero-Knowledge Architecture** — The server only stores encrypted binary blobs. It never has access to your files, filenames, or encryption keys.
- **🔐 AES-256-GCM Encryption** — Military-grade encryption performed entirely in your browser using the Web Crypto API.
- **📦 Chunked Encryption** — Files up to 1GB are processed in 64KB chunks for memory efficiency.

### Access Control

- **🔗 Link-Based Access** — Encryption keys stored in URL fragment (`#`), never sent to server. Anyone with the link can decrypt.
- **👤 Identity-Based Access** — Encrypt files for specific recipients using ECDH public-key cryptography. Only designated recipients can decrypt.
- **🔀 Hybrid Mode** — Combine both methods for flexible access control.

### Authenticity

- **✍️ Digital Signatures** — Sign files with ECDSA to cryptographically prove you uploaded them.
- **✅ Signature Verification** — Recipients can verify file authenticity and detect tampering.

### User Experience

- **🌐 No Account Required** — For link-based sharing, just upload and share. No sign-ups, no tracking.
- **📁 Original Filename Preservation** — Filenames are encrypted and embedded in the payload.
- **⚠️ Smart Validation** — Prevents uploading files that cannot be decrypted.
- **🐳 Docker Ready** — One-command deployment.

---

## 🏗️ Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Client)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • Generate AES-256-GCM key + random IV                          │   │
│  │  • Encrypt file in 64KB chunks                                   │   │
│  │  • (Optional) Encrypt key for recipients with ECDH               │   │
│  │  • (Optional) Sign metadata with ECDSA                           │   │
│  │  • Upload encrypted blob to server                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           SERVER (Zero-Knowledge)                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • Stores encrypted binary blobs                                 │   │
│  │  • Stores encrypted key bundles (for identity-based access)      │   │
│  │  • Stores digital signatures (for verification)                  │   │
│  │  • NEVER decrypts or processes file contents                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cryptographic Primitives

| Algorithm         | Purpose            | Key Size | Notes                                          |
| ----------------- | ------------------ | -------- | ---------------------------------------------- |
| **AES-256-GCM**   | File encryption    | 256 bits | Authenticated encryption with tamper detection |
| **ECDH (P-256)**  | Key exchange       | 256 bits | Identity-based access, ~128-bit security       |
| **ECDSA (P-256)** | Digital signatures | 256 bits | File authenticity verification                 |
| **SHA-256**       | Hashing            | 256 bits | Content integrity, key fingerprints            |

---

## 🔄 Access Models

### Model A: Link-Based Access

```
Upload:  File → AES Key → Encrypt → Upload → Link with #key
Download: Link → Extract #key → Fetch blob → Decrypt → File
```

- Anyone with the link can decrypt
- Key is in URL fragment (never sent to server)
- Simple, capability-based security

### Model B: Identity-Based Access

```
Upload:  File → AES Key → Encrypt → For each recipient: ECDH → Encrypt AES key
Download: Fetch metadata → Find our key bundle → ECDH → Decrypt AES key → Decrypt file
```

- Only designated recipients can decrypt
- Private keys never leave the browser
- Ephemeral keys provide forward secrecy

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20.x or higher
- npm (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/Iosif-Christogeorgos/Individual-Project.git
cd Individual-Project

# Install dependencies
cd backend
npm install

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Development Mode

```bash
npm run dev  # Auto-reload on changes
```

---

## 🐳 Docker Deployment

```bash
# Build and run
docker build -t crypshare .
docker run -p 8080:8080 crypshare
```

The app will be available at [http://localhost:8080](http://localhost:8080).

---

## 📁 Project Structure

```
Individual-Project/
├── backend/
│   ├── server.js          # Express server (zero-knowledge storage)
│   ├── package.json       # Backend dependencies
│   ├── uploads/           # Encrypted file blobs
│   ├── metadata/          # File metadata (encrypted keys, signatures)
│   └── pubkeys/           # Registered public keys
├── frontend/
│   ├── index.html         # Upload page
│   ├── download.html      # Download page
│   ├── crypto.js          # Cryptographic primitives
│   ├── identity.js        # Identity/key management (IndexedDB)
│   ├── upload.js          # Upload & encryption logic
│   ├── download.js        # Download & decryption logic
│   ├── styles.css         # Main styles
│   └── styles-identity.css # Identity panel styles
├── Dockerfile             # Container configuration
├── LICENSE                # MIT License
└── README.md              # This file
```

---

## 🔌 API Reference

### File Operations

| Method | Endpoint            | Description                |
| ------ | ------------------- | -------------------------- |
| `POST` | `/upload`           | Upload encrypted file blob |
| `GET`  | `/download/:fileId` | Download encrypted file    |
| `HEAD` | `/download/:fileId` | Check file existence       |

### Metadata Operations

| Method | Endpoint            | Description            |
| ------ | ------------------- | ---------------------- |
| `POST` | `/metadata/:fileId` | Store file metadata    |
| `GET`  | `/metadata/:fileId` | Retrieve file metadata |

---

## 🔐 Security Considerations

### What the Server Knows

- ✅ Encrypted file size
- ✅ Upload timestamp
- ✅ Random file ID

### What the Server Does NOT Know

- ❌ File contents
- ❌ Original filename
- ❌ File type
- ❌ Encryption keys
- ❌ Who downloads the file

### Threat Model

| Attack            | Mitigation                                       |
| ----------------- | ------------------------------------------------ |
| Malicious Server  | Cannot decrypt without keys                      |
| Database Breach   | Only ciphertext exposed                          |
| Man-in-the-Middle | TLS + client-side encryption                     |
| Link Leakage      | Key in URL fragment (never sent)                 |
| Replay Attacks    | Unique IV per chunk, signed timestamps           |
| File Tampering    | AES-GCM authentication tag rejects modifications |

---

## 🌐 Browser Compatibility

| Browser | Minimum Version |
| ------- | --------------- |
| Chrome  | 37+             |
| Firefox | 34+             |
| Safari  | 11+             |
| Edge    | 12+             |

> ⚠️ **HTTPS Required:** The Web Crypto API requires a secure context (HTTPS or localhost).

---

## 📝 Configuration

### File Size Limit

The default maximum file size is **1 GB**. To change this, edit `backend/server.js`:

```javascript
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // Change this value
  },
});
```

---

## 🛠️ Tech Stack

| Layer                | Technology                                |
| -------------------- | ----------------------------------------- |
| **Frontend**         | Vanilla JavaScript, HTML5, CSS3           |
| **Backend**          | Node.js, Express 5.x                      |
| **Encryption**       | Web Crypto API (AES-256-GCM, ECDH, ECDSA) |
| **Storage**          | IndexedDB (client), File system (server)  |
| **File Upload**      | Multer (up to 1GB)                        |
| **Containerization** | Docker                                    |

---

## 🚀 Future Roadmap

- **WebRTC Peer-to-Peer** — Direct browser-to-browser file transfer
- **Key Revocation** — Mechanism to revoke compromised identity keys
- **Group Encryption** — Key hierarchy for team/group file sharing
- **Web Streams API** — True streaming encryption for unlimited file sizes

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

---

<p align="center">
  Made with ❤️ for privacy
</p>
