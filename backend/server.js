// =============================================================================
// CrypShare Backend - Zero-Knowledge File Storage Server (Hybrid E2EE)
// =============================================================================
// CLOUD-NATIVE VERSION: Uses Supabase (Postgres) + Cloudflare R2 (S3-compatible)
// This enables stateless deployment (Docker, DigitalOcean, etc.)
//
// ZERO-KNOWLEDGE PRINCIPLES:
// - Server never sees plaintext file contents
// - Server never sees AES file keys
// - Server never sees private keys
// - Server MAY store: ciphertext, public keys, encrypted AES keys, signatures
// =============================================================================

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import { webcrypto } from "crypto";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { pipeline, PassThrough } from "stream";
import { promisify } from "util";

const pipelineAsync = promisify(pipeline);

// =============================================================================
// ESM Fix: Recreate __dirname
// =============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================
const PORT = process.env.PORT || 3000;
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

// Allowed expiry options (in hours) - validated on upload
const ALLOWED_EXPIRY_HOURS = [1, 6, 24, 72, 168]; // 1h, 6h, 24h, 3d, 7d

// =============================================================================
// Initialize Supabase Client
// =============================================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// =============================================================================
// Initialize Cloudflare R2 Client (S3-compatible)
// =============================================================================
const r2Endpoint = process.env.R2_ENDPOINT;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2BucketName = process.env.R2_BUCKET_NAME;

if (!r2Endpoint || !r2AccessKeyId || !r2SecretAccessKey || !r2BucketName) {
  console.error(
    "❌ Missing R2 configuration (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)",
  );
  process.exit(1);
}

const s3Client = new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
});

// =============================================================================
// File Cleanup / Garbage Collection (Database-driven)
// =============================================================================

const FILE_ID_PATTERN = /^file-[a-f0-9]{64}\.bin$/;

async function cleanupExpiredFiles() {
  const now = new Date().toISOString();
  let deletedCount = 0;

  try {
    // Query expired files from Supabase
    const { data: expiredFiles, error } = await supabase
      .from("files")
      .select("id")
      .lt("expires_at", now);

    if (error) {
      console.error("❌ Cleanup query error:", error.message);
      return;
    }

    if (!expiredFiles || expiredFiles.length === 0) {
      return; // No expired files
    }

    // Delete each file from R2 and database
    for (const file of expiredFiles) {
      try {
        // Delete from R2
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: r2BucketName,
            Key: file.id,
          }),
        );

        // Delete from database
        await supabase.from("files").delete().eq("id", file.id);

        deletedCount++;
        console.log(`🗑️  Expired file deleted: ${file.id}`);
      } catch (deleteError) {
        console.error(`❌ Failed to delete ${file.id}:`, deleteError.message);
      }
    }

    if (deletedCount > 0) {
      console.log(
        `🧹 Cleanup complete: ${deletedCount} expired file(s) removed`,
      );
    }
  } catch (error) {
    console.error("❌ Cleanup error:", error);
  }
}

// Run cleanup on startup and periodically
cleanupExpiredFiles();
setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL_MS);
console.log(
  `⏰ File cleanup scheduled: every ${CLEANUP_INTERVAL_MS / 60000} minutes`,
);

// =============================================================================
// Initialize Express App
// =============================================================================
const app = express();

// =============================================================================
// Trust Proxy (REQUIRED for reverse proxy deployments)
// =============================================================================
app.set("trust proxy", 1);

