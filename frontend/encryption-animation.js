/**
 * Professional Encryption Animation Controller
 * Cinematic lock animation with GSAP for secure file upload
 * Features: Morphing shackle, particles, progress ring, energy pulses
 * CSP-Compliant: Uses CSS classes instead of inline styles
 * 
 * FULLSCREEN MODE: Epic takeover animation with mega lock
 */

class EncryptionAnimator {
  constructor() {
    // Core lock elements (inline version)
    this.lockContainer = document.getElementById('encryptionLock');
    this.shackle = document.getElementById('lockShackle');
    this.scrambleText = document.getElementById('scrambleText');
    this.fileSizeEl = document.getElementById('fileSize');
    this.fileNameEl = document.getElementById('fileName');
    this.progressRing = null;
    this.particleContainer = null;
    
    // Fullscreen overlay elements
    this.overlay = document.getElementById('encryptionOverlay');
    this.megaLock = document.getElementById('megaLock');
    this.megaShackle = document.getElementById('megaLockShackle');
    this.megaRingFill = document.getElementById('megaRingFill');
    this.megaParticles = document.getElementById('megaParticles');
    this.megaStatusText = document.getElementById('megaStatusText');
    this.megaProgressPercent = document.getElementById('megaProgressPercent');
    this.megaCancelBtn = document.getElementById('megaCancelBtn');
    
    // Animation state
    this.isAnimating = false;
    this.isFullscreenMode = false;
    this.isCompleting = false;  // Guard against multiple completion calls
    this.currentProgress = 0;   // Track progress to prevent backwards updates
    this.scrambleInterval = null;
    this.particleInterval = null;
    this.megaParticleInterval = null;
    this.particles = [];
    
    // Scramble characters for "encryption" effect
    this.scrambleChars = '01@#$%^&*_-+=<>?/\\|{}[]~';
    this.dataChars = '0123456789ABCDEF';
    
    // Particle animation directions (CSP-compliant class-based)
    this.particleDirections = [
      'anim-top', 'anim-right', 'anim-bottom', 'anim-left',
      'anim-topleft', 'anim-topright', 'anim-bottomleft', 'anim-bottomright'
    ];
    
    // Shackle paths - TRUE morphing from open to closed
    // Open: Shackle raised up with gap at top
    this.openShacklePath = 'M16 36 L16 16 C16 5 24 -2 32 -2 C40 -2 48 5 48 16 L48 36';
    // Closed: Shackle seated firmly in body
    this.closedShacklePath = 'M16 36 L16 24 C16 13 24 6 32 6 C40 6 48 13 48 24 L48 36';
    
    this.init();
  }
  
  init() {
    // Initialize inline lock if present
    if (this.lockContainer && this.shackle) {
      this.createProgressRing();
      this.createParticleContainer();
      this.createScanLines();
      this.setIdle();
    }
    
    // Initialize fullscreen overlay cancel button
    if (this.megaCancelBtn) {
      this.megaCancelBtn.addEventListener('click', () => {
        if (window.cancelUpload) {
          window.cancelUpload();
        }
      });
    }
    
    // Expose to global for upload.js integration
    window.encryptionAnimator = this;
    console.log('EncryptionAnimator Pro initialized (with fullscreen mode)');
  }
  
  // ===========================================================================
  // FULLSCREEN OVERLAY METHODS
  // ===========================================================================
  
  /**
   * Show the fullscreen encryption overlay with epic animation
   */
  showFullscreenOverlay() {
    if (!this.overlay) return;
    
    this.isFullscreenMode = true;
    this.isCompleting = false;  // Reset completion guard
    this.currentProgress = 0;   // Reset progress tracker
    
    // Reset mega lock state
    if (this.megaLock) {
      this.megaLock.classList.remove('success', 'locking');
    }
    
    // Reset progress ring
    if (this.megaRingFill) {
      this.megaRingFill.setAttribute('stroke-dashoffset', '283');
    }
    
    // Reset status
    if (this.megaStatusText) {
      this.megaStatusText.textContent = 'INITIALIZING';
    }
    if (this.megaProgressPercent) {
      this.megaProgressPercent.textContent = '0%';
    }
    
    // Reset shackle to open position
    if (this.megaShackle && typeof gsap !== 'undefined') {
      gsap.set(this.megaShackle, { attr: { d: this.openShacklePath } });
    }
    
    // Clear any existing particles
    if (this.megaParticles) {
      this.megaParticles.innerHTML = '';
    }
    
    // Show overlay
    this.overlay.classList.add('active');
    
    // Start particle stream
    this.startMegaParticles();
  }
  
