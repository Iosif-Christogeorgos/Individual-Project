// =============================================================================
// CrypShare - Haptic Feedback Module (ES Module)
// =============================================================================
// Provides haptic feedback for mobile devices using the Vibration API.
// Gracefully degrades on devices that don't support haptics.
// =============================================================================

/**
 * Check if the device supports haptic feedback (Vibration API).
 * @returns {boolean} True if haptics are supported
 */
export function isHapticsSupported() {
  return 'vibrate' in navigator;
}

/**
 * Trigger a light haptic feedback - for subtle confirmations.
 * Use for: button taps, toggle switches, minor interactions.
 */
export function hapticLight() {
  if (!isHapticsSupported()) return;
  navigator.vibrate(10);
}

/**
 * Trigger a medium haptic feedback - for standard confirmations.
 * Use for: successful actions, selections, navigation.
 */
export function hapticMedium() {
  if (!isHapticsSupported()) return;
  navigator.vibrate(25);
}

/**
 * Trigger a heavy/strong haptic feedback - for important events.
 * Use for: major success events, completions, significant actions.
 */
export function hapticHeavy() {
  if (!isHapticsSupported()) return;
  navigator.vibrate(50);
}

/**
 * Trigger a success haptic pattern - double pulse for positive feedback.
 * Use for: upload complete, copy success, identity created.
 */
export function hapticSuccess() {
  if (!isHapticsSupported()) return;
  // Double pulse pattern: vibrate-pause-vibrate
  navigator.vibrate([30, 50, 30]);
}

/**
 * Trigger an error/warning haptic pattern - distinct pattern for alerts.
 * Use for: errors, warnings, validation failures.
 */
export function hapticError() {
  if (!isHapticsSupported()) return;
  // Three short pulses to indicate error/warning
  navigator.vibrate([50, 30, 50, 30, 50]);
}

/**
 * Trigger a notification haptic pattern - attention-grabbing pattern.
 * Use for: important notifications, signature verification results.
 */
export function hapticNotification() {
  if (!isHapticsSupported()) return;
  // Single strong pulse
  navigator.vibrate(75);
}

/**
 * Trigger a selection change haptic - very light feedback.
 * Use for: dropdown selections, checkbox toggles, recipient selection.
 */
export function hapticSelection() {
  if (!isHapticsSupported()) return;
  navigator.vibrate(5);
}

/**
 * Trigger a custom haptic pattern.
 * @param {number|number[]} pattern - Vibration duration(s) in milliseconds
 */
export function hapticCustom(pattern) {
  if (!isHapticsSupported()) return;
  navigator.vibrate(pattern);
}

/**
 * Cancel any ongoing haptic feedback.
 */
export function hapticCancel() {
  if (!isHapticsSupported()) return;
  navigator.vibrate(0);
}

// =============================================================================
// Legacy Haptics Object (for backward compatibility)
// =============================================================================

const Haptics = {
  isSupported: isHapticsSupported,
  light: hapticLight,
  medium: hapticMedium,
  heavy: hapticHeavy,
  success: hapticSuccess,
  error: hapticError,
  notification: hapticNotification,
  selection: hapticSelection,
  custom: hapticCustom,
  cancel: hapticCancel,
};

export default Haptics;