// =============================================================================
// CORS Configuration - Restrict to allowed origins
// =============================================================================
// Default origins include localhost for development AND production domain.
// This ensures the site works even if ALLOWED_ORIGINS env var is not set.
// Can be overridden via ALLOWED_ORIGINS environment variable (comma-separated).
const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://crypshare.app",
  "https://www.crypshare.app",
];

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : DEFAULT_ORIGINS;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`⚠️ CORS: Blocked request from origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "HEAD", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-File-Size"],
    credentials: false,
  }),
);

// Security Headers (CSP, X-Frame-Options, HSTS, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Note: 'unsafe-inline' is required for GSAP animation library which sets inline transform styles
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdn.jsdelivr.net",
        ],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(express.json({ limit: "100kb" }));

// =============================================================================
// Rate Limiting (DoS Protection)
// =============================================================================

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: "Too many uploads. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    error: "Too many downloads. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const metadataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    error: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// =============================================================================
// Canonical URL Redirect (www → non-www)
// =============================================================================
app.use((req, res, next) => {
  const host = req.headers.host || "";
  if (host.startsWith("www.")) {
    const newHost = host.substring(4);
    const protocol =
      req.headers["x-forwarded-proto"] || req.protocol || "https";
    const newUrl = `${protocol}://${newHost}${req.originalUrl}`;
    console.log(`🔄 Redirecting www to non-www: ${newUrl}`);
    return res.redirect(301, newUrl);
  }
  next();
});

// =============================================================================
// Static File Serving
// =============================================================================

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/favicon.ico"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.get("/download", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/download.html"));
});

// Quick Share page
app.get("/quick", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/quick.html"));
});

// Secure Share page
app.get("/secure", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/secure.html"));
});

app.use(express.static(path.join(__dirname, "../frontend")));

// =============================================================================
// Helper: Generate Unique File ID
// =============================================================================

function generateUniqueFileId() {
  // Use 32 bytes (256 bits) of pure randomness - no timestamp to prevent enumeration
  const randomBytes = crypto.randomBytes(32).toString("hex");
  return `file-${randomBytes}.bin`;
}

// =============================================================================
// Helper: Generate Upload Token (for metadata authorization)
// =============================================================================

function generateUploadToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashUploadToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// =============================================================================
// Database-backed Upload Token Storage (Horizontally Scalable)
// =============================================================================

/**
 * Store upload token in database (replaces in-memory Map)
 * @param {string} fileId - The file ID
 * @param {string} hashedToken - SHA-256 hash of the token
 */
async function storeUploadToken(fileId, hashedToken) {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  const { error } = await supabase.from("upload_tokens").upsert({
    file_id: fileId,
    token_hash: hashedToken,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("❌ Failed to store upload token:", error.message);
    throw new Error("Failed to store upload token");
  }
}

/**
 * Verify and consume upload token atomically (one-time use)
 * @param {string} fileId - The file ID
 * @param {string} token - The raw token to verify
 * @returns {boolean} True if token was valid and consumed
 */
async function verifyAndConsumeUploadToken(fileId, token) {
  const hashedToken = hashUploadToken(token);
  const { data, error } = await supabase.rpc("consume_upload_token", {
    p_file_id: fileId,
    p_token_hash: hashedToken,
  });
  if (error) {
    console.error("❌ Token verification error:", error.message);
    return false;
  }
  return data === true;
}

// Cleanup expired tokens periodically
setInterval(
  async () => {
    try {
      const { error } = await supabase
        .from("upload_tokens")
        .delete()
        .lt("expires_at", new Date().toISOString());
      if (error) console.error("❌ Token cleanup error:", error.message);
    } catch (e) {
      console.error("❌ Token cleanup error:", e.message);
    }
  },
  15 * 60 * 1000,
); // Every 15 minutes

// =============================================================================
// Ownership Nonce Tracking (Replay Attack Prevention)
// =============================================================================

/**
 * Verify nonce hasn't been used before and consume it atomically
 * @param {string} nonce - The nonce to check/consume
 * @returns {boolean} True if nonce was fresh and consumed
 */
async function consumeOwnershipNonce(nonce) {
  const { data, error } = await supabase.rpc("consume_ownership_nonce", {
    p_nonce: nonce,
  });
  if (error) {
    console.error("❌ Nonce consumption error:", error.message);
    return false;
  }
  return data === true;
}

// Cleanup old nonces periodically
setInterval(
  async () => {
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("ownership_nonces")
        .delete()
        .lt("used_at", tenMinutesAgo);
      if (error) console.error("❌ Nonce cleanup error:", error.message);
    } catch (e) {
      console.error("❌ Nonce cleanup error:", e.message);
    }
  },
  5 * 60 * 1000,
); // Every 5 minutes

