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
    this.currentProgress = 0;
    
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
    this.currentProgress = 0;
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
    
    // Prevent backwards progress (except for explicit reset)
    if (percent < this.currentProgress && percent > 0) {
      return;
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
   * Complete mega encryption with dramatic lock close
   */
  async completeMegaEncryption() {
    // Guard against multiple calls during async completion
    if (!this.isFullscreenMode || this.isCompleting) return;
    this.isCompleting = true;
    
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
    this.currentProgress = 0;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new EncryptionAnimator();
});