  /**
   * Hide the fullscreen overlay
   */
  hideFullscreenOverlay() {
    if (!this.overlay) return;
    
    this.isFullscreenMode = false;
    this.isCompleting = false;  // Reset completion guard
    this.currentProgress = 0;   // Reset progress tracker
    this.stopMegaParticles();
    
    // Fade out
    this.overlay.classList.remove('active');
    
    // Clean up after transition
    setTimeout(() => {
      if (this.megaLock) {
        this.megaLock.classList.remove('success', 'locking');
      }
      if (this.megaParticles) {
        this.megaParticles.innerHTML = '';
      }
    }, 500);
  }
  
  /**
   * Update mega progress display
   */
  updateMegaProgress(percent, status) {
    // Ignore updates if not in fullscreen mode or if completion has started
    if (!this.isFullscreenMode || this.isCompleting) return;
    
    // Prevent backwards progress (except for explicit reset)
    if (percent < this.currentProgress && percent > 0) {
      return;  // Ignore backwards progress updates
    }
    this.currentProgress = percent;
    
    // Update progress ring (circumference = 2 * PI * 45 = 283)
    if (this.megaRingFill) {
      const offset = 283 - (283 * percent / 100);
      this.megaRingFill.setAttribute('stroke-dashoffset', offset.toString());
    }
    
    // Update percentage
    if (this.megaProgressPercent) {
      this.megaProgressPercent.textContent = `${Math.round(percent)}%`;
    }
    
    // Update status with scramble effect
    if (this.megaStatusText && status) {
      // Add random hex chars for cyber effect
      const hexPart = Array(4).fill(0).map(() => 
        this.dataChars[Math.floor(Math.random() * this.dataChars.length)]
      ).join('');
      this.megaStatusText.textContent = `[${hexPart}] ENCRYPTING`;
    }
    
    // Complete animation if 100%
    if (percent >= 100) {
      this.completeMegaEncryption();
    }
  }
  
  /**
   * Start spawning data particles that stream toward the lock
   */
  startMegaParticles() {
    if (!this.megaParticles) return;
    
    this.megaParticleInterval = setInterval(() => {
      this.createMegaParticle();
    }, 150);
  }
  
  /**
   * Stop particle spawning
   */
  stopMegaParticles() {
    if (this.megaParticleInterval) {
      clearInterval(this.megaParticleInterval);
      this.megaParticleInterval = null;
    }
  }
  
  /**
   * Create a single data particle with CSS-class-based animation (CSP safe)
   */
  createMegaParticle() {
    if (!this.megaParticles) return;
    
    const particle = document.createElement('span');
    particle.classList.add('mega-data-particle');
    
    // Random hex character
    particle.textContent = this.dataChars[Math.floor(Math.random() * this.dataChars.length)];
    
    // Random direction class (CSP-compliant - no inline styles)
    const direction = this.particleDirections[Math.floor(Math.random() * this.particleDirections.length)];
    particle.classList.add(direction);
    
    this.megaParticles.appendChild(particle);
    
    // Remove after animation completes
    setTimeout(() => {
      particle.remove();
    }, 2100);
  }
  