// =============================================================================
// Multer Configuration (Memory storage for fallback /upload endpoint)
// =============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 750 * 1024 * 1024, // 750MB
  },
});

// =============================================================================
// Upload Endpoints
// =============================================================================

// POST /upload - Accept encrypted file via multipart form
// NOTE: On HTTPS (production), the frontend uses /upload-stream instead for large files.
// This endpoint is only used as fallback on HTTP or for smaller files.
app.post(
  "/upload",
  uploadLimiter,
  upload.single("encryptedFile"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file uploaded.",
        });
      }

      const fileId = generateUniqueFileId();
      const fileBuffer = req.file.buffer;

      // Generate upload token for metadata authorization
      const uploadToken = generateUploadToken();
      const hashedToken = hashUploadToken(uploadToken);

      // Upload to R2 first
      await s3Client.send(
        new PutObjectCommand({
          Bucket: r2BucketName,
          Key: fileId,
          Body: fileBuffer,
          ContentType: "application/octet-stream",
        }),
      );

      // Store token in database AFTER successful upload
      await storeUploadToken(fileId, hashedToken);

      res.status(201).json({
        success: true,
        fileId: fileId,
        size: req.file.size,
        uploadToken: uploadToken, // Client must provide this to set metadata
      });
    } catch (error) {
      console.error("❌ Upload error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error during upload.",
      });
    }
  },
);

// POST /upload-stream - Accept encrypted file via raw stream (for large files)
// MEMORY-EFFICIENT: Streams directly to R2 without buffering entire file in RAM
app.post("/upload-stream", uploadLimiter, async (req, res) => {
  const MAX_STREAM_SIZE = 750 * 1024 * 1024; // 750MB

  try {
    const fileId = generateUniqueFileId();

    // Check Content-Length header for early rejection (if provided)
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > MAX_STREAM_SIZE) {
      return res.status(413).json({
        success: false,
        error: "File too large. Maximum size is 750MB.",
      });
    }

    // Generate upload token for metadata authorization
    const uploadToken = generateUploadToken();
    const hashedToken = hashUploadToken(uploadToken);
    // Token will be stored after successful upload

    // Create a size-limiting transform stream to enforce max size even without Content-Length
    let bytesReceived = 0;
    const sizeLimitStream = new PassThrough();

    req.on("data", (chunk) => {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_STREAM_SIZE) {
        sizeLimitStream.destroy(new Error("File too large"));
        req.destroy();
      } else {
        sizeLimitStream.write(chunk);
      }
    });

    req.on("end", () => {
      sizeLimitStream.end();
    });

    req.on("error", (err) => {
      sizeLimitStream.destroy(err);
    });

    // Stream directly to R2 without buffering in memory
    // The Upload class handles multipart uploads automatically
    const uploadCmd = new Upload({
      client: s3Client,
      params: {
        Bucket: r2BucketName,
        Key: fileId,
        Body: sizeLimitStream,
        ContentType: "application/octet-stream",
      },
      queueSize: 4, // Concurrent upload parts
      partSize: 5 * 1024 * 1024, // 5MB part size
    });

    await uploadCmd.done();

    // Store token in database AFTER successful upload
    await storeUploadToken(fileId, hashedToken);

    res.status(201).json({
      success: true,
      fileId: fileId,
      size: bytesReceived,
      uploadToken: uploadToken, // Client must provide this to set metadata
    });
  } catch (error) {
    if (error.message === "File too large") {
      return res.status(413).json({
        success: false,
        error: "File too large. Maximum size is 750MB.",
      });
    }
    console.error("❌ Stream upload error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during upload.",
    });
  }
});

