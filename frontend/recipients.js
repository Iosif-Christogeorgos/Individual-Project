// =============================================================================
// CrypShare - Recipients Management Module
// =============================================================================
// Handles contact/recipient selection for identity-based file sharing.
// =============================================================================

import IdentityManager from './identity.js';
import { showAlert, showToast, escapeHtml } from './ui-utils.js';

// State
let selectedRecipients = [];

/**
 * Get the current list of selected recipient IDs.
 * @returns {string[]} Array of recipient IDs
 */
export function getSelectedRecipients() {
  return selectedRecipients;
}

/**
 * Clear all selected recipients.
 */
export function clearSelectedRecipients() {
  selectedRecipients = [];
  updateRecipientCount();
}

/**
 * Load and display contacts in the contacts list.
 */
export async function loadContacts() {
  const contactsList = document.getElementById("contactsList");
  if (!contactsList) return;

  try {
    const contacts = await IdentityManager.getContacts();

    if (contacts.length === 0) {
      contactsList.innerHTML =
        '<div class="no-contacts">No contacts added yet</div>';
      return;
    }

    contactsList.innerHTML = contacts
      .map(
        (contact) => `
      <div class="contact-item" data-id="${contact.id}">
        <input type="checkbox" class="contact-checkbox" 
               onchange="toggleRecipient('${contact.id}', this.checked)">
        <div class="contact-info">
          <span class="contact-name">${escapeHtml(contact.displayName)}</span>
          <span class="contact-fingerprint">${contact.fingerprint
            .substring(0, 16)
            .toUpperCase()}</span>
        </div>
        <button class="contact-remove" onclick="removeContactUI('${
          contact.id
        }')" title="Remove contact">×</button>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Failed to load contacts:", error);
  }
}

/**
 * Toggle a recipient's selection status.
 * @param {string} contactId - Contact ID to toggle
 * @param {boolean} selected - Whether the contact is selected
 * @param {Function} onChangeCallback - Callback when selection changes
 */
export function toggleRecipient(contactId, selected, onChangeCallback) {
  if (selected) {
    if (!selectedRecipients.includes(contactId)) {
      selectedRecipients.push(contactId);
    }
  } else {
    selectedRecipients = selectedRecipients.filter((id) => id !== contactId);
  }
  updateRecipientCount();
  
  if (onChangeCallback) {
    onChangeCallback();
  }
}

/**
 * Update the recipient count display.
 */
export function updateRecipientCount() {
  const countEl = document.getElementById("recipientCount");
  if (countEl) {
    countEl.textContent =
      selectedRecipients.length > 0
        ? `${selectedRecipients.length} recipient(s) selected`
        : "";
  }
}

/**
 * Remove a contact from the list.
 * @param {string} contactId - Contact ID to remove
 * @param {Function} onChangeCallback - Callback after removal
 */
export async function removeContactUI(contactId, onChangeCallback) {
  try {
    await IdentityManager.removeContact(contactId);
    selectedRecipients = selectedRecipients.filter((id) => id !== contactId);
    await loadContacts();
    updateRecipientCount();
    
    if (onChangeCallback) {
      onChangeCallback();
    }
  } catch (error) {
    showAlert("Error", "Failed to remove contact: " + error.message, "error");
  }
}

/**
 * Import a contact from pasted JSON.
 */
export async function importContact() {
  const input = document.getElementById("importContactInput");
  if (!input || !input.value.trim()) {
    showToast("Please paste a public identity JSON ⚠");
    return;
  }

  try {
    const publicIdentity = JSON.parse(input.value.trim());

    if (
      !publicIdentity.id ||
      !publicIdentity.encryptionPublicKey ||
      !publicIdentity.signingPublicKey
    ) {
      throw new Error("Invalid public identity format");
    }

    await IdentityManager.addContact(publicIdentity);
    input.value = "";
    await loadContacts();
    showToast(`Added ${publicIdentity.displayName} to contacts ✓`);
  } catch (error) {
    showToast("Failed to import contact ✗");
  }
}

/**
 * Import a contact from a file.
 */
export async function importContactFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const publicIdentity = JSON.parse(text);

      if (!publicIdentity.id || !publicIdentity.encryptionPublicKey) {
        throw new Error("Invalid public identity format");
      }

      await IdentityManager.addContact(publicIdentity);
      await loadContacts();
      showToast(`Added ${publicIdentity.displayName} to contacts ✓`);
    } catch (error) {
      showToast("Failed to import contact ✗");
    }
  };

  input.click();
}

// Default export for backward compatibility
export default {
  getSelectedRecipients,
  clearSelectedRecipients,
  loadContacts,
  toggleRecipient,
  updateRecipientCount,
  removeContactUI,
  importContact,
  importContactFromFile
};
