// =============================================================================
// CrypShare - Identity Management Module (ES Module)
// =============================================================================
// Manages user identity (key pairs) with secure local storage using IndexedDB.
//
// SECURITY PRINCIPLES:
// - Private keys NEVER leave the client
// - Keys are stored in IndexedDB (not localStorage for security)
// - Public keys can be exported/shared
// - Identity is optional (link-based sharing still works without identity)
// =============================================================================

import * as CryptoModule from "./crypto.js";

// ===========================================================================
// Constants
// ===========================================================================

const DB_NAME = "CrypShareIdentity";
const DB_VERSION = 1;
const STORE_NAME = "identity";
const IDENTITY_KEY = "userIdentity";
const CONTACTS_KEY = "contacts";

// ===========================================================================
// IndexedDB Initialization
// ===========================================================================

/**
 * Open or create the IndexedDB database.
 * @returns {Promise<IDBDatabase>} The database connection
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!indexedDB) {
      reject(
        new Error(
          "IndexedDB is not available. Private browsing mode may be enabled.",
        ),
      );
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      const error = event.target.error;
      if (error?.name === "QuotaExceededError") {
        reject(
          new Error("Storage quota exceeded. Please free up browser storage."),
        );
      } else if (error?.name === "InvalidStateError") {
        reject(
          new Error(
            "Database is corrupted. Please clear site data and try again.",
          ),
        );
      } else {
        reject(
          new Error(
            "Failed to open identity database: " +
              (error?.message || "Unknown error"),
          ),
        );
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// ===========================================================================
// Identity Storage
// ===========================================================================

/**
 * Store identity in IndexedDB.
 * @param {Object} identity - The identity object to store
 * @returns {Promise<void>}
 */
async function storeIdentity(identity) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(identity, IDENTITY_KEY);

    request.onerror = () => reject(new Error("Failed to store identity"));
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Retrieve identity from IndexedDB.
 * @returns {Promise<Object|null>} The stored identity or null
 */
async function retrieveIdentity() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(IDENTITY_KEY);

    request.onerror = () => reject(new Error("Failed to retrieve identity"));
    request.onsuccess = () => resolve(request.result || null);

    transaction.oncomplete = () => db.close();
  });
}

// ===========================================================================
// Identity Generation & Management
// ===========================================================================

/**
 * Generate a new identity with ECDH and ECDSA key pairs.
 * @param {string} displayName - Optional display name for the identity
 * @returns {Promise<Object>} The generated identity
 */
export async function generateIdentity(displayName = "") {
  // Generate ECDH key pair (for key exchange / decryption)
  const ecdhKeyPair = await CryptoModule.generateECDHKeyPair();
  const ecdhPublicKeyJWK = await CryptoModule.exportECDHPublicKey(
    ecdhKeyPair.publicKey,
  );
  const ecdhPrivateKeyJWK = await CryptoModule.exportECDHPrivateKey(
    ecdhKeyPair.privateKey,
  );

  // Generate ECDSA key pair (for signing)
  const signingKeyPair = await CryptoModule.generateSigningKeyPair();
  const signingPublicKeyJWK = await CryptoModule.exportSigningPublicKey(
    signingKeyPair.publicKey,
  );
  const signingPrivateKeyJWK = await CryptoModule.exportSigningPrivateKey(
    signingKeyPair.privateKey,
  );

  // Generate fingerprint from ECDH public key
  const fingerprint =
    await CryptoModule.generateKeyFingerprint(ecdhPublicKeyJWK);

  // SECURITY: Derive ID from fingerprint (first 32 chars)
  // This cryptographically binds the ID to the encryption public key,
  // preventing ID hijacking attacks where an attacker could claim another user's ID
  const id = fingerprint.slice(0, 32);

  // Create identity object
  const identity = {
    id: id,
    displayName: displayName || `User-${fingerprint.substring(0, 8)}`,
    createdAt: new Date().toISOString(),

    // ECDH keys (for receiving encrypted file keys)
    encryption: {
      publicKey: ecdhPublicKeyJWK,
      privateKey: ecdhPrivateKeyJWK,
    },

    // ECDSA keys (for signing)
    signing: {
      publicKey: signingPublicKeyJWK,
      privateKey: signingPrivateKeyJWK,
    },

    // Key fingerprint (for verification)
    fingerprint: fingerprint,
  };

  // Store in IndexedDB
  await storeIdentity(identity);

  return identity;
}

/**
 * Check if an identity exists.
 * @returns {Promise<boolean>}
 */
export async function hasIdentity() {
  const identity = await retrieveIdentity();
  return identity !== null;
}

/**
 * Get the current identity or null if none exists.
 * @returns {Promise<Object|null>}
 */
export async function getIdentity() {
  return await retrieveIdentity();
}