// =============================================================================
// Download Endpoints (Streaming from R2)
// =============================================================================

// HEAD /download/:fileId - Check if file exists
app.head("/download/:fileId", downloadLimiter, async (req, res) => {
  try {
    const fileId = req.params.fileId;

    if (!FILE_ID_PATTERN.test(fileId)) {
      return res.status(400).end();
    }

    const headResult = await s3Client.send(
      new HeadObjectCommand({
        Bucket: r2BucketName,
        Key: fileId,
      }),
    );

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", headResult.ContentLength);
    res.status(200).end();
  } catch (error) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      return res.status(404).end();
    }
    console.error("❌ HEAD request error:", error);
    res.status(500).end();
  }
});

// GET /download/:fileId - Download encrypted file
// MEMORY-EFFICIENT: Streams directly from R2 to client without buffering
app.get("/download/:fileId", downloadLimiter, async (req, res) => {
  try {
    const fileId = req.params.fileId;

    if (!FILE_ID_PATTERN.test(fileId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid file ID format.",
      });
    }

    const getResult = await s3Client.send(
      new GetObjectCommand({
        Bucket: r2BucketName,
        Key: fileId,
      }),
    );

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileId}"`);
    if (getResult.ContentLength) {
      res.setHeader("Content-Length", getResult.ContentLength);
    }

    // Stream directly from R2 to response - no buffering in memory!
    // AWS SDK v3 returns a readable stream
    const bodyStream = getResult.Body;

    if (typeof bodyStream.pipe === "function") {
      // Node.js Readable stream - use pipeline for proper error handling and backpressure
      // This is critical for HTTP/2 compatibility
      try {
        await pipelineAsync(bodyStream, res);
      } catch (pipeError) {
        // Client disconnected or stream error - don't log as error if client aborted
        if (pipeError.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          console.error("❌ Stream pipeline error:", pipeError.message);
        }
        // Response already ended by pipeline, don't send anything else
        return;
      }
    } else if (bodyStream.getReader) {
      // Web ReadableStream - use async iteration with proper drain handling
      const reader = bodyStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Handle backpressure - wait for drain if buffer is full
          const canContinue = res.write(value);
          if (!canContinue) {
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
        res.end();
      } catch (readerError) {
        console.error("❌ Stream reader error:", readerError.message);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: "Stream error" });
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      // Fallback: convert to buffer (shouldn't happen with current SDK)
      const byteArray = await bodyStream.transformToByteArray();
      res.send(Buffer.from(byteArray));
    }
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      console.log(`⚠️ File not found: ${req.params.fileId}`);
      return res.status(404).json({
        success: false,
        error: "File not found.",
      });
    }
    console.error("❌ Download error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during download.",
    });
  }
});

// =============================================================================
// Metadata Routes (Supabase)
// =============================================================================

/**
 * POST /metadata/:fileId - Store file metadata (encrypted keys, signatures)
 * Requires upload token from the original upload response for authorization.
 */
