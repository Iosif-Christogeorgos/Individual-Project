// =============================================================================
// CrypShare Backend - Zero-Knowledge File Storage Server (Hybrid E2EE)
// =============================================================================
// This server is intentionally "dumb" - it only stores and retrieves encrypted
// binary blobs and metadata. It never attempts to decrypt or process file contents.
//
// ZERO-KNOWLEDGE PRINCIPLES:
// - Server never sees plaintext file contents
// - Server never sees AES file keys
// - Server never sees private keys
// - Server MAY store: ciphertext, public keys, encrypted AES keys, signatures
// =============================================================================

import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

// =============================================================================
// ESM Fix: Recreate __dirname
// =============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");
const METADATA_DIR = path.join(__dirname, "metadata");
const PUBKEYS_DIR = path.join(__dirname, "pubkeys");
const FILE_EXPIRY_HOURS = 24;
const DEFAULT_EXPIRY_MS = FILE_EXPIRY_HOURS * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

// Allowed expiry options (in hours) - validated on upload
const ALLOWED_EXPIRY_HOURS = [1, 6, 24, 72, 168]; // 1h, 6h, 24h, 3d, 7d

// Ensure directories exist
[UPLOADS_DIR, METADATA_DIR, PUBKEYS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log("📁 Created directory:", dir);
  }
});

// =============================================================================
// File Cleanup / Garbage Collection
// =============================================================================

function cleanupExpiredFiles() {
  const now = Date.now();
  let deletedCount = 0;

  try {
    // Clean up encrypted files
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const file of files) {
      const match = file.match(/^file-(\d+)-[a-f0-9]+\.bin$/);
      if (match) {
        const uploadTimestamp = parseInt(match[1], 10);
        
        // Check for custom expiry in metadata
        let expiresAt = uploadTimestamp + DEFAULT_EXPIRY_MS; // Default fallback
        
        const metadataPath = path.join(
          METADATA_DIR,
          file.replace(".bin", ".json")
        );
        
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
            if (metadata.expiresAt && typeof metadata.expiresAt === "number") {
              expiresAt = metadata.expiresAt;
            }
          } catch (parseError) {
            // Use default expiry if metadata is corrupted
          }
        }

        if (now > expiresAt) {
          const filePath = path.join(UPLOADS_DIR, file);
          const age = now - uploadTimestamp;

          try {
            fs.unlinkSync(filePath);
            deletedCount++;

            // Also delete associated metadata
            if (fs.existsSync(metadataPath)) {
              fs.unlinkSync(metadataPath);
            }

            console.log(
              `🗑️  Expired file deleted: ${file} (age: ${Math.round(
                age / 3600000
              )}h)`
            );
          } catch (deleteError) {
            // Handle file in use (EBUSY) or other deletion errors gracefully
            if (deleteError.code === "EBUSY" || deleteError.code === "ENOENT") {
              console.log(
                `⏳ Skipping file in use or already deleted: ${file}`
              );
            } else {
              console.error(
                `❌ Failed to delete ${file}:`,
                deleteError.message
              );
            }
          }
        }
      }
    }

    if (deletedCount > 0) {
      console.log(
        `🧹 Cleanup complete: ${deletedCount} expired file(s) removed`
      );
    }
  } catch (error) {
    console.error("❌ Cleanup error:", error);
  }
}

cleanupExpiredFiles();
setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL_MS);
console.log(
  `⏰ File cleanup scheduled: every ${CLEANUP_INTERVAL_MS / 60000} minutes`
);

// =============================================================================
// Initialize Express App
// =============================================================================
const app = express();

// CORS Configuration - Restrict to allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS: Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-File-Size'],
  credentials: false
}));

// Security Headers (CSP, X-Frame-Options, HSTS, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline onclick handlers
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for blob downloads
}));

app.use(express.json({ limit: "100kb" })); // Reduced limit for metadata JSON

// =============================================================================
// Rate Limiting (DoS Protection)
// =============================================================================

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per window per IP
  message: { success: false, error: "Too many uploads. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 downloads per window per IP
  message: { success: false, error: "Too many downloads. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const metadataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// =============================================================================
// Canonical URL Redirect (www → non-www)
// =============================================================================
// IndexedDB is isolated per origin, so we must ensure all users access the app
// from the same origin to share identity/storage. Redirect www to non-www.

app.use((req, res, next) => {
  const host = req.headers.host || "";

  // Only redirect in production (when host contains actual domain)
  if (host.startsWith("www.")) {
    const newHost = host.substring(4); // Remove 'www.'
    const protocol =
      req.headers["x-forwarded-proto"] || req.protocol || "https";
    const newUrl = `${protocol}://${newHost}${req.originalUrl}`;
    console.log(`🔄 Redirecting www to non-www: ${newUrl}`);
    return res.redirect(301, newUrl);
  }

  next();
});

// =============================================================================
// Clean URL Routing (MUST be before static middleware)
// =============================================================================

// Serve favicon (prevent 404 errors)
app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/favicon.ico"));
});

