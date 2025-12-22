// =============================================================================
// CrypShare Backend - Zero-Knowledge File Storage Server
// =============================================================================
// This server is intentionally "dumb" - it only stores and retrieves encrypted
// binary blobs. It never attempts to read, parse, or process file contents.
// =============================================================================

import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

// =============================================================================
// ESM Fix: Recreate __dirname (not available in ES Modules)
// =============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Configuration
// =============================================================================
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log("📁 Created uploads directory:", UPLOADS_DIR);
}

// =============================================================================
// Initialize Express App
// =============================================================================
const app = express();

// Enable CORS for frontend communication
app.use(cors());

// Parse JSON bodies (for potential future use)
app.use(express.json());

// Serve the 'public' folder (where your index.html and download.html live)
// Go UP one level ('..'), then into 'frontend'
app.use(express.static(path.join(__dirname, "../frontend")));

// =============================================================================
// Clean URL Routing - Serve HTML pages without .html extension
// =============================================================================

// Serve download.html at /download for clean URLs
app.get("/download", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/download.html"));
});

// =============================================================================
// Multer Configuration - Disk Storage
// =============================================================================

/**
 * Generate a unique filename with collision checking.
 * Uses crypto.randomBytes for high entropy, plus existence check for guarantee.
 * @returns {string} A unique filename that does not exist on disk
 */
function generateUniqueFilename() {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(16).toString("hex"); // 128 bits
    const filename = `file-${timestamp}-${randomBytes}.bin`;
    const fullPath = path.join(UPLOADS_DIR, filename);

    // Check if file already exists (should virtually never happen)
    if (!fs.existsSync(fullPath)) {
      return filename;
    }

    // Log if we ever hit this - would indicate a serious issue
    console.warn(
      `⚠️ Filename collision detected (attempt ${attempt + 1}): ${filename}`
    );
  }

  // If we somehow fail 10 times, throw an error rather than risk overwrite
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
    fileSize: 100 * 1024 * 1024, // 100MB limit (adjust as needed)
  },
});

// =============================================================================
// Routes
// =============================================================================

// Serve the main upload page at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// -----------------------------------------------------------------------------
// POST /upload - Accept encrypted file and return fileId
// -----------------------------------------------------------------------------
app.post("/upload", upload.single("encryptedFile"), (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error:
          'No file uploaded. Please send a file with field name "encryptedFile".',
      });
    }

    // Return the unique fileId (filename) to the client
    const fileId = req.file.filename;

    console.log(`✅ File uploaded: ${fileId} (${req.file.size} bytes)`);

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

// -----------------------------------------------------------------------------
// GET /download/:fileId - Retrieve and stream encrypted file
// -----------------------------------------------------------------------------
app.get("/download/:fileId", (req, res) => {
  try {
    const { fileId } = req.params;

    // Validate fileId format (must match our generated pattern)
    if (!/^file-\d+-[a-f0-9]+\.bin$/.test(fileId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid file ID format.",
      });
    }

    // Sanitize fileId to prevent directory traversal attacks
    const sanitizedFileId = path.basename(fileId);
    const filePath = path.join(UPLOADS_DIR, sanitizedFileId);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️ File not found: ${sanitizedFileId}`);
      return res.status(404).json({
        success: false,
        error: "File not found.",
      });
    }

    // Get file stats for content-length header
    const stats = fs.statSync(filePath);

    console.log(`📤 Downloading: ${sanitizedFileId} (${stats.size} bytes)`);

    // Set headers for binary download
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizedFileId}"`
    );
    res.setHeader("Content-Length", stats.size);

    // Stream the file to the client
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
// Error Handling Middleware
// =============================================================================

// Handle Multer errors (e.g., file too large)
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        error: "File too large. Maximum size is 100MB.",
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${error.message}`,
    });
  }
  next(error);
});

// Generic error handler
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
app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("🔐 CrypShare Backend Server");
  console.log("=".repeat(60));
  console.log(`🚀 Server running on port: ${PORT}`);
  console.log(`📁 Uploads directory: ${UPLOADS_DIR}`);
  console.log("=".repeat(60));
  console.log("Endpoints:");
  console.log(`  GET  /           - Serve upload page`);
  console.log(`  GET  /download   - Serve download page (clean URL)`);
  console.log(`  POST /upload     - Upload encrypted file`);
  console.log(`  GET  /download/:fileId - Download encrypted file`);
  console.log("=".repeat(60));
});