app.post("/metadata/:fileId", metadataLimiter, async (req, res) => {
  try {
    const fileId = req.params.fileId;

    if (!FILE_ID_PATTERN.test(fileId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid file ID format.",
      });
    }

    // Verify upload token (authorization check)
    const uploadToken = req.headers["x-upload-token"];
    if (!uploadToken) {
      return res.status(401).json({
        success: false,
        error:
          "Missing upload token. Metadata can only be set by the original uploader.",
      });
    }

    // Verify and consume token atomically (database-backed, one-time use)
    const tokenValid = await verifyAndConsumeUploadToken(fileId, uploadToken);
    if (!tokenValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired upload token.",
      });
    }

    // Verify file exists in R2
    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: r2BucketName,
          Key: fileId,
        }),
      );
    } catch (headError) {
      if (
        headError.name === "NotFound" ||
        headError.$metadata?.httpStatusCode === 404
      ) {
        return res.status(404).json({
          success: false,
          error: "File not found.",
        });
      }
      throw headError;
    }

    const metadata = req.body;
    if (!metadata || typeof metadata !== "object") {
      return res.status(400).json({
        success: false,
        error: "Invalid metadata format.",
      });
    }

    // Security: Reject plaintext keys
    if (metadata.plaintextKey || metadata.rawKey || metadata.aesKey) {
      console.warn(
        "⚠️ SECURITY: Attempted to store plaintext key in metadata!",
      );
      return res.status(400).json({
        success: false,
        error: "Invalid metadata: plaintext keys are not allowed.",
      });
    }

    // Validate expiry hours
    let expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_MS).toISOString();
    if (metadata.expiryHours !== undefined) {
      const expiryHours = parseInt(metadata.expiryHours, 10);
      if (isNaN(expiryHours) || !ALLOWED_EXPIRY_HOURS.includes(expiryHours)) {
        return res.status(400).json({
          success: false,
          error: `Invalid expiry time. Allowed values: ${ALLOWED_EXPIRY_HOURS.join(", ")} hours.`,
        });
      }
      expiresAt = new Date(
        Date.now() + expiryHours * 60 * 60 * 1000,
      ).toISOString();
    }

    // Insert metadata to Supabase (zero-knowledge: no plaintext data stored)
    // SECURITY: Use insert (not upsert) to prevent metadata overwrite attacks
    console.log(`📝 Storing metadata for ${fileId} in Supabase...`);
    const { error } = await supabase.from("files").insert({
      id: fileId,
      size: metadata.size || 0,
      content_hash: metadata.contentHash || null,
      expires_at: expiresAt,
      metadata: metadata,
    });

    if (error) {
      // Check if this is a duplicate key error (metadata already exists)
      if (error.code === "23505") {
        console.warn(`⚠️ Metadata already exists for ${fileId}`);
        return res.status(409).json({
          success: false,
          error: "Metadata already set for this file.",
        });
      }
      console.error(
        "❌ Metadata storage error:",
        error.message,
        error.details,
        error.hint,
      );
      return res.status(500).json({
        success: false,
        error: "Failed to store metadata.",
      });
    }

    console.log(`✅ Metadata stored successfully for ${fileId}`);

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
 * GET /metadata/:fileId - Retrieve file metadata via secure RPC
 * Uses get_file_metadata RPC to prevent row enumeration attacks
 */
app.get("/metadata/:fileId", metadataLimiter, async (req, res) => {
  try {
    const fileId = req.params.fileId;

    if (!FILE_ID_PATTERN.test(fileId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid file ID format.",
      });
    }

    // Use RPC function instead of direct table access (prevents enumeration)
    const { data, error } = await supabase.rpc("get_file_metadata", {
      lookup_id: fileId,
    });

    if (error) {
      console.error("❌ Metadata RPC error:", error.message);
      return res.json(null);
    }

    // RPC returns array, get first result
    if (!data || data.length === 0) {
      // Return null for missing/expired metadata (normal for link-only uploads)
      return res.json(null);
    }

    res.json(data[0].metadata);
  } catch (error) {
    console.error("❌ Metadata retrieval error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error retrieving metadata.",
    });
  }
});

/**
 * DELETE /file/:fileId - Delete a file (requires valid upload token or deletion token)
 * Security: Only the original uploader can delete a file using the upload token
 * This must be called before metadata is set (while token is still valid)
 */
