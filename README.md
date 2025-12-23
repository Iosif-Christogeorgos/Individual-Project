# 🔐 CrypShare

**Zero-Knowledge End-to-End Encrypted File Sharing**

🌐 **Live Demo:** [https://crypshare.app](https://crypshare.app)

CrypShare is a secure file sharing application that implements true zero-knowledge encryption. Files are encrypted entirely in your browser before being uploaded—the server never sees your data or encryption keys.

![Node.js](https://img.shields.io/badge/Node.js-20.x-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-5.x-lightgrey?logo=express)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)
![Website](https://img.shields.io/badge/Website-crypshare.app-brightgreen?logo=google-chrome)

---

## ✨ Features

- **🔒 True Zero-Knowledge Architecture** — The server only stores encrypted binary blobs. It never has access to your files, filenames, or encryption keys.
- **🔐 AES-256-GCM Encryption** — Military-grade encryption performed entirely in your browser using the Web Crypto API.
- **🔗 Secure Key Exchange** — Encryption keys are stored in the URL fragment (`#`), which is never sent to the server.
- **📁 Original Filename Preservation** — Filenames are encrypted and embedded in the payload, so recipients get the original filename on download.
- **🌐 No Account Required** — Just upload, share the link, and the recipient can download. No sign-ups, no tracking.
- **🐳 Docker Ready** — One-command deployment with Docker.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Client)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. User selects file                                            │   │
│  │  2. Generate AES-256-GCM key + random IV                         │   │
│  │  3. Encrypt: [filename length][filename][file data]              │   │
│  │  4. Upload encrypted blob to server                              │   │
│  │  5. Receive fileId, generate share link with key in URL hash     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           SERVER (Zero-Knowledge)                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • Receives encrypted binary blob                                │   │
│  │  • Stores blob with unique fileId                                │   │
│  │  • Returns encrypted blob on request                             │   │
│  │  • NEVER decrypts, parses, or processes file contents            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### How It Works

1. **Upload Flow:**

   - User selects a file in the browser
   - Browser generates a random AES-256-GCM key and 12-byte IV
   - File is encrypted with the key (filename embedded in encrypted payload)
   - Encrypted blob (IV + ciphertext) is uploaded to the server
   - Server returns a unique `fileId`
   - Browser creates a share link: `/download?id={fileId}#{key}`

2. **Download Flow:**
   - Recipient opens the share link
   - Browser extracts `fileId` from query params and `key` from URL hash
   - Browser downloads the encrypted blob from the server
   - Browser decrypts the blob using the key
   - Original filename is extracted from the decrypted payload
   - File is downloaded to the user's device with the original name

> ⚠️ **Security Note:** The encryption key is stored in the URL fragment (`#`). URL fragments are never sent to the server, ensuring the server cannot decrypt the files.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20.x or higher
- npm (comes with Node.js)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Iosif-Christogeorgos/Individual-Project.git
   cd Individual-Project
   ```

2. **Install dependencies:**

   ```bash
   cd backend
   npm install
   ```

3. **Start the server:**

   ```bash
   npm start
   ```

4. **Open the app:**
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

### Development Mode

For development with auto-reload:

```bash
cd backend
npm run dev
```

---

## 🐳 Docker Deployment

### Build and Run with Docker

```bash
# Build the image
docker build -t crypshare .

# Run the container
docker run -p 8080:8080 crypshare
```

The app will be available at [http://localhost:8080](http://localhost:8080).

### Environment Variables

| Variable | Default                          | Description |
| -------- | -------------------------------- | ----------- |
| `PORT`   | `3000` (local) / `8080` (Docker) | Server port |

---

## 📁 Project Structure

```
Individual-Project/
├── backend/
│   ├── server.js          # Express server (zero-knowledge storage)
│   ├── package.json       # Backend dependencies
│   └── uploads/           # Encrypted file storage directory
├── frontend/
│   ├── index.html         # Upload page
│   ├── download.html      # Download page
│   ├── upload.js          # Client-side encryption logic
│   ├── download.js        # Client-side decryption logic
│   └── styles.css         # Styling
├── Dockerfile             # Container configuration
└── README.md              # This file
```

---

## 🔌 API Reference

### Upload Encrypted File

```http
POST /upload
Content-Type: multipart/form-data
```

| Parameter       | Type   | Description               |
| --------------- | ------ | ------------------------- |
| `encryptedFile` | `File` | The encrypted binary blob |

**Response:**

```json
{
  "success": true,
  "fileId": "file-1234567890-abc123def456.bin",
  "size": 102400
}
```

### Download Encrypted File

```http
GET /download/:fileId
```

| Parameter | Type     | Description                |
| --------- | -------- | -------------------------- |
| `fileId`  | `string` | The unique file identifier |

**Response:** Binary stream (`application/octet-stream`)

---

## 🔐 Security Considerations

### What the Server Knows

- ✅ File size (encrypted blob size)
- ✅ Upload timestamp
- ✅ File ID (random, reveals nothing)

### What the Server Does NOT Know

- ❌ File contents
- ❌ Original filename
- ❌ File type
- ❌ Encryption key
- ❌ Who downloads the file

### Encryption Details

- **Algorithm:** AES-256-GCM (Authenticated Encryption)
- **Key Length:** 256 bits
- **IV Length:** 96 bits (12 bytes)
- **Key Derivation:** Randomly generated per file
- **Implementation:** Web Crypto API (browser-native)

### Tamper Protection

AES-GCM provides **authenticated encryption**, which means:

- 🛡️ **Integrity Guaranteed** — If anyone modifies even a single bit of the encrypted file, decryption will fail
- 🔏 **Authenticity Verified** — The recipient can be certain the file hasn't been tampered with in transit
- ❌ **No Silent Corruption** — Unlike basic encryption modes, GCM will reject any altered ciphertext rather than producing garbage output

This makes it impossible for the server, network attackers, or anyone else to modify your files without detection.

### Recommendations

- Always share links over secure channels (Signal, encrypted email, etc.)
- Links are single-use in concept—anyone with the link can decrypt the file
- For sensitive files, consider setting up HTTPS in production

---

## 🌐 Browser Compatibility

CrypShare requires the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), which is available in:

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

The default maximum file size is **100 MB**. To change this, edit [backend/server.js](backend/server.js):

```javascript
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // Change this value
  },
});
```

---

## 🛠️ Tech Stack

| Layer                | Technology                      |
| -------------------- | ------------------------------- |
| **Frontend**         | Vanilla JavaScript, HTML5, CSS3 |
| **Backend**          | Node.js, Express 5.x            |
| **Encryption**       | Web Crypto API (AES-256-GCM)    |
| **File Upload**      | Multer                          |
| **Containerization** | Docker                          |

---

## 🚀 Future Roadmap

- **Stream-Based Encryption (Chunked AES-GCM)** — Refactor the encryption pipeline to process files in discrete chunks rather than loading entire files into memory. This will enable O(1) memory complexity, allowing the application to handle multi-gigabyte files without browser memory constraints. Each chunk will be independently encrypted with proper IV management to maintain security guarantees.

- **Asymmetric Cryptography (RSA/ECC Key Pairs)** — Implement public-key cryptography to enable recipient-specific encryption. Users will be able to encrypt files directly to a recipient's public key, eliminating the need to share secret keys via URL fragments. This decouples security from the link itself, allowing secure file sharing even over untrusted channels and enabling features like persistent user identities and encrypted group sharing.

- **WebRTC Peer-to-Peer** — Enable direct browser-to-browser file transfer using WebRTC data channels, eliminating the need for server-side storage entirely. Files will be encrypted and transmitted directly between peers, providing true end-to-end transfer with zero server knowledge. The server will only facilitate WebRTC signaling and peer discovery.

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