  /**
   * Complete mega encryption with dramatic lock close
   */
  async completeMegaEncryption() {
    // Guard against multiple calls during async completion
    if (!this.isFullscreenMode || this.isCompleting) return;
    this.isCompleting = true;  // Lock to prevent re-entry
    
    // Stop particles
    this.stopMegaParticles();
    
    // Update status
    if (this.megaStatusText) {
      this.megaStatusText.textContent = '✓ ENCRYPTED';
    }
    
    // Dramatic shackle close with GSAP
    if (this.megaShackle && typeof gsap !== 'undefined') {
      this.megaLock?.classList.add('locking');
      
      await new Promise(resolve => {
        gsap.to(this.megaShackle, {
          attr: { d: this.closedShacklePath },
          duration: 0.5,
          ease: 'power3.inOut',
          onComplete: resolve
        });
      });
      
      // Impact shake
      if (this.megaLock) {
        gsap.timeline()
          .to(this.megaLock, { scale: 1.1, duration: 0.08, ease: 'power4.out' })
          .to(this.megaLock, { scale: 0.95, duration: 0.06, ease: 'power2.in' })
          .to(this.megaLock, { scale: 1.02, duration: 0.1, ease: 'power2.out' })
          .to(this.megaLock, { scale: 1, duration: 0.2, ease: 'elastic.out(1, 0.5)' });
      }
    }
    
    // Add success state
    if (this.megaLock) {
      this.megaLock.classList.add('success');
    }
    
    // Create energy burst
    this.createMegaEnergyBurst();
    
    // Wait then hide overlay
    await new Promise(r => setTimeout(r, 1200));
    this.hideFullscreenOverlay();
    
    this.isAnimating = false;
  }
  
  /**
   * Create energy burst effect on completion
   */
  createMegaEnergyBurst() {
    if (!this.megaLock) return;
    
    const burst = document.createElement('div');
    burst.classList.add('mega-energy-burst');
    this.megaLock.appendChild(burst);
    
    // Remove after animation
    setTimeout(() => burst.remove(), 1000);
  }

  
  /**
   * Create circular progress ring around the lock
   */
  createProgressRing() {
    if (this.lockContainer.querySelector('.progress-ring')) return;
    
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.classList.add('progress-ring');
    ring.setAttribute('viewBox', '0 0 100 100');
    ring.innerHTML = `
      <defs>
        <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f59e0b"/>
          <stop offset="50%" stop-color="#ff6b35"/>
          <stop offset="100%" stop-color="#00ff41"/>
        </linearGradient>
        <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <circle class="progress-ring-bg" cx="50" cy="50" r="45" 
              stroke="rgba(255,255,255,0.1)" stroke-width="2" fill="none"/>
      <circle class="progress-ring-fill" cx="50" cy="50" r="45" 
              stroke="url(#ringGradient)" stroke-width="3" fill="none"
              stroke-linecap="round" filter="url(#ringGlow)"
              stroke-dasharray="283" stroke-dashoffset="283"
              transform="rotate(-90 50 50)"/>
    `;
    this.lockContainer.appendChild(ring);
    this.progressRing = ring.querySelector('.progress-ring-fill');
  }
  
  /**
   * Create particle container for encryption effect
   */
  createParticleContainer() {
    if (this.lockContainer.querySelector('.particle-container')) return;
    
    const container = document.createElement('div');
    container.classList.add('particle-container');
    this.lockContainer.appendChild(container);
    this.particleContainer = container;
  }
  
  /**
   * Create cyber scan lines overlay
   */
  createScanLines() {
    if (this.lockContainer.querySelector('.scan-lines')) return;
    
    const scanLines = document.createElement('div');
    scanLines.classList.add('scan-lines');
    this.lockContainer.appendChild(scanLines);
  }
  
  /**
   * Idle state - lock is open, ready for files
   */
  setIdle() {
    if (!this.shackle || typeof gsap === 'undefined') return;
    
    // Morph to open path and lift up (using GSAP attr which is CSP-safe)
    gsap.set(this.shackle, { 
      attr: { d: this.openShacklePath },
      y: 0
    });
    
    if (this.lockContainer) {
      this.lockContainer.classList.remove('processing', 'success', 'error', 'file-ready');
    }
    
    // Hide effects
    this.hideProgressRing();
    this.stopParticles();
    
    // Use CSS classes for visibility instead of inline styles
    if (this.scrambleText) {
      this.scrambleText.classList.add('hidden');
      this.scrambleText.classList.remove('show-success');
      this.scrambleText.textContent = '';
    }
    if (this.fileSizeEl) {
      this.fileSizeEl.classList.remove('hidden');
    }
  }
  