app.delete("/file/:fileId", metadataLimiter, async (req, res) => {
  try {
    const fileId = req.params.fileId;

    if (!FILE_ID_PATTERN.test(fileId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid file ID format.",
      });
    }

    // Verify upload token (authorization check) - requires token from upload
    const uploadToken = req.headers["x-upload-token"];
    if (!uploadToken) {
      return res.status(401).json({
        success: false,
        error:
          "Missing upload token. Files can only be deleted by the original uploader.",
      });
    }

    // Verify and consume token atomically
    const tokenValid = await verifyAndConsumeUploadToken(fileId, uploadToken);
    if (!tokenValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired upload token.",
      });
    }

    // Delete from R2
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: r2BucketName,
          Key: fileId,
        }),
      );
    } catch (deleteError) {
      if (
        deleteError.name !== "NotFound" &&
        deleteError.$metadata?.httpStatusCode !== 404
      ) {
        console.error(
          `❌ Failed to delete file from R2: ${fileId}`,
          deleteError.message,
        );
        return res.status(500).json({
          success: false,
          error: "Failed to delete file from storage.",
        });
      }
      // File already doesn't exist - continue to clean up metadata
    }

    // Delete metadata from database (if it exists)
    const { error: dbError } = await supabase
      .from("files")
      .delete()
      .eq("id", fileId);

    if (dbError) {
      console.warn(
        `⚠️ Failed to delete metadata for ${fileId}:`,
        dbError.message,
      );
      // Don't fail the request - file is already deleted from R2
    }

    console.log(`🗑️ File deleted by uploader: ${fileId}`);

    res.json({
      success: true,
      message: "File deleted successfully.",
    });
  } catch (error) {
    console.error("❌ File deletion error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during file deletion.",
    });
  }
});

// =============================================================================
// Public Key Directory Routes (Supabase-backed)
// =============================================================================
// Users can publish their public key with a unique username.
// Others can lookup by username or fingerprint.
// Trust model: Username is for convenience, fingerprint is for verification.

const pubkeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Compute fingerprint from ECDH public key (server-side verification)
 * @param {Object} publicKeyJWK - JWK format public key
 * @returns {string} SHA-256 hex fingerprint
 */