// Serve upload page at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Serve download page at /download
app.get("/download", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/download.html"));
});

// Serve the 'frontend' folder for static files (JS, CSS, etc.)
// This comes AFTER route definitions so routes take priority
app.use(express.static(path.join(__dirname, "../frontend")));

// =============================================================================
// Multer Configuration
// =============================================================================

function generateUniqueFilename() {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(16).toString("hex");
    const filename = `file-${timestamp}-${randomBytes}.bin`;
    const fullPath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(fullPath)) {
      return filename;
    }

    console.warn(`⚠️ Filename collision detected (attempt ${attempt + 1})`);
  }

  throw new Error("Failed to generate unique filename after maximum attempts");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    try {
      const uniqueFilename = generateUniqueFilename();
      cb(null, uniqueFilename);
    } catch (error) {
      cb(error);
    }
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB
  },
});

// =============================================================================
// File Upload/Download Routes
// =============================================================================

// POST /upload - Accept encrypted file
app.post("/upload", uploadLimiter, upload.single("encryptedFile"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded.",
      });
    }

    const fileId = req.file.filename;
    // [Log removed]

    res.status(201).json({
      success: true,
      fileId: fileId,
      size: req.file.size,
    });
  } catch (error) {
    console.error("❌ Upload error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during upload.",
    });
  }
});

// =============================================================================
// Streaming Upload Endpoint (Memory-Efficient for Large Files)
// =============================================================================

/**
 * POST /upload-stream - Accept encrypted file via streaming
 *
 * This endpoint receives the encrypted file as a raw stream, piping it
 * directly to disk without buffering the entire file in memory.
 * This enables uploads of any size (50GB+) with constant memory usage.
 *
 * Required headers:
 * - Content-Type: application/octet-stream
 * - X-File-Size: Expected file size (optional, for validation)
 */
app.post("/upload-stream", uploadLimiter, (req, res) => {
  const MAX_STREAM_SIZE = 1024 * 1024 * 1024; // 1GB - same as multer limit
  
  try {
    const filename = generateUniqueFilename();
    const filePath = path.join(UPLOADS_DIR, filename);

    // Create a write stream to disk
    const writeStream = fs.createWriteStream(filePath);
    let bytesReceived = 0;
    let sizeLimitExceeded = false;

    // Handle incoming data with size limit check
    req.on("data", (chunk) => {
      bytesReceived += chunk.length;
      
      // Check size limit
      if (bytesReceived > MAX_STREAM_SIZE && !sizeLimitExceeded) {
        sizeLimitExceeded = true;
        console.warn(`⚠️ Stream upload exceeded size limit: ${bytesReceived} bytes`);
        
        // Stop receiving data
        req.unpipe(writeStream);
        writeStream.destroy();
        
        // Clean up partial file
        fs.unlink(filePath, () => {});
        
        if (!res.headersSent) {
          res.status(413).json({
            success: false,
            error: "File too large. Maximum size is 1GB.",
          });
        }
      }
    });

    // Pipe the request body directly to the file
    req.pipe(writeStream);

    // Handle successful completion
    writeStream.on("finish", () => {
      if (!sizeLimitExceeded) {
        res.status(201).json({
          success: true,
          fileId: filename,
          size: bytesReceived,
        });
      }
    });

    // Handle write errors
    writeStream.on("error", (error) => {
      if (sizeLimitExceeded) return; // Already handled
      
      console.error("❌ Stream write error:", error);

      // Clean up partial file
      fs.unlink(filePath, () => {});

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Failed to write file to disk.",
        });
      }
    });

    // Handle request errors (client disconnect, etc.)
    req.on("error", (error) => {
      if (sizeLimitExceeded) return; // Already handled
      
      console.error("❌ Stream request error:", error);
      writeStream.destroy();

      // Clean up partial file
      fs.unlink(filePath, () => {});

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Upload stream interrupted.",
        });
      }
    });

    // Handle client abort
    req.on("aborted", () => {
      if (sizeLimitExceeded) return; // Already handled
      
      console.log("⚠️ Upload aborted by client");
      writeStream.destroy();

      // Clean up partial file
      fs.unlink(filePath, () => {});
    });
  } catch (error) {
    console.error("❌ Stream upload error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during stream upload.",
    });
  }
});