  /**
   * File selected - update lock state for file ready
   */
  onFileSelect(filename) {
    if (this.isAnimating) return;
    
    this.refreshElements();
    this.setIdle();
    
    // Mark as file ready with subtle glow
    if (this.lockContainer) {
      this.lockContainer.classList.add('file-ready');
    }
    
    // Subtle "breathing" animation when ready (GSAP transform is CSP-safe)
    if (this.shackle && typeof gsap !== 'undefined') {
      gsap.to(this.shackle, {
        y: -2,
        duration: 1.5,
        ease: 'power1.inOut',
        yoyo: true,
        repeat: -1
      });
    }
  }
  
  /**
   * Re-query DOM elements
   */
  refreshElements() {
    this.lockContainer = document.getElementById('encryptionLock');
    this.shackle = document.getElementById('lockShackle');
    this.scrambleText = document.getElementById('scrambleText');
    this.encryptionStatusEl = document.getElementById('encryptionStatus');
    this.fileSizeEl = document.getElementById('fileSize');
    this.fileNameEl = document.getElementById('fileName');
    this.lockSvg = this.lockContainer?.querySelector('.lock-svg');
    this.progressRing = this.lockContainer?.querySelector('.progress-ring-fill');
    this.particleContainer = this.lockContainer?.querySelector('.particle-container');
    
    // Recreate elements if needed
    if (this.lockContainer) {
      if (!this.progressRing) this.createProgressRing();
      if (!this.particleContainer) this.createParticleContainer();
    }
  }
  
  /**
   * Start the encryption animation (progress-driven version)
   * NOW USES FULLSCREEN OVERLAY for epic effect
   */
  async startEncryptionSequence(filename) {
    this.refreshElements();
    this.isAnimating = true;
    this.currentFilename = filename;
    
    // Stop any existing animations on inline lock
    if (this.shackle && typeof gsap !== 'undefined') {
      gsap.killTweensOf(this.shackle);
    }
    
    // === FULLSCREEN MODE ===
    // Show the epic fullscreen overlay (no inline lock animation - fullscreen only)
    this.showFullscreenOverlay();
  }

  
  /**
   * Start subtle vibration during encryption
   */
  startProcessingVibration() {
    if (!this.shackle || typeof gsap === 'undefined') return;
    
    gsap.to(this.shackle, {
      x: '+=0.5',
      duration: 0.05,
      ease: 'none',
      yoyo: true,
      repeat: -1
    });
  }
  
  /**
   * Show and reset progress ring
   */
  showProgressRing() {
    this.progressRing = this.lockContainer?.querySelector('.progress-ring-fill');
    const ring = this.lockContainer?.querySelector('.progress-ring');
    if (ring) {
      ring.classList.add('visible');
      if (this.progressRing) {
        this.progressRing.setAttribute('stroke-dashoffset', '283');
      }
    }
  }
  
  /**
   * Hide progress ring
   */
  hideProgressRing() {
    const ring = this.lockContainer?.querySelector('.progress-ring');
    if (ring) {
      ring.classList.remove('visible');
    }
  }
  
  /**
   * Update progress ring based on percentage
   */
  updateProgressRing(percent) {
    if (!this.progressRing) {
      this.progressRing = this.lockContainer?.querySelector('.progress-ring-fill');
    }
    if (this.progressRing) {
      // Full circle = 283 (2 * PI * 45)
      const offset = 283 - (283 * percent / 100);
      // Use setAttribute for CSP compliance
      this.progressRing.setAttribute('stroke-dashoffset', offset.toString());
    }
  }
  
  /**
   * Start particle effect
   */
  startParticles() {
    if (!this.particleContainer) return;
    
    this.particleContainer.innerHTML = '';
    this.particles = [];
    
    // Create initial batch of particles
    for (let i = 0; i < 12; i++) {
      setTimeout(() => this.createParticle(), i * 100);
    }
    
    // Continue creating particles
    this.particleInterval = setInterval(() => {
      if (this.particles.length < 15) {
        this.createParticle();
      }
    }, 200);
  }
  