/**
 * Import identity from CryptoKey objects.
 * @param {Object} identity - Stored identity with JWK keys
 * @returns {Promise<Object>} Identity with CryptoKey objects
 */
export async function loadIdentityKeys(identity) {
  if (!identity) return null;

  // Import all keys - Web Crypto API requires this for operations
  const [
    encryptionPublicKey,
    encryptionPrivateKey,
    signingPublicKey,
    signingPrivateKey,
  ] = await Promise.all([
    CryptoModule.importECDHPublicKey(identity.encryption.publicKey),
    CryptoModule.importECDHPrivateKey(identity.encryption.privateKey),
    CryptoModule.importSigningPublicKey(identity.signing.publicKey),
    CryptoModule.importSigningPrivateKey(identity.signing.privateKey),
  ]);

  return {
    ...identity,
    encryption: {
      publicKey: encryptionPublicKey,
      privateKey: encryptionPrivateKey,
      publicKeyJWK: identity.encryption.publicKey,
      privateKeyJWK: identity.encryption.privateKey,
    },
    signing: {
      publicKey: signingPublicKey,
      privateKey: signingPrivateKey,
      publicKeyJWK: identity.signing.publicKey,
      privateKeyJWK: identity.signing.privateKey,
    },
  };
}

/**
 * Get identity with loaded CryptoKey objects.
 * @returns {Promise<Object|null>}
 */
export async function getLoadedIdentity() {
  const identity = await retrieveIdentity();
  if (!identity) return null;
  return await loadIdentityKeys(identity);
}

// ===========================================================================
// Ownership Proof Generation
// ===========================================================================

/**
 * Generate an ownership proof for registering/updating public key.
 * This proves the client owns the private key corresponding to the signing public key.
 * Includes a nonce to prevent replay attacks.
 *
 * @param {Object} identity - The loaded identity with CryptoKey objects
 * @param {string} username - The username being registered
 * @returns {Promise<Object>} The ownership proof with signature, timestamp, and nonce
 */
