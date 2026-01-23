/**
 * Encryption Animation Controller
 * Fullscreen overlay animation for secure file upload
 * Features: Morphing shackle, particles, progress ring, energy pulses
 * CSP-Compliant: Uses CSS classes instead of inline styles
 */

class EncryptionAnimator {
  constructor() {
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
    this.isCompleting = false;
    this.currentProgress = 0;
    this.targetProgress = 0;
    this.currentVisProgress = 0;
    this.animationFrameId = null;
    this.lastParticleTime = 0;
    this.particleInterval = 150; // ms between particles
    
    // Particle pool for object reuse (reduces GC pressure)
    this.particlePoolSize = 25;
    this.particlePool = [];
    this.activeParticles = [];
    
    // Scramble characters for particle effect
    this.dataChars = '0123456789ABCDEF';
    
    // Particle animation directions (CSP-compliant class-based)
    this.particleDirections = [
      'anim-top', 'anim-right', 'anim-bottom', 'anim-left',
      'anim-topleft', 'anim-topright', 'anim-bottomleft', 'anim-bottomright'
    ];
    
    // Shackle paths - morphing from open to closed
    this.openShacklePath = 'M16 36 L16 16 C16 5 24 -2 32 -2 C40 -2 48 5 48 16 L48 36';
    this.closedShacklePath = 'M16 36 L16 24 C16 13 24 6 32 6 C40 6 48 13 48 24 L48 36';
    
    this.initParticlePool();
    this.init();
  }
  
  init() {
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
    console.log('EncryptionAnimator initialized (fullscreen mode only)');
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
    this.isCompleting = false;
    this.currentProgress = 0; // Logical progress
    this.targetProgress = 0;
    this.currentVisProgress = 0; // Visual progress (animated)
    
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
    
    // Reset particle pool (don't destroy - reuse!)
    this.resetParticlePool();
    
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
    this.isCompleting = false;
    this.targetProgress = 0;
    this.currentVisProgress = 0;
    this.stopMegaParticles();
    
    // Fade out
    this.overlay.classList.remove('active');
    
    // Clean up after transition
    setTimeout(() => {
      if (this.megaLock) {
        this.megaLock.classList.remove('success', 'locking');
      }
      // Particles already returned to pool by stopMegaParticles
    }, 500);
  }
  
  /**
   * Update mega progress display
   */
  updateMegaProgress(percent, status) {
    // Ignore updates if not in fullscreen mode or if completion has started
    if (!this.isFullscreenMode || this.isCompleting) return;

    // Prevent backwards progress
    if (percent < this.targetProgress && percent > 0) {
      return;
    }
    this.targetProgress = percent;
    
    // Update status text immediately (optional, or could be in loop)
    if (this.megaStatusText && status) {
      const hexPart = Array(4).fill(0).map(() => 
        this.dataChars[Math.floor(Math.random() * this.dataChars.length)]
      ).join('');
      this.megaStatusText.textContent = `[${hexPart}] ${status.toUpperCase()}`;
    }
  }

  /**
   * Update visual progress with smoothing (LERP)
   * Called every frame
   */
  updateVisualProgress() {
    if (!this.isFullscreenMode) return;

    // LERP: Move current towards target
    // The factor 0.1 provides smooth easing. Adjust for speed.
    const diff = this.targetProgress - this.currentVisProgress;
    
    // If difference is very small and we are essentially there, just snap
    if (Math.abs(diff) < 0.1) {
      this.currentVisProgress = this.targetProgress;
    } else {
      // Dynamic speed: accelerate if far behind
      const speed = Math.max(0.05, Math.min(0.2, Math.abs(diff) * 0.05));
      this.currentVisProgress += diff * speed;
    }

    // Update progress ring (circumference = 283)
    if (this.megaRingFill) {
      const offset = 283 - (283 * this.currentVisProgress / 100);
      this.megaRingFill.setAttribute('stroke-dashoffset', offset.toString());
    }
    
    // Update percentage text
    if (this.megaProgressPercent) {
      this.megaProgressPercent.textContent = `${Math.round(this.currentVisProgress)}%`;
    }
  }
  
  /**
   * Start spawning data particles that stream toward the lock
   * Uses requestAnimationFrame for smooth, frame-synced animation
   */
  startMegaParticles() {
    if (!this.megaParticles) return;
    
    this.lastParticleTime = performance.now();
    
    const animateParticles = (currentTime) => {
      if (!this.isFullscreenMode || this.isCompleting) return;
      
      // Spawn new particle at interval
      if (currentTime - this.lastParticleTime >= this.particleInterval) {
        this.spawnParticleFromPool();
        this.lastParticleTime = currentTime;
      }
      
      // Check for particles to recycle
      this.recycleCompletedParticles();
      
      // Update smooth progress
      this.updateVisualProgress();
      
      this.animationFrameId = requestAnimationFrame(animateParticles);
    };
    
    this.animationFrameId = requestAnimationFrame(animateParticles);
  }
  