  /**
   * Create a single encryption particle using data attributes for CSS
   */
  createParticle() {
    if (!this.particleContainer) return;
    
    const particle = document.createElement('span');
    particle.classList.add('encryption-particle');
    
    // Random data character
    particle.textContent = this.dataChars[Math.floor(Math.random() * this.dataChars.length)];
    
    // Random position around the lock - use data attributes instead of CSS custom properties
    const angle = Math.random() * Math.PI * 2;
    const radius = 35 + Math.random() * 15;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const duration = 1 + Math.random() * 1;
    
    // Set data attributes for CSS to use
    particle.dataset.startX = x.toFixed(1);
    particle.dataset.startY = y.toFixed(1);
    particle.dataset.endX = (x * 0.3).toFixed(1);
    particle.dataset.endY = (y * 0.3).toFixed(1);
    particle.dataset.duration = duration.toFixed(2);
    
    // Apply initial transform via class
    particle.classList.add('particle-animate');
    
    this.particleContainer.appendChild(particle);
    this.particles.push(particle);
    
    // Remove particle after animation
    setTimeout(() => {
      particle.remove();
      this.particles = this.particles.filter(p => p !== particle);
    }, 2000);
  }
  
  /**
   * Stop particle effect
   */
  stopParticles() {
    if (this.particleInterval) {
      clearInterval(this.particleInterval);
      this.particleInterval = null;
    }
    if (this.particleContainer) {
      this.particleContainer.innerHTML = '';
    }
    this.particles = [];
  }
  
  /**
   * Update progress display - called by ui-utils updateProgress
   * Routes to fullscreen mega display when overlay is active
   */
  updateProgressDisplay(percent, status) {
    // === FULLSCREEN MODE ===
    // If fullscreen overlay is active, update the mega display
    if (this.isFullscreenMode) {
      this.updateMegaProgress(percent, status);
      return;
    }
    
    // === INLINE MODE (fallback) ===
    if (!this.scrambleText || !this.lockContainer) {
      this.refreshElements();
    }
    
    if (!this.lockContainer) return;
    
    // Ensure processing state
    if (!this.lockContainer.classList.contains('processing') && percent < 100) {
      this.lockContainer.classList.add('processing');
    }
    
    // Update progress ring
    this.updateProgressRing(percent);
    
    // Show progress in scramble text with scrambled characters effect
    if (this.scrambleText) {
      const hexChars = Array(4).fill(0).map(() => 
        this.dataChars[Math.floor(Math.random() * this.dataChars.length)]
      ).join('');
      
      this.scrambleText.textContent = `[${hexChars}] ${Math.round(percent)}%`;
    }
    
    // When complete, trigger success animation
    if (percent >= 100) {
      this.completeEncryption();
    }
  }

  
  /**
   * Complete the encryption animation with dramatic lock closing
   */
  async completeEncryption() {
    // Stop processing effects
    if (this.shackle && typeof gsap !== 'undefined') {
      gsap.killTweensOf(this.shackle);
    }
    this.stopParticles();
    
    // Complete progress ring with flash
    this.updateProgressRing(100);
    
    // Dramatic pause before locking
    await new Promise(r => setTimeout(r, 300));
    
    // Lock the shackle with morph animation
    await this.lockShackle();
    
    // Show success state with energy pulse
    this.showSuccess();
  }
  
  /**
   * Animate the shackle locking with path morphing and mechanical impact
   */
  lockShackle() {
    return new Promise((resolve) => {
      if (!this.shackle || typeof gsap === 'undefined') {
        resolve();
        return;
      }
      
      const tl = gsap.timeline({
        onComplete: resolve
      });
      
      // Phase 1: Morph shackle from open to closed path (attr is CSP-safe)
      tl.to(this.shackle, {
        attr: { d: this.closedShacklePath },
        duration: 0.5,
        ease: 'power3.inOut'
      })
      // Phase 2: Impact bounce on lock body (transform is CSP-safe)
      .to(this.lockContainer, {
        scale: 1.08,
        duration: 0.08,
        ease: 'power4.out'
      })
      .to(this.lockContainer, {
        scale: 0.95,
        duration: 0.06,
        ease: 'power2.in'
      })
      .to(this.lockContainer, {
        scale: 1.02,
        duration: 0.08,
        ease: 'power2.out'
      })
      .to(this.lockContainer, {
        scale: 1,
        duration: 0.2,
        ease: 'elastic.out(1, 0.4)'
      });
    });
  }
  