export async function generateOwnershipProof(identity, username) {
  const timestamp = new Date().toISOString();

  // Generate a cryptographically secure random nonce (32 bytes = 64 hex chars)
  const nonceArray = new Uint8Array(32);
  crypto.getRandomValues(nonceArray);
  const nonce = Array.from(nonceArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Message format: id:username:timestamp:nonce (nonce added for replay protection)
  const message = `${identity.id}:${username.toLowerCase().trim()}:${timestamp}:${nonce}`;
  const messageBuffer = new TextEncoder().encode(message);

  // Get the signing private key (must be a CryptoKey, not JWK)
  let signingPrivateKey = identity.signing.privateKey;

  // If it's a JWK, import it first
  if (signingPrivateKey.kty) {
    signingPrivateKey =
      await CryptoModule.importSigningPrivateKey(signingPrivateKey);
  }

  // Sign the message
  const signatureBuffer = await CryptoModule.sign(
    messageBuffer,
    signingPrivateKey,
  );

  // Convert to base64 for transmission
  const signature = btoa(
    String.fromCharCode(...new Uint8Array(signatureBuffer)),
  );

  return {
    signature,
    timestamp,
    nonce,
  };
}

// ===========================================================================
// Public Key Export (for sharing)
// ===========================================================================

/**
 * Export public identity (safe to share with others).
 * Includes only public keys - no private keys.
 *
 * IMPORTANT: Always exports JWK format, not CryptoKey objects.
 * CryptoKey objects cannot be serialized to JSON.
 *
 * @param {Object} identity - The full identity object
 * @returns {Object} Public identity bundle
 */
export function exportPublicIdentity(identity) {
  // Prefer JWK versions to avoid accidentally exporting CryptoKey objects
  // which cannot be serialized to JSON
  const encryptionPubKey =
    identity.encryption.publicKeyJWK || identity.encryption.publicKey;
  const signingPubKey =
    identity.signing.publicKeyJWK || identity.signing.publicKey;

  // Validate that we're exporting JWKs, not CryptoKey objects
  if (
    encryptionPubKey instanceof CryptoKey ||
    signingPubKey instanceof CryptoKey
  ) {
    throw new Error(
      "Cannot export CryptoKey objects. Identity must have JWK keys.",
    );
  }

  return {
    id: identity.id,
    displayName: identity.displayName,
    encryptionPublicKey: encryptionPubKey,
    signingPublicKey: signingPubKey,
    fingerprint: identity.fingerprint,
  };
}

// ===========================================================================
// Contact Management (Known Recipients)
// ===========================================================================

/**
 * Get stored contacts from IndexedDB.
 * @returns {Promise<Array>} Array of contacts
 */
export async function getContacts() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(CONTACTS_KEY);

    request.onerror = () => reject(new Error("Failed to retrieve contacts"));
    request.onsuccess = () => resolve(request.result || []);

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Store contacts array directly to IndexedDB.
 * Used for backup restoration. Overwrites existing contacts.
 * @param {Array} contacts - Array of contact objects
 * @returns {Promise<void>}
 */
async function storeContacts(contacts) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(contacts, CONTACTS_KEY);

    request.onerror = () => reject(new Error("Failed to store contacts"));
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Add a contact (known recipient).
 * SECURITY: Computes fingerprint client-side from public key.
 * Never trusts the fingerprint string sent by the server (MITM protection).
 *
 * @param {Object} publicIdentity - Public identity of the contact
 * @returns {Promise<void>}
 */
export async function addContact(publicIdentity) {
  // Validate the public identity has valid JWK keys
  if (
    !publicIdentity.encryptionPublicKey ||
    typeof publicIdentity.encryptionPublicKey !== "object" ||
    !publicIdentity.encryptionPublicKey.kty
  ) {
    throw new Error(
      "Invalid encryption public key format. Expected a JWK object with 'kty' property.",
    );
  }

  if (
    !publicIdentity.signingPublicKey ||
    typeof publicIdentity.signingPublicKey !== "object" ||
    !publicIdentity.signingPublicKey.kty
  ) {
    throw new Error(
      "Invalid signing public key format. Expected a JWK object with 'kty' property.",
    );
  }

  // SECURITY: Compute fingerprint client-side from the public key
  // Never trust the fingerprint string sent by the server (MITM protection)
  const computedFingerprint = await CryptoModule.generateKeyFingerprint(
    publicIdentity.encryptionPublicKey,
  );

  // Log if server's fingerprint doesn't match (potential MITM attack detection)
  if (
    publicIdentity.fingerprint &&
    publicIdentity.fingerprint.toLowerCase() !==
      computedFingerprint.toLowerCase()
  ) {
    console.warn(
      "⚠️ SECURITY WARNING: Server fingerprint does not match computed fingerprint!",
      "\n  Server sent:",
      publicIdentity.fingerprint,
      "\n  Computed:   ",
      computedFingerprint,
    );
    // We still use the computed fingerprint, not the server's
  }

  // Try to import the keys to validate they work
  try {
    await CryptoModule.importECDHPublicKey(publicIdentity.encryptionPublicKey);
    await CryptoModule.importSigningPublicKey(publicIdentity.signingPublicKey);
  } catch (importError) {
    throw new Error("Failed to validate public keys: " + importError.message);
  }

  // Store contact with CLIENT-COMPUTED fingerprint (not server's)
  const verifiedContact = {
    ...publicIdentity,
    fingerprint: computedFingerprint, // Override with computed value
  };

  const contacts = await getContacts();

  // Check if contact already exists
  const existingIndex = contacts.findIndex((c) => c.id === verifiedContact.id);
  if (existingIndex >= 0) {
    // Update existing contact
    contacts[existingIndex] = verifiedContact;
  } else {
    contacts.push(verifiedContact);
  }

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(contacts, CONTACTS_KEY);

    request.onerror = () => reject(new Error("Failed to store contact"));
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Remove a contact.
 * @param {string} contactId - ID of the contact to remove
 * @returns {Promise<void>}
 */
export async function removeContact(contactId) {
  const contacts = await getContacts();
  const filtered = contacts.filter((c) => c.id !== contactId);

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(filtered, CONTACTS_KEY);

    request.onerror = () => reject(new Error("Failed to remove contact"));
    request.onsuccess = () => resolve();

    transaction.oncomplete = () => db.close();
  });
}

/**
 * Get a contact by ID.
 * @param {string} contactId - ID of the contact
 * @returns {Promise<Object|null>}
 */
export async function getContact(contactId) {
  const contacts = await getContacts();
  return contacts.find((c) => c.id === contactId) || null;
}

// ===========================================================================
// Identity Display Utilities
// ===========================================================================

/**
 * Get a short fingerprint (first 16 chars).
 * @param {Object} identity - Identity object
 * @returns {string} Short fingerprint
 */
export function getShortFingerprint(identity) {
  return identity.fingerprint.substring(0, 16).toUpperCase();
}

// ===========================================================================
// Identity Backup & Recovery (Encrypted Client-Side)
// ===========================================================================
// Provides "Safety Deposit Box" functionality for identity recovery.
// The backup file is encrypted with a user-provided password - the server
// never sees the keys or password (maintains zero-knowledge architecture).
//
// Backup includes: identity keys, profile info, and contacts.
// ===========================================================================

const BACKUP_VERSION = 1;

