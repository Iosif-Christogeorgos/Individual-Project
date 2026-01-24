// =============================================================================
// CrypShare - Typewriter Effect for Landing Page
// Smooth, lightweight text animation
// =============================================================================

document.addEventListener("DOMContentLoaded", function () {
  const phrases = [
    "Infinite Privacy.",
    "Zero-Knowledge.",
    "End-to-End Encrypted.",
    "Your Keys. Your Files.",
    "Share Securely.",
  ];

  const el = document.getElementById("typewriter");
  if (!el) return;

  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;

  const typeSpeed = 80;
  const deleteSpeed = 45;
  const pauseEnd = 2200;
  const pauseStart = 400;

  function type() {
    const currentPhrase = phrases[phraseIndex];

    if (isDeleting) {
      charIndex--;
      el.textContent = currentPhrase.substring(0, charIndex);
    } else {
      el.textContent = currentPhrase.substring(0, charIndex + 1);
      charIndex++;
    }

    let delay = isDeleting ? deleteSpeed : typeSpeed;

    if (!isDeleting && charIndex === currentPhrase.length) {
      delay = pauseEnd;
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      delay = pauseStart;
    }

    setTimeout(type, delay);
  }

  // Start typing
  setTimeout(type, 500);
});