  /**
   * Success state - green glow, energy pulse, and success message
   */
  showSuccess() {
    if (!this.lockContainer) return;
    
    this.lockContainer.classList.remove('processing');
    this.lockContainer.classList.add('success');
    
    // Create energy pulse effect
    this.createEnergyPulse();
    
    // Show "Encrypted" message using CSS classes
    if (this.scrambleText) {
      this.scrambleText.classList.remove('hidden');
      this.scrambleText.classList.add('show-success');
      this.scrambleText.textContent = '✓ ENCRYPTED';
    }
    
    // Hide progress ring gracefully
    this.hideProgressRing();
    
    this.isAnimating = false;
  }
  
  /**
   * Create expanding energy pulse on success
   */
  createEnergyPulse() {
    if (!this.lockContainer) return;
    
    const pulse = document.createElement('div');
    pulse.classList.add('energy-pulse');
    this.lockContainer.appendChild(pulse);
    
    // Remove after animation
    setTimeout(() => pulse.remove(), 1000);
  }
  
  /**
   * Error state
   */
  showError(message = 'ENCRYPTION FAILED') {
    if (!this.lockContainer) return;
    
    // Stop all effects
    if (this.shackle && typeof gsap !== 'undefined') {
      gsap.killTweensOf(this.shackle);
    }
    this.stopParticles();
    this.hideProgressRing();
    
    this.lockContainer.classList.remove('processing', 'success');
    this.lockContainer.classList.add('error');
    
    if (this.scrambleText) {
      this.scrambleText.classList.remove('hidden', 'show-success');
      this.scrambleText.classList.add('show-error');
      this.scrambleText.textContent = `✗ ${message}`;
    }
    
    // Shake animation (transform is CSP-safe)
    if (typeof gsap !== 'undefined') {
      gsap.to(this.lockContainer, {
        x: [-8, 8, -6, 6, -4, 4, 0],
        duration: 0.5,
        ease: 'power2.out'
      });
    }
    
    this.isAnimating = false;
  }
  
  /**
   * Reset to idle state
   */
  reset() {
    // === HIDE FULLSCREEN OVERLAY IF ACTIVE ===
    if (this.isFullscreenMode) {
      this.hideFullscreenOverlay();
    }
    
    if (this.scrambleInterval) {
      clearInterval(this.scrambleInterval);
    }
    
    this.stopParticles();
    this.stopMegaParticles();
    this.refreshElements();
    
    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf([this.shackle, this.lockContainer, this.lockSvg, this.megaLock, this.megaShackle]);
      
      // Animate shackle opening with morph (attr is CSP-safe)
      if (this.shackle) {
        gsap.to(this.shackle, {
          attr: { d: this.openShacklePath },
          x: 0,
          y: 0,
          duration: 0.6,
          ease: 'power2.out'
        });
      }
      
      if (this.lockContainer) {
        gsap.to(this.lockContainer, {
          scale: 1,
          x: 0,
          duration: 0.3
        });
      }
    }
    
    if (this.lockContainer) {
      this.lockContainer.classList.remove('processing', 'success', 'error', 'file-ready');
    }
    
    this.hideProgressRing();
    
    if (this.scrambleText) {
      this.scrambleText.classList.add('hidden');
      this.scrambleText.classList.remove('show-success', 'show-error');
      this.scrambleText.textContent = '';
    }
    
    if (this.encryptionStatusEl) {
      this.encryptionStatusEl.classList.add('hidden');
    }
    
    if (this.fileNameEl) {
      this.fileNameEl.classList.remove('hidden');
    }
    
    if (this.fileSizeEl) {
      this.fileSizeEl.classList.remove('hidden');
    }
    
    this.isAnimating = false;
    this.isFullscreenMode = false;
    this.isCompleting = false;  // Reset completion guard
    this.currentProgress = 0;   // Reset progress tracker
  }
}


// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new EncryptionAnimator();
});