/**
 * Export identity and contacts to an encrypted backup file.
 * Downloads a JSON file that can be used to restore identity on any device.
 * 
 * SECURITY: 
 * - Backup is encrypted with AES-256-GCM using PBKDF2-derived key
 * - Password never leaves the client
 * - File is useless without the password
 * 
 * @param {string} password - User-provided backup password (should be strong)
 * @returns {Promise<void>} Triggers file download
 * @throws {Error} If no identity exists or encryption fails
 */
export async function exportIdentityBackup(password) {
  if (!password || password.length < 8) {
    throw new Error("Backup password must be at least 8 characters.");
  }

  // Retrieve current identity
  const identity = await retrieveIdentity();
  if (!identity) {
    throw new Error("No identity found to backup.");
  }

  // Retrieve contacts
  const contacts = await getContacts();

  // Build backup data structure
  const backupData = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    identity: {
      id: identity.id,
      displayName: identity.displayName,
      createdAt: identity.createdAt,
      fingerprint: identity.fingerprint,
      // Keys are already in JWK format (serializable)
      encryption: {
        publicKey: identity.encryption.publicKey,
        privateKey: identity.encryption.privateKey,
      },
      signing: {
        publicKey: identity.signing.publicKey,
        privateKey: identity.signing.privateKey,
      },
    },
    contacts: contacts,
  };

  // Encrypt with user password
  const encryptedBackup = await CryptoModule.encryptBackup(backupData, password);

  // Create and trigger download
  const blob = new Blob([JSON.stringify(encryptedBackup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `crypshare-identity-${identity.displayName.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Import identity from an encrypted backup file.
 * Restores identity and contacts, OVERWRITING any existing identity.
 * 
 * WARNING: This will replace the current identity! User should be warned.
 * 
 * @param {File} file - The backup file selected by user
 * @param {string} password - The password used when creating the backup
 * @returns {Promise<Object>} The restored identity
 * @throws {Error} If file is invalid, password is wrong, or restore fails
 */
export async function importIdentityBackup(file, password) {
  if (!file) {
    throw new Error("No backup file provided.");
  }
  if (!password) {
    throw new Error("Backup password is required.");
  }

  // Read file content
  const text = await file.text();
  let encryptedBackup;
  try {
    encryptedBackup = JSON.parse(text);
  } catch (e) {
    throw new Error("Invalid backup file format. File must be valid JSON.");
  }

  // Validate structure
  if (!encryptedBackup.salt || !encryptedBackup.iv || !encryptedBackup.data) {
    throw new Error("Invalid backup file structure. Missing required fields.");
  }

  // Decrypt with password
  const backupData = await CryptoModule.decryptBackup(encryptedBackup, password);

  // Validate backup version
  if (!backupData.version) {
    throw new Error("Invalid backup: missing version.");
  }
  if (backupData.version > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${backupData.version} is newer than supported (${BACKUP_VERSION}). Please update CrypShare.`,
    );
  }

  // Validate identity structure
  if (!backupData.identity || !backupData.identity.encryption || !backupData.identity.signing) {
    throw new Error("Invalid backup: missing identity keys.");
  }

  // Verify keys can be imported (validates JWK format and curve)
  try {
    // Test import encryption keys (P-256 ECDH)
    await CryptoModule.importECDHPublicKey(backupData.identity.encryption.publicKey);
    await CryptoModule.importECDHPrivateKey(backupData.identity.encryption.privateKey);
    
    // Test import signing keys (P-256 ECDSA)
    await CryptoModule.importSigningPublicKey(backupData.identity.signing.publicKey);
    await CryptoModule.importSigningPrivateKey(backupData.identity.signing.privateKey);
  } catch (keyError) {
    throw new Error(`Invalid backup: key import failed - ${keyError.message}`);
  }

  // Verify fingerprint matches the public key
  const computedFingerprint = await CryptoModule.generateKeyFingerprint(
    backupData.identity.encryption.publicKey,
  );
  if (computedFingerprint !== backupData.identity.fingerprint) {
    throw new Error(
      "Invalid backup: fingerprint does not match public key. File may be corrupted.",
    );
  }

  // Restore identity to IndexedDB
  const restoredIdentity = {
    id: backupData.identity.id,
    displayName: backupData.identity.displayName,
    createdAt: backupData.identity.createdAt,
    fingerprint: backupData.identity.fingerprint,
    encryption: {
      publicKey: backupData.identity.encryption.publicKey,
      privateKey: backupData.identity.encryption.privateKey,
    },
    signing: {
      publicKey: backupData.identity.signing.publicKey,
      privateKey: backupData.identity.signing.privateKey,
    },
  };

  await storeIdentity(restoredIdentity);

  // Restore contacts if present
  if (backupData.contacts && Array.isArray(backupData.contacts)) {
    await storeContacts(backupData.contacts);
  }

  return restoredIdentity;
}

// Default export removed in favor of named imports