// Helper: Validate and resolve file path
function resolveFilePath(fileId) {
  if (!/^file-\d+-[a-f0-9]+\.bin$/.test(fileId)) {
    return { error: "Invalid file ID format.", status: 400 };
  }

  const sanitizedFileId = path.basename(fileId);
  const filePath = path.join(UPLOADS_DIR, sanitizedFileId);

  if (!fs.existsSync(filePath)) {
    return { error: "File not found.", status: 404, sanitizedFileId };
  }

  return { filePath, sanitizedFileId };
}

// HEAD /download/:fileId - Check if file exists
app.head("/download/:fileId", downloadLimiter, (req, res) => {
  try {
    const result = resolveFilePath(req.params.fileId);

    if (result.error) {
      return res.status(result.status).end();
    }

    const stats = fs.statSync(result.filePath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", stats.size);
    res.status(200).end();
  } catch (error) {
    console.error("❌ HEAD request error:", error);
    res.status(500).end();
  }
});

// GET /download/:fileId - Download encrypted file
app.get("/download/:fileId", downloadLimiter, (req, res) => {
  try {
    const result = resolveFilePath(req.params.fileId);

    if (result.error) {
      if (result.status === 404) {
        console.log(
          `⚠️ File not found: ${result.sanitizedFileId || req.params.fileId}`
        );
      }
      return res.status(result.status).json({
        success: false,
        error: result.error,
      });
    }

    const { filePath, sanitizedFileId } = result;
    const stats = fs.statSync(filePath);

    console.log(`📤 Downloading: ${sanitizedFileId} (${stats.size} bytes)`);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizedFileId}"`
    );
    res.setHeader("Content-Length", stats.size);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on("error", (error) => {
      console.error("❌ Stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Error streaming file.",
        });
      }
    });
  } catch (error) {
    console.error("❌ Download error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during download.",
    });
  }
});

// =============================================================================
// Metadata Routes (for hybrid E2EE)
// =============================================================================

/**
 * POST /metadata/:fileId - Store file metadata (encrypted keys, signatures)
 *
 * The server stores this metadata blindly - it cannot decrypt the file keys
 * because they are encrypted with recipient public keys.
 */
app.post("/metadata/:fileId", metadataLimiter, (req, res) => {
  try {
    const fileId = req.params.fileId;

    // Validate fileId format
    if (!/^file-\d+-[a-f0-9]+\.bin$/.test(fileId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid file ID format.",
      });
    }

    // Check if the file exists
    const filePath = path.join(UPLOADS_DIR, path.basename(fileId));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: "File not found.",
      });
    }

    // Validate metadata structure
    const metadata = req.body;
    if (!metadata || typeof metadata !== "object") {
      return res.status(400).json({
        success: false,
        error: "Invalid metadata format.",
      });
    }

    // Validate metadata doesn't contain plaintext secrets
    // (Server should never receive plaintext keys)
    if (metadata.plaintextKey || metadata.rawKey || metadata.aesKey) {
      console.warn(
        "⚠️ SECURITY: Attempted to store plaintext key in metadata!"
      );
      return res.status(400).json({
        success: false,
        error: "Invalid metadata: plaintext keys are not allowed.",
      });
    }

    // Validate expiry hours if provided
    if (metadata.expiryHours !== undefined) {
      const expiryHours = parseInt(metadata.expiryHours, 10);
      if (isNaN(expiryHours) || !ALLOWED_EXPIRY_HOURS.includes(expiryHours)) {
        return res.status(400).json({
          success: false,
          error: `Invalid expiry time. Allowed values: ${ALLOWED_EXPIRY_HOURS.join(', ')} hours.`,
        });
      }
    }

    // Store metadata
    const metadataFilename = fileId.replace(".bin", ".json");
    const metadataPath = path.join(METADATA_DIR, metadataFilename);

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    res.status(201).json({
      success: true,
      message: "Metadata stored successfully.",
    });
  } catch (error) {
    console.error("❌ Metadata storage error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error storing metadata.",
    });
  }
});

/**
 * GET /metadata/:fileId - Retrieve file metadata
 */
