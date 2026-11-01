# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub's security advisories](https://github.com/Iosif-Christogeorgos/Individual-Project/security/advisories/new).
Do not open a public issue.

Include the steps to reproduce the problem and what an attacker could do with it.

## What CrypShare protects

Files are encrypted in the browser before upload, so the server stores only ciphertext.

| Attacker                                 | Can't do                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Someone who steals the database or files | Read file contents, filenames or file keys                                                |
| A server operator altering stored files  | Change, reorder, cut or extend a file without decryption failing (format v3)              |
| A file uploader                          | Appear as one of your contacts: a signature only confirms a sender whose key you've saved |
| Anyone on the internet                   | Take over a registered identity: updates require its registered signing key               |

## What CrypShare does not protect against

**A malicious or compromised server that changes the code it serves.** The server
delivers the JavaScript that does the encryption. If it serves modified code, that
code can read your files and keys. This applies to all browser-based end-to-end
encryption. It's the main reason not to treat CrypShare as protection against
whoever runs the server.

**Swapped public keys.** Contacts are looked up on the server, so a malicious server
could return its own key when you first add someone. The fingerprint is computed in
your browser, but that only proves it belongs to the key you were given. To be sure,
compare fingerprints with the person over another channel. Once saved, a contact's
key is reused without asking the server again.

**A compromised device or browser.** Private keys are stored in IndexedDB and can be
exported, which is what makes backups possible. Malware or a malicious extension can
read them.

**Weak backup passwords.** Identity backups can be attacked offline, so their
strength depends on the password (PBKDF2-SHA256, 600,000 iterations).

**Fully removed metadata.** A malicious server can delete a file's signature and
content hash. The file then shows as unsigned rather than as tampered with, so don't
rely on an expected signature unless you check it's there.

**Traffic analysis.** See the next section.

## What the server can see

- File size, upload and download times, and IP addresses
- Which identity fingerprints can open which file, and the username for each
  fingerprint in the public directory
- For Secure Share files: a SHA-256 hash of the plaintext and a hash of the filename.
  These don't reveal the contents, but they can confirm a guess, such as whether a file
  is a specific known document.
- For signed files: the signer's name, fingerprint and public signing key

Share links carry the file key after the `#`, which browsers don't send to servers.
The key does stay in your browser history and anywhere the link is pasted.

Pages also load fonts from Google Fonts and jsDelivr, so those services see the
visitor's IP address. No page URL is sent, because referrers are disabled.

## Known limitations

- ECDH shared secrets are used directly as AES keys, without HKDF. Each recipient
  bundle uses a fresh ephemeral key, so this isn't a known practical weakness, but
  changing it needs a key-bundle format version.
- Files stored in the older v2 format are still accepted until they expire. v2 doesn't
  protect against reordered or truncated chunks. Files cannot be converted from v3
  to v2, because v3 authenticates its position data.
- An expired file stays downloadable until the next cleanup run, at most 15 minutes
  later. Files with no metadata row are removed by the R2 lifecycle rule.
