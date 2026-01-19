// =============================================================================
// CrypShare - Lucide Icons Utility Module
// Cyber-Hacker Theme Icons with Glow Effects
// =============================================================================

/**
 * Get an SVG icon by name with customizable options.
 * All icons are styled to match the cyber-hacker glassmorphism theme.
 * 
 * @param {string} name - Icon name (e.g., 'lock', 'shield-check', 'copy')
 * @param {Object} options - Customization options
 * @param {number} options.size - Icon size in pixels (default: 20)
 * @param {string} options.color - Icon color (default: 'currentColor')
 * @param {number} options.strokeWidth - Stroke width (default: 2)
 * @param {string} options.className - Additional CSS classes
 * @returns {string} SVG markup string
 */
export function getIcon(name, options = {}) {
  const {
    size = 20,
    color = "currentColor",
    strokeWidth = 2,
    className = "",
  } = options;

  const baseClass = `lucide-icon${className ? ` ${className}` : ""}`;
  const baseAttrs = `class="${baseClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;

  const icons = {
    // Security & Encryption
    lock: `<svg ${baseAttrs}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    unlock: `<svg ${baseAttrs}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
    "shield-check": `<svg ${baseAttrs}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`,
    shield: `<svg ${baseAttrs}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
    key: `<svg ${baseAttrs}><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>`,
    "key-round": `<svg ${baseAttrs}><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,

    // Actions
    copy: `<svg ${baseAttrs}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    clipboard: `<svg ${baseAttrs}><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
    "clipboard-check": `<svg ${baseAttrs}><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>`,
    check: `<svg ${baseAttrs}><path d="M20 6 9 17l-5-5"/></svg>`,
    "check-circle": `<svg ${baseAttrs}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`,
    x: `<svg ${baseAttrs}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    "x-circle": `<svg ${baseAttrs}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,

    // File & Upload
    "folder-open": `<svg ${baseAttrs}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`,
    upload: `<svg ${baseAttrs}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`,
    download: `<svg ${baseAttrs}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,

    // Status & Alerts
    "alert-triangle": `<svg ${baseAttrs}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    info: `<svg ${baseAttrs}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
    zap: `<svg ${baseAttrs}><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`,

    // Time & Progress
    clock: `<svg ${baseAttrs}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    hourglass: `<svg ${baseAttrs}><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`,
    "loader-2": `<svg ${baseAttrs} class="${baseClass} animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,

    // Navigation
    "arrow-left": `<svg ${baseAttrs}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
    "arrow-right": `<svg ${baseAttrs}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
    "chevron-down": `<svg ${baseAttrs}><path d="m6 9 6 6 6-6"/></svg>`,

    // Identity & Users
    user: `<svg ${baseAttrs}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    "id-card": `<svg ${baseAttrs}><path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/></svg>`,
    "user-plus": `<svg ${baseAttrs}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>`,

    // Communication
    link: `<svg ${baseAttrs}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
    globe: `<svg ${baseAttrs}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,
    rocket: `<svg ${baseAttrs}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,
    search: `<svg ${baseAttrs}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,

    // Edit & Write
    "pen-line": `<svg ${baseAttrs}><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>`,

    // Misc
    lightbulb: `<svg ${baseAttrs}><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,

    // Fingerprint for crypto identity
    fingerprint: `<svg ${baseAttrs}><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>`,
  };

  return icons[name] || icons["info"];
}

/**
 * Get icon HTML with cyber glow effect
 */
export function getGlowIcon(name, options = {}) {
  return getIcon(name, {
    ...options,
    className: `${options.className || ""} icon-glow`.trim(),
  });
}

/**
 * Common icon presets for buttons
 */
export const buttonIcons = {
  encrypt: () => getIcon("lock", { size: 18 }),
  copy: () => getIcon("clipboard", { size: 18 }),
  copied: () => getIcon("clipboard-check", { size: 18 }),
  upload: () => getIcon("upload", { size: 18 }),
  download: () => getIcon("download", { size: 18 }),
  back: () => getIcon("arrow-left", { size: 18 }),
  create: () => getIcon("rocket", { size: 18 }),
  search: () => getIcon("search", { size: 18 }),
};

/**
 * Status icons for toasts and alerts
 */
export const statusIcons = {
  error: () => getIcon("alert-triangle", { size: 20, color: "var(--error)" }),
  success: () => getIcon("check-circle", { size: 20, color: "var(--success)" }),
  info: () => getIcon("info", { size: 20, color: "var(--accent-blue)" }),
  warning: () => getIcon("zap", { size: 20, color: "var(--warning)" }),
};

/**
 * Step status icons
 */
export const stepIcons = {
  pending: () => getIcon("clock", { size: 16, color: "var(--text-muted)" }),
  complete: () => getIcon("check", { size: 16, color: "var(--cyber-green)" }),
  error: () => getIcon("x", { size: 16, color: "var(--error)" }),
};