app.get("/metadata/:fileId", (req, res) => {
  try {
    const fileId = req.params.fileId;

    // Validate fileId format
    if (!/^file-\d+-[a-f0-9]+\.bin$/.test(fileId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid file ID format.",
      });
    }

    const metadataFilename = fileId.replace(".bin", ".json");
    const metadataPath = path.join(
      METADATA_DIR,
      path.basename(metadataFilename)
    );

    if (!fs.existsSync(metadataPath)) {
      // Return empty metadata instead of 404 to avoid browser console errors
      // This is normal for link-only uploads or legacy files
      return res.json(null);
    }

    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    } catch (parseError) {
      console.error("❌ Metadata parse error:", parseError);
      return res.status(500).json({
        error: "Metadata file is corrupted.",
      });
    }

    res.json(metadata);
  } catch (error) {
    console.error("❌ Metadata retrieval error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error retrieving metadata.",
    });
  }
});

// =============================================================================
// Public Key Directory Routes (Optional - for key discovery)
// =============================================================================

/**
 * POST /pubkey - Register a public key
 *
 * Users can optionally register their public key for discovery.
 * This enables others to find and share files with them.
 */
app.post("/pubkey", (req, res) => {
  try {
    const {
      id,
      displayName,
      encryptionPublicKey,
      signingPublicKey,
      fingerprint,
    } = req.body;

    if (!id || !encryptionPublicKey || !fingerprint) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: id, encryptionPublicKey, fingerprint",
      });
    }

    // Validate fingerprint matches the public key (client should compute this)
    // Server stores it but cannot verify without implementing crypto

    const pubkeyData = {
      id,
      displayName: displayName || `User-${fingerprint.substring(0, 8)}`,
      encryptionPublicKey,
      signingPublicKey,
      fingerprint,
      registeredAt: new Date().toISOString(),
    };

    const pubkeyPath = path.join(PUBKEYS_DIR, `${id}.json`);
    fs.writeFileSync(pubkeyPath, JSON.stringify(pubkeyData, null, 2));

    res.status(201).json({
      success: true,
      message: "Public key registered successfully.",
    });
  } catch (error) {
    console.error("❌ Public key registration error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

/**
 * GET /pubkey/fingerprint/:fingerprint - Lookup by fingerprint
 * NOTE: This route MUST come BEFORE /pubkey/:id to avoid Express matching "fingerprint" as an :id
 */
app.get("/pubkey/fingerprint/:fingerprint", (req, res) => {
  try {
    const fingerprint = req.params.fingerprint.toLowerCase();

    // Validate fingerprint format
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      return res.status(400).json({
        success: false,
        error: "Invalid fingerprint format.",
      });
    }

    // Search for matching public key
    const files = fs.readdirSync(PUBKEYS_DIR);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const pubkeyPath = path.join(PUBKEYS_DIR, file);
        try {
          const pubkeyData = JSON.parse(fs.readFileSync(pubkeyPath, "utf8"));

          if (pubkeyData.fingerprint === fingerprint) {
            return res.json(pubkeyData);
          }
        } catch (parseError) {
          console.error(`❌ Error parsing pubkey file ${file}:`, parseError);
          // Continue to next file
        }
      }
    }

    res.status(404).json({
      success: false,
      error: "Public key not found.",
    });
  } catch (error) {
    console.error("❌ Public key lookup error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

/**
 * GET /pubkey/:id - Retrieve a public key by ID
 */
app.get("/pubkey/:id", (req, res) => {
  try {
    const id = req.params.id;

    // Sanitize ID
    if (!/^[a-f0-9]{32}$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format.",
      });
    }

    const pubkeyPath = path.join(PUBKEYS_DIR, `${id}.json`);

    if (!fs.existsSync(pubkeyPath)) {
      return res.status(404).json({
        success: false,
        error: "Public key not found.",
      });
    }

    let pubkeyData;
    try {
      pubkeyData = JSON.parse(fs.readFileSync(pubkeyPath, "utf8"));
    } catch (parseError) {
      console.error("❌ Pubkey parse error:", parseError);
      return res.status(500).json({
        success: false,
        error: "Public key file is corrupted.",
      });
    }
    res.json(pubkeyData);
  } catch (error) {
    console.error("❌ Public key retrieval error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

// =============================================================================
// Error Handling Middleware
// =============================================================================

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        error: "File too large. Maximum size is 1GB.",
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${error.message}`,
    });
  }
  next(error);
});

app.use((error, req, res, next) => {
  console.error("❌ Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error.",
  });
});

// =============================================================================
// Start Server
// =============================================================================
const server = app.listen(PORT, () => {
  console.log(`🔐 CrypShare Server running on port ${PORT}`);
  console.log(`📁 Storage: ${UPLOADS_DIR}`);
});

// =============================================================================
// Graceful Shutdown
// =============================================================================
function gracefulShutdown(signal) {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('✅ HTTP server closed.');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