  /**
   * Stop particle spawning and recycle all active particles
   */
  stopMegaParticles() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Return all active particles to pool
    this.activeParticles.forEach(p => {
      p.element.classList.remove('mega-data-particle-active');
      this.particleDirections.forEach(dir => p.element.classList.remove(dir));
      this.particlePool.push(p);
    });
    this.activeParticles = [];
  }
  
  /**
   * Initialize the particle pool with reusable elements
   */
  initParticlePool() {
    if (!this.megaParticles) return;
    
    for (let i = 0; i < this.particlePoolSize; i++) {
      const particle = document.createElement('span');
      particle.classList.add('mega-data-particle');
      this.megaParticles.appendChild(particle);
      this.particlePool.push({
        element: particle,
        startTime: 0
      });
    }
  }
  
  /**
   * Spawn a particle from the pool (no DOM creation)
   */
  spawnParticleFromPool() {
    if (this.particlePool.length === 0) return;
    
    const particleObj = this.particlePool.pop();
    const particle = particleObj.element;
    
    // Reset and configure particle
    particle.textContent = this.dataChars[Math.floor(Math.random() * this.dataChars.length)];
    
    // Remove old direction class and add new one
    this.particleDirections.forEach(dir => particle.classList.remove(dir));
    const direction = this.particleDirections[Math.floor(Math.random() * this.particleDirections.length)];
    particle.classList.add(direction);
    particle.classList.add('mega-data-particle-active');
    
    particleObj.startTime = performance.now();
    this.activeParticles.push(particleObj);
  }
  
  /**
   * Recycle particles that have completed their animation
   */
  recycleCompletedParticles() {
    const now = performance.now();
    const animationDuration = 2100; // matches CSS animation duration
    
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      if (now - p.startTime >= animationDuration) {
        // Animation complete, return to pool
        p.element.classList.remove('mega-data-particle-active');
        this.particleDirections.forEach(dir => p.element.classList.remove(dir));
        this.particlePool.push(p);
        this.activeParticles.splice(i, 1);
      }
    }
  }
  
  /**
   * Reset all particles back to pool (for overlay show/hide)
   */
  resetParticlePool() {
    // Return all active particles to pool
    this.activeParticles.forEach(p => {
      p.element.classList.remove('mega-data-particle-active');
      this.particleDirections.forEach(dir => p.element.classList.remove(dir));
      this.particlePool.push(p);
    });
    this.activeParticles = [];
  }
  
  /**
   * Trigger lock closing animation and complete.
   * Called by showUploadSuccess() when the success view is ready.
   * Returns a Promise that resolves when animation is complete and overlay is hidden.
   */
  async triggerLockAndComplete() {
    // Guard against calls when not in fullscreen mode or already completing
    if (!this.isFullscreenMode || this.isCompleting) {
      return Promise.resolve();
    }
    this.isCompleting = true;
    
    // Ensure target is 100%
    this.targetProgress = 100;
    
    // Wait for visual progress to catch up (smooth finish)
    while (Math.abs(this.currentVisProgress - 100) > 0.5) {
       this.updateVisualProgress(); // Force update
       await new Promise(r => requestAnimationFrame(r));
    }
    
    // Snap to exact 100 for clean finish
    this.currentVisProgress = 100;
    if (this.megaRingFill) {
      this.megaRingFill.setAttribute('stroke-dashoffset', '0');
    }
    if (this.megaProgressPercent) {
      this.megaProgressPercent.textContent = '100%';
    }
    
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
    
    // Brief pause to appreciate the locked state, then hide
    await new Promise(r => setTimeout(r, 600));
    this.hideFullscreenOverlay();
    
    this.isAnimating = false;
  }
  
  /**
   * @deprecated Use triggerLockAndComplete() instead
   * Kept for backwards compatibility
   */
  async completeMegaEncryption() {
    return this.triggerLockAndComplete();
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
   * Start the encryption animation sequence
   * Shows the fullscreen overlay
   */
  startEncryptionSequence(filename) {
    this.isAnimating = true;
    this.currentFilename = filename;
    
    // Show the fullscreen overlay
    this.showFullscreenOverlay();
  }
  
  /**
   * Update progress display - routes to fullscreen mega display
   */
  updateProgressDisplay(percent, status) {
    if (this.isFullscreenMode) {
      this.updateMegaProgress(percent, status);
    }
  }
  
  /**
   * Reset to idle state
   */
  reset() {
    if (this.isFullscreenMode) {
      this.hideFullscreenOverlay();
    }
    
    this.stopMegaParticles();
    this.isAnimating = false;
    this.isFullscreenMode = false;
    this.isCompleting = false;
    this.targetProgress = 0;
    this.currentVisProgress = 0;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new EncryptionAnimator();
});
