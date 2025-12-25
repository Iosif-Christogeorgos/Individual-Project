// =============================================================================
// CrypShare - Identity Management Module
// =============================================================================
// Manages user identity (key pairs) with secure local storage using IndexedDB.
//
// SECURITY PRINCIPLES:
// - Private keys NEVER leave the client
// - Keys are stored in IndexedDB (not localStorage for security)
// - Public keys can be exported/shared
// - Identity is optional (link-based sharing still works without identity)
// =============================================================================

const IdentityManager = (function () {
  "use strict";

  // ===========================================================================
  // Constants
  // ===========================================================================

  const DB_NAME = "CrypShareIdentity";
  const DB_VERSION = 1;
  const STORE_NAME = "identity";
  const IDENTITY_KEY = "userIdentity";

  // ===========================================================================
  // IndexedDB Initialization
  // ===========================================================================

  /**
   * Open or create the IndexedDB database.
   * @returns {Promise<IDBDatabase>} The database connection
   */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () =>
        reject(new Error("Failed to open identity database"));

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

  /**
   * Delete identity from IndexedDB.
   * @returns {Promise<void>}
   */
  async function deleteIdentity() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(IDENTITY_KEY);

      request.onerror = () => reject(new Error("Failed to delete identity"));
      request.onsuccess = () => resolve();

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
  async function generateIdentity(displayName = "") {
    // Generate ECDH key pair (for key exchange / decryption)
    const ecdhKeyPair = await CryptoModule.generateECDHKeyPair();
    const ecdhPublicKeyJWK = await CryptoModule.exportECDHPublicKey(
      ecdhKeyPair.publicKey
    );
    const ecdhPrivateKeyJWK = await CryptoModule.exportECDHPrivateKey(
      ecdhKeyPair.privateKey
    );

    // Generate ECDSA key pair (for signing)
    const signingKeyPair = await CryptoModule.generateSigningKeyPair();
    const signingPublicKeyJWK = await CryptoModule.exportSigningPublicKey(
      signingKeyPair.publicKey
    );
    const signingPrivateKeyJWK = await CryptoModule.exportSigningPrivateKey(
      signingKeyPair.privateKey
    );

    // Generate fingerprint from ECDH public key
    const fingerprint = await CryptoModule.generateKeyFingerprint(
      ecdhPublicKeyJWK
    );

    // Create identity object
    const identity = {
      id: CryptoModule.generateRandomId(16),
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
  async function hasIdentity() {
    const identity = await retrieveIdentity();
    return identity !== null;
  }

  /**
   * Get the current identity or null if none exists.
   * @returns {Promise<Object|null>}
   */
  async function getIdentity() {
    return await retrieveIdentity();
  }

  /**
   * Get or create an identity.
   * @param {string} displayName - Optional display name for new identity
   * @returns {Promise<Object>} The identity
   */
  async function getOrCreateIdentity(displayName = "") {
    let identity = await retrieveIdentity();
    if (!identity) {
      identity = await generateIdentity(displayName);
    }
    return identity;
  }

  /**
   * Import identity from CryptoKey objects.
   * @param {Object} identity - Stored identity with JWK keys
   * @returns {Promise<Object>} Identity with CryptoKey objects
   */
  async function loadIdentityKeys(identity) {
    if (!identity) return null;

    console.log("🔑 Loading identity keys, verifying structure:", {
      hasEncryption: !!identity.encryption,
      hasEncryptionPublicKey: !!identity.encryption?.publicKey,
      hasEncryptionPrivateKey: !!identity.encryption?.privateKey,
      hasSigning: !!identity.signing,
      hasSigningPublicKey: !!identity.signing?.publicKey,
      hasSigningPrivateKey: !!identity.signing?.privateKey,
      fingerprint: identity.fingerprint,
    });

    // Import keys one by one with error handling
    let encryptionPublicKey, encryptionPrivateKey, signingPublicKey, signingPrivateKey;
    
    try {
      encryptionPublicKey = await CryptoModule.importECDHPublicKey(identity.encryption.publicKey);
      console.log("🔑 Imported ECDH public key");
    } catch (e) {
      console.error("🔑 Failed to import ECDH public key:", e);
      throw e;
    }
    
    try {
      encryptionPrivateKey = await CryptoModule.importECDHPrivateKey(identity.encryption.privateKey);
      console.log("🔑 Imported ECDH private key");
    } catch (e) {
      console.error("🔑 Failed to import ECDH private key:", e);
      throw e;
    }
    
    try {
      signingPublicKey = await CryptoModule.importSigningPublicKey(identity.signing.publicKey);
      console.log("🔑 Imported ECDSA public key");
    } catch (e) {
      console.error("🔑 Failed to import ECDSA public key:", e);
      throw e;
    }
    
    try {
      signingPrivateKey = await CryptoModule.importSigningPrivateKey(identity.signing.privateKey);
      console.log("🔑 Imported ECDSA private key");
    } catch (e) {
      console.error("🔑 Failed to import ECDSA private key:", e);
      throw e;
    }

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
  async function getLoadedIdentity() {
    const identity = await retrieveIdentity();
    console.log(
      "🔑 Retrieved raw identity from IndexedDB:",
      identity ? "exists" : "null"
    );
    if (!identity) return null;

    try {
      const loaded = await loadIdentityKeys(identity);
      console.log("🔑 Successfully loaded identity keys");
      return loaded;
    } catch (error) {
      console.error("🔑 Failed to load identity keys:", error);
      throw error;
    }
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
  function exportPublicIdentity(identity) {
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
        "Cannot export CryptoKey objects. Identity must have JWK keys."
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

  /**
   * Import a public identity from another user.
   * @param {Object} publicIdentity - Public identity bundle
   * @returns {Promise<Object>} Imported public identity with CryptoKey objects
   */
  async function importPublicIdentity(publicIdentity) {
    return {
      id: publicIdentity.id,
      displayName: publicIdentity.displayName,
      fingerprint: publicIdentity.fingerprint,
      encryptionPublicKey: await CryptoModule.importECDHPublicKey(
        publicIdentity.encryptionPublicKey
      ),
      encryptionPublicKeyJWK: publicIdentity.encryptionPublicKey,
      signingPublicKey: await CryptoModule.importSigningPublicKey(
        publicIdentity.signingPublicKey
      ),
      signingPublicKeyJWK: publicIdentity.signingPublicKey,
    };
  }

  // ===========================================================================
  // Contact Management (Known Recipients)
  // ===========================================================================

  const CONTACTS_KEY = "contacts";

  /**
   * Get stored contacts from IndexedDB.
   * @returns {Promise<Array>} Array of contacts
   */
  async function getContacts() {
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
   * Add a contact (known recipient).
   * @param {Object} publicIdentity - Public identity of the contact
   * @returns {Promise<void>}
   */
  async function addContact(publicIdentity) {
    // Validate the public identity has valid JWK keys
    if (
      !publicIdentity.encryptionPublicKey ||
      typeof publicIdentity.encryptionPublicKey !== "object" ||
      !publicIdentity.encryptionPublicKey.kty
    ) {
      throw new Error(
        "Invalid encryption public key format. Expected a JWK object with 'kty' property."
      );
    }

    if (
      !publicIdentity.signingPublicKey ||
      typeof publicIdentity.signingPublicKey !== "object" ||
      !publicIdentity.signingPublicKey.kty
    ) {
      throw new Error(
        "Invalid signing public key format. Expected a JWK object with 'kty' property."
      );
    }

    if (
      !publicIdentity.fingerprint ||
      typeof publicIdentity.fingerprint !== "string"
    ) {
      throw new Error("Invalid or missing fingerprint.");
    }

    // Try to import the keys to validate they work
    try {
      await CryptoModule.importECDHPublicKey(
        publicIdentity.encryptionPublicKey
      );
      await CryptoModule.importSigningPublicKey(
        publicIdentity.signingPublicKey
      );
    } catch (importError) {
      throw new Error("Failed to validate public keys: " + importError.message);
    }

    const contacts = await getContacts();

    // Check if contact already exists
    const existingIndex = contacts.findIndex((c) => c.id === publicIdentity.id);
    if (existingIndex >= 0) {
      // Update existing contact
      contacts[existingIndex] = publicIdentity;
    } else {
      contacts.push(publicIdentity);
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
  async function removeContact(contactId) {
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
  async function getContact(contactId) {
    const contacts = await getContacts();
    return contacts.find((c) => c.id === contactId) || null;
  }

  // ===========================================================================
  // Identity Display Utilities
  // ===========================================================================

  /**
   * Get a formatted fingerprint for display.
   * @param {Object} identity - Identity object
   * @returns {string} Formatted fingerprint
   */
  function getFormattedFingerprint(identity) {
    return CryptoModule.formatFingerprint(identity.fingerprint);
  }

  /**
   * Get a short fingerprint (first 16 chars).
   * @param {Object} identity - Identity object
   * @returns {string} Short fingerprint
   */
  function getShortFingerprint(identity) {
    return identity.fingerprint.substring(0, 16).toUpperCase();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  return {
    // Identity Management
    generateIdentity,
    hasIdentity,
    getIdentity,
    getOrCreateIdentity,
    getLoadedIdentity,
    deleteIdentity,
    loadIdentityKeys,

    // Public Key Export/Import
    exportPublicIdentity,
    importPublicIdentity,

    // Contacts
    getContacts,
    addContact,
    removeContact,
    getContact,

    // Display Utilities
    getFormattedFingerprint,
    getShortFingerprint,
  };
})();

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = IdentityManager;
}