function computeFingerprint(publicKeyJWK) {
  // Canonical JSON representation (sorted keys)
  const canonical = JSON.stringify(
    publicKeyJWK,
    Object.keys(publicKeyJWK).sort(),
  );
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * POST /pubkey - Register/update a public key with username
 * Requires proof of ownership via signature challenge.
 */
app.post("/pubkey", pubkeyLimiter, async (req, res) => {
  try {
    const {
      id,
      username,
      encryptionPublicKey,
      signingPublicKey,
      fingerprint,
      ownershipProof,
    } = req.body;

    // Validate required fields
    if (!id || !encryptionPublicKey || !fingerprint || !username) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: id, username, encryptionPublicKey, fingerprint",
      });
    }

    // Validate ID format (32 hex chars)
    if (!/^[a-f0-9]{32}$/.test(id)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid ID format." });
    }

    // Validate username format (3-20 chars, alphanumeric + underscore, lowercase)
    const cleanUsername = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      return res.status(400).json({
        success: false,
        error:
          "Username must be 3-20 characters, lowercase letters, numbers, and underscores only.",
      });
    }

    // Validate fingerprint format (64 hex chars)
    if (!/^[a-fA-F0-9]{64}$/.test(fingerprint)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid fingerprint format." });
    }

    // Server-side fingerprint verification: compute from public key and compare
    const computedFingerprint = computeFingerprint(encryptionPublicKey);
    if (computedFingerprint.toLowerCase() !== fingerprint.toLowerCase()) {
      console.warn(
        `⚠️ Fingerprint mismatch: provided=${fingerprint}, computed=${computedFingerprint}`,
      );
      return res.status(400).json({
        success: false,
        error: "Fingerprint does not match public key.",
      });
    }

    // CRITICAL: Ownership verification is REQUIRED
    // The ownershipProof must be a valid ECDSA signature of (id + username + timestamp)
    if (!signingPublicKey || !ownershipProof) {
      return res.status(400).json({
        success: false,
        error:
          "Ownership proof required. Please provide signingPublicKey and ownershipProof.",
      });
    }

    try {
      const { signature, timestamp, nonce } = ownershipProof;

      if (!signature || !timestamp || !nonce) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid ownership proof format. Required: signature, timestamp, nonce.",
        });
      }

      // Validate nonce format (32 hex chars minimum)
      if (!/^[a-f0-9]{32,64}$/.test(nonce)) {
        return res.status(400).json({
          success: false,
          error: "Invalid nonce format.",
        });
      }

      // Reject if timestamp is too old (5 minute window)
      const proofTime = new Date(timestamp).getTime();
      if (
        isNaN(proofTime) ||
        Math.abs(Date.now() - proofTime) > 5 * 60 * 1000
      ) {
        return res.status(400).json({
          success: false,
          error: "Ownership proof expired. Please try again.",
        });
      }

      // CRITICAL: Check and consume nonce atomically to prevent replay attacks
      const nonceConsumed = await consumeOwnershipNonce(nonce);
      if (!nonceConsumed) {
        console.warn(
          `⚠️ Replay attack detected: nonce already used for @${cleanUsername}`,
        );
        return res.status(400).json({
          success: false,
          error: "Ownership proof already used. Please generate a new one.",
        });
      }

      // Construct the message that was signed: id + username + timestamp + nonce
      const message = `${id}:${cleanUsername}:${timestamp}:${nonce}`;
      const messageBuffer = Buffer.from(message, "utf-8");

      // Decode the base64 signature
      const signatureBuffer = Buffer.from(signature, "base64");

      // Import the signing public key using WebCrypto
      const publicKey = await webcrypto.subtle.importKey(
        "jwk",
        signingPublicKey,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      );

      // Verify the signature
      const isValid = await webcrypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signatureBuffer,
        messageBuffer,
      );

      if (!isValid) {
        console.warn(`⚠️ Invalid signature for @${cleanUsername}`);
        return res.status(401).json({
          success: false,
          error: "Invalid ownership proof signature.",
        });
      }

      console.log(
        `✅ Ownership verified for @${cleanUsername}: nonce=${nonce.substring(0, 8)}...`,
      );
    } catch (proofError) {
      console.error(
        `❌ Ownership proof verification failed for @${cleanUsername}:`,
        proofError.message,
      );
      return res.status(400).json({
        success: false,
        error: "Failed to verify ownership proof.",
      });
    }

    // Check if username is already taken by another user
    const { data: existingUsername } = await supabase
      .from("public_keys")
      .select("id")
      .eq("username", cleanUsername)
      .neq("id", id)
      .single();

    if (existingUsername) {
      return res.status(409).json({
        success: false,
        error: "Username already taken. Please choose another.",
      });
    }

    // Upsert public key to Supabase
    const { error } = await supabase.from("public_keys").upsert({
      id: id,
      username: cleanUsername,
      fingerprint: computedFingerprint.toLowerCase(), // Use server-computed fingerprint
      encryption_public_key: encryptionPublicKey,
      signing_public_key: signingPublicKey || null,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("❌ Public key registration error:", error.message);
      return res.status(500).json({
        success: false,
        error: "Failed to register public key.",
      });
    }

    console.log(
      `✅ Public key registered: @${cleanUsername} (${computedFingerprint.substring(0, 8)}...)`,
    );

    res.status(201).json({
      success: true,
      message: "Public key registered successfully.",
      username: cleanUsername,
      fingerprint: computedFingerprint.toLowerCase(), // Return computed fingerprint
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
 * GET /pubkey/username/:username - Lookup by username
 * Note: Uses constant-time response to prevent timing-based enumeration
 */
app.get("/pubkey/username/:username", pubkeyLimiter, async (req, res) => {
  const startTime = Date.now();
  const MIN_RESPONSE_TIME = 150; // Minimum response time in ms to mask timing differences

  try {
    const username = req.params.username.toLowerCase().trim();

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      // Still apply delay for invalid format
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_RESPONSE_TIME - elapsed),
        );
      }
      return res.status(400).json({
        success: false,
        error: "Invalid username format.",
      });
    }

    const { data, error } = await supabase
      .from("public_keys")
      .select(
        "id, username, fingerprint, encryption_public_key, signing_public_key",
      )
      .eq("username", username)
      .single();

    // Apply constant-time delay AFTER all operations complete
    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_RESPONSE_TIME - elapsed),
      );
    }

    if (error || !data) {
      // Return 404 with generic message (same timing as success due to delay above)
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    res.json({
      id: data.id,
      username: data.username,
      displayName: `@${data.username}`,
      fingerprint: data.fingerprint,
      encryptionPublicKey: data.encryption_public_key,
      signingPublicKey: data.signing_public_key,
    });
  } catch (error) {
    // Apply delay even on errors
    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_RESPONSE_TIME - elapsed),
      );
    }
    console.error("❌ Public key lookup error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

/**
 * GET /pubkey/fingerprint/:fingerprint - Lookup by fingerprint
 * Note: Uses constant-time response to prevent timing-based enumeration
 */
app.get("/pubkey/fingerprint/:fingerprint", pubkeyLimiter, async (req, res) => {
  const startTime = Date.now();
  const MIN_RESPONSE_TIME = 150; // Minimum response time in ms to mask timing differences

  try {
    const fingerprint = req.params.fingerprint.toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      // Still apply delay for invalid format
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_RESPONSE_TIME) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_RESPONSE_TIME - elapsed),
        );
      }
      return res.status(400).json({
        success: false,
        error: "Invalid fingerprint format.",
      });
    }

    const { data, error } = await supabase
      .from("public_keys")
      .select(
        "id, username, fingerprint, encryption_public_key, signing_public_key",
      )
      .eq("fingerprint", fingerprint)
      .single();

    // Apply constant-time delay AFTER all operations complete
    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_RESPONSE_TIME - elapsed),
      );
    }

    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: "Public key not found.",
      });
    }

    res.json({
      id: data.id,
      username: data.username,
      displayName: `@${data.username}`,
      fingerprint: data.fingerprint,
      encryptionPublicKey: data.encryption_public_key,
      signingPublicKey: data.signing_public_key,
    });
  } catch (error) {
    // Apply delay even on errors
    const elapsed = Date.now() - startTime;
    if (elapsed < MIN_RESPONSE_TIME) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_RESPONSE_TIME - elapsed),
      );
    }
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
app.get("/pubkey/:id", pubkeyLimiter, async (req, res) => {
  try {
    const id = req.params.id;

    if (!/^[a-f0-9]{32}$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID format.",
      });
    }

    const { data, error } = await supabase
      .from("public_keys")
      .select(
        "id, username, fingerprint, encryption_public_key, signing_public_key",
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: "Public key not found.",
      });
    }

    res.json({
      id: data.id,
      username: data.username,
      displayName: `@${data.username}`,
      fingerprint: data.fingerprint,
      encryptionPublicKey: data.encryption_public_key,
      signingPublicKey: data.signing_public_key,
    });
  } catch (error) {
    console.error("❌ Public key retrieval error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error.",
    });
  }
});

/**
 * GET /pubkey/check/:username - Check if username is available
 */
app.get("/pubkey/check/:username", pubkeyLimiter, async (req, res) => {
  try {
    const username = req.params.username.toLowerCase().trim();

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return res.json({ available: false, reason: "Invalid format" });
    }

    const { data } = await supabase
      .from("public_keys")
      .select("id")
      .eq("username", username)
      .single();

    res.json({ available: !data });
  } catch (error) {
    console.error("❌ Username check error:", error);
    res.json({ available: false, reason: "Error checking availability" });
  }
});

// =============================================================================
// Error Handling Middleware
// =============================================================================

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
  console.log(`☁️  Storage: Cloudflare R2 (${r2BucketName})`);
  console.log(`🗄️  Database: Supabase`);
});

// =============================================================================
// Graceful Shutdown
// =============================================================================
function gracefulShutdown(signal) {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("✅ HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("⚠️ Forcing shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
