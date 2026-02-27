/**
 * @module audio/hourglass/hourglass-player
 * Hourglass audio player orchestrator.
 * Assembles particles, gestures, reverse audio, and 3D overlay.
 */

import { WIDTH, HEIGHT, prefersReducedMotion } from "./hourglass-constants.js";
import { createParticleSystem } from "./hourglass-particles.js";
import {
  getPointerAngle,
  findSnapTarget,
  easeOutCubic,
  computePlaybackSpeed,
  createShakeDetector,
} from "./hourglass-gestures.js";
import { createReverseAudio } from "./hourglass-audio.js";
import { initHourglass3D } from "./hourglass-3d.js";

const SNAP_DURATION = 200;

/**
 * SVG frame for the hourglass - glyph-style with layered depth
 */
const HOURGLASS_FRAME_SVG = `
<svg viewBox="0 0 100 160" width="100" height="160" xmlns="http://www.w3.org/2000/svg" overflow="visible">
  <defs>
    <linearGradient id="hg-st" x1="50" y1="10" x2="50" y2="78" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#bdff00" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#bdff00" stop-opacity="0.15"/>
    </linearGradient>
    <linearGradient id="hg-sb" x1="50" y1="82" x2="50" y2="150" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#bdff00" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#bdff00" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="hg-ft" x1="50" y1="10" x2="50" y2="78" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#bdff00" stop-opacity="0.035"/>
      <stop offset="100%" stop-color="#bdff00" stop-opacity="0.008"/>
    </linearGradient>
    <linearGradient id="hg-fb" x1="50" y1="82" x2="50" y2="150" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#bdff00" stop-opacity="0.008"/>
      <stop offset="100%" stop-color="#bdff00" stop-opacity="0.035"/>
    </linearGradient>
    <filter id="hg-gl" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3"/>
    </filter>
  </defs>

  <!-- Ambient aura -->
  <g opacity="0.2" filter="url(#hg-gl)">
    <path d="M 10,10 L 90,10 L 54,78 L 46,78 Z" fill="none" stroke="#bdff00" stroke-width="3"/>
    <path d="M 46,82 L 54,82 L 90,150 L 10,150 Z" fill="none" stroke="#bdff00" stroke-width="3"/>
  </g>

  <!-- Glass body fill -->
  <path d="M 10,10 L 90,10 L 54,78 L 46,78 Z" fill="url(#hg-ft)"/>
  <path d="M 46,82 L 54,82 L 90,150 L 10,150 Z" fill="url(#hg-fb)"/>

  <!-- Inner frame (etched depth) -->
  <path d="M 14,13.5 L 86,13.5 L 53,76 L 47,76 Z"
        fill="none" stroke="rgba(189,255,0,0.09)" stroke-width="0.5" stroke-linejoin="round"/>
  <path d="M 47,84 L 53,84 L 86,146.5 L 14,146.5 Z"
        fill="none" stroke="rgba(189,255,0,0.09)" stroke-width="0.5" stroke-linejoin="round"/>

  <!-- Main frame -->
  <path d="M 10,10 L 90,10 L 54,78 L 46,78 Z"
        fill="none" stroke="url(#hg-st)" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M 46,82 L 54,82 L 90,150 L 10,150 Z"
        fill="none" stroke="url(#hg-sb)" stroke-width="1.5" stroke-linejoin="round"/>

  <!-- Base cap extensions -->
  <line x1="5" y1="10" x2="10" y2="10" stroke="rgba(189,255,0,0.3)" stroke-width="0.8" stroke-linecap="round"/>
  <line x1="90" y1="10" x2="95" y2="10" stroke="rgba(189,255,0,0.3)" stroke-width="0.8" stroke-linecap="round"/>
  <line x1="5" y1="150" x2="10" y2="150" stroke="rgba(189,255,0,0.3)" stroke-width="0.8" stroke-linecap="round"/>
  <line x1="90" y1="150" x2="95" y2="150" stroke="rgba(189,255,0,0.3)" stroke-width="0.8" stroke-linecap="round"/>

  <!-- Corner vertex dots -->
  <circle cx="10" cy="10" r="1.6" fill="rgba(189,255,0,0.45)"/>
  <circle cx="90" cy="10" r="1.6" fill="rgba(189,255,0,0.45)"/>
  <circle cx="10" cy="150" r="1.6" fill="rgba(189,255,0,0.45)"/>
  <circle cx="90" cy="150" r="1.6" fill="rgba(189,255,0,0.45)"/>

  <!-- Edge midpoint dots -->
  <circle cx="28" cy="44" r="0.9" fill="rgba(189,255,0,0.2)"/>
  <circle cx="72" cy="44" r="0.9" fill="rgba(189,255,0,0.2)"/>
  <circle cx="28" cy="116" r="0.9" fill="rgba(189,255,0,0.2)"/>
  <circle cx="72" cy="116" r="0.9" fill="rgba(189,255,0,0.2)"/>

  <!-- Rune ticks on top base -->
  <line x1="30" y1="10" x2="30" y2="6" stroke="rgba(189,255,0,0.2)" stroke-width="0.5" stroke-linecap="round"/>
  <line x1="50" y1="10" x2="50" y2="5" stroke="rgba(189,255,0,0.3)" stroke-width="0.6" stroke-linecap="round"/>
  <line x1="70" y1="10" x2="70" y2="6" stroke="rgba(189,255,0,0.2)" stroke-width="0.5" stroke-linecap="round"/>

  <!-- Rune ticks on bottom base -->
  <line x1="30" y1="150" x2="30" y2="154" stroke="rgba(189,255,0,0.2)" stroke-width="0.5" stroke-linecap="round"/>
  <line x1="50" y1="150" x2="50" y2="155" stroke="rgba(189,255,0,0.3)" stroke-width="0.6" stroke-linecap="round"/>
  <line x1="70" y1="150" x2="70" y2="154" stroke="rgba(189,255,0,0.2)" stroke-width="0.5" stroke-linecap="round"/>

  <!-- Vertical axis whiskers -->
  <line x1="50" y1="2" x2="50" y2="5" stroke="rgba(189,255,0,0.12)" stroke-width="0.4" stroke-linecap="round"/>
  <line x1="50" y1="155" x2="50" y2="158" stroke="rgba(189,255,0,0.12)" stroke-width="0.4" stroke-linecap="round"/>

  <!-- Chevrons near neck -->
  <path d="M 36,73 L 40,76.5 L 36,76.5" fill="none" stroke="rgba(189,255,0,0.18)" stroke-width="0.5" stroke-linejoin="round"/>
  <path d="M 64,73 L 60,76.5 L 64,76.5" fill="none" stroke="rgba(189,255,0,0.18)" stroke-width="0.5" stroke-linejoin="round"/>
  <path d="M 36,87 L 40,83.5 L 36,83.5" fill="none" stroke="rgba(189,255,0,0.18)" stroke-width="0.5" stroke-linejoin="round"/>
  <path d="M 64,87 L 60,83.5 L 64,83.5" fill="none" stroke="rgba(189,255,0,0.18)" stroke-width="0.5" stroke-linejoin="round"/>

  <!-- Neck horizontal accents -->
  <line x1="33" y1="80" x2="41" y2="80" stroke="rgba(189,255,0,0.22)" stroke-width="0.6" stroke-linecap="round"/>
  <line x1="59" y1="80" x2="67" y2="80" stroke="rgba(189,255,0,0.22)" stroke-width="0.6" stroke-linecap="round"/>

  <!-- Neck ornament -->
  <circle cx="50" cy="80" r="7" fill="none" stroke="rgba(189,255,0,0.1)" stroke-width="0.4">
    <animate attributeName="r" values="6.5;7.5;6.5" dur="5s" repeatCount="indefinite"/>
  </circle>
  <circle cx="50" cy="80" r="3.5" fill="none" stroke="rgba(189,255,0,0.25)" stroke-width="0.6"/>
  <circle cx="50" cy="80" r="1.2" fill="rgba(189,255,0,0.4)">
    <animate attributeName="opacity" values="0.3;0.55;0.3" dur="3s" repeatCount="indefinite"/>
  </circle>

  <!-- Neck cardinal dots -->
  <circle cx="50" cy="73" r="0.6" fill="rgba(189,255,0,0.2)"/>
  <circle cx="50" cy="87" r="0.6" fill="rgba(189,255,0,0.2)"/>
</svg>
`;

/**
 * Create hourglass audio player.
 * @param {HTMLElement} container - Container element for the player
 * @param {HTMLAudioElement} audio - Audio element to control
 * @returns {Object} Player API
 */
export const createHourglassPlayer = (container, audio) => {
  if (!container || !(audio instanceof HTMLAudioElement)) return null;

  // --- Canvas ---
  const canvas = document.createElement("canvas");
  canvas.className = "hourglass-canvas";
  canvas.width = WIDTH * 2;
  canvas.height = HEIGHT * 2;

  // --- Sub-systems ---
  const particleSys = createParticleSystem(canvas);
  const reverseAudio = createReverseAudio(audio);

  // --- State ---
  let progress = 0;
  let animationFrame = null;
  let isDragging = false;
  let disposed = false;
  let particleProgress = 0;
  let three3d = null;

  // Rotation
  let rotationAngle = 0;
  let isRotating = false;
  let rotationStartAngle = 0;
  let pointerStartAngle = 0;
  let userPaused = false;
  let playbackSpeed = 1;

  // Snap-on-release
  let isSnapping = false;
  let snapStartAngle = 0;
  let snapTargetAngle = 0;
  let snapStartTime = 0;

  // --- DOM setup ---
  const wrapper = document.createElement("div");
  wrapper.className = "hourglass-container";
  wrapper.innerHTML = HOURGLASS_FRAME_SVG;
  wrapper.style.transformOrigin = "center center";
  wrapper.style.transition = "none";

  const frameEl = wrapper.querySelector("svg");
  frameEl.classList.add("hourglass-frame");
  wrapper.insertBefore(canvas, frameEl);

  const shakeDetector = createShakeDetector(wrapper);

  const dragZone = document.createElement("div");
  dragZone.className = "hourglass-drag-zone";
  wrapper.appendChild(dragZone);

  const scrubZone = document.createElement("div");
  scrubZone.className = "hourglass-scrub";
  scrubZone.setAttribute("role", "slider");
  scrubZone.setAttribute("aria-label", "Seek");
  scrubZone.setAttribute("aria-valuemin", "0");
  scrubZone.setAttribute("aria-valuemax", "100");
  scrubZone.setAttribute("aria-valuenow", "0");
  scrubZone.tabIndex = 0;
  wrapper.appendChild(scrubZone);

  const retryBtn = document.createElement("button");
  retryBtn.className = "hourglass-retry";
  retryBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  retryBtn.hidden = true;
  retryBtn.setAttribute("aria-label", "Retry");
  wrapper.appendChild(retryBtn);

  container.appendChild(wrapper);

  // --- Playback speed ---
  const applyPlaybackSpeed = () => {
    playbackSpeed = computePlaybackSpeed(rotationAngle, shakeDetector.isShaking);

    if (userPaused) {
      if (reverseAudio.isReversed) reverseAudio.stop();
      return;
    }

    const absSpeed = Math.abs(playbackSpeed);

    if (absSpeed < 0.01) {
      if (!audio.paused) audio.pause();
      if (reverseAudio.isReversed) reverseAudio.stop();
      return;
    }

    if (playbackSpeed > 0) {
      if (reverseAudio.isReversed) {
        const t = reverseAudio.getForwardTime();
        reverseAudio.stop();
        audio.currentTime = t;
      }
      audio.playbackRate = Math.min(4, Math.max(0.25, playbackSpeed));
      if (audio.paused) audio.play().catch(() => {});
    } else {
      if (!audio.paused) audio.pause();
      if (!reverseAudio.isReversed && reverseAudio.hasBuffer) {
        reverseAudio.start(audio.currentTime, playbackSpeed);
      } else if (reverseAudio.isReversed) {
        reverseAudio.setSpeed(playbackSpeed);
      }
    }
  };

  // --- Animation loop ---
  let lastTime = performance.now();
  const tick = () => {
    if (disposed) return;

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Snap animation
    if (isSnapping) {
      const elapsed = now - snapStartTime;
      if (prefersReducedMotion || elapsed >= SNAP_DURATION) {
        rotationAngle = snapTargetAngle;
        isSnapping = false;
      } else {
        const t = easeOutCubic(elapsed / SNAP_DURATION);
        rotationAngle = snapStartAngle + (snapTargetAngle - snapStartAngle) * t;
      }
      wrapper.style.transform = `rotate(${rotationAngle}deg)`;
    }

    if (!isDragging) applyPlaybackSpeed();

    // Late-init particles
    if (!particleSys.hasParticles && audio.duration && Number.isFinite(audio.duration)) {
      particleSys.init(audio.duration);
    }

    if (particleSys.hasParticles && !retryBtn.hidden) {
      retryBtn.hidden = true;
    }

    // Update progress
    const duration = audio.duration;
    if (!isDragging && duration && Number.isFinite(duration)) {
      if (reverseAudio.isReversed) {
        const t = reverseAudio.getForwardTime();
        particleProgress = t;
        progress = t / duration;
      } else {
        const currentTime = audio.currentTime || 0;
        particleProgress = currentTime;
        progress = currentTime / duration;
      }
    }

    if (prefersReducedMotion) {
      particleSys.renderStatic(progress);
    } else {
      particleSys.update(dt, particleProgress, rotationAngle, playbackSpeed);
      particleSys.render();
    }

    if (three3d) three3d.render(dt);

    animationFrame = requestAnimationFrame(tick);
  };

  // --- Retry ---
  const showRetryIfNeeded = () => {
    if (disposed) return;
    if (
      !particleSys.hasParticles ||
      (audio.paused && !userPaused && !reverseAudio.isReversed && audio.currentTime === 0)
    ) {
      retryBtn.hidden = false;
    }
  };

  let retryTimeout = null;
  if (!prefersReducedMotion) {
    retryTimeout = setTimeout(showRetryIfNeeded, 3000);
  }

  audio.addEventListener("error", () => {
    if (!disposed) retryBtn.hidden = false;
  });

  retryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    retryBtn.hidden = true;
    if (audio.duration && Number.isFinite(audio.duration)) {
      particleSys.init(audio.duration);
    }
    audio.play().catch(() => {});
  });

  // --- Audio events ---
  const updateTime = () => {
    scrubZone.setAttribute(
      "aria-valuenow",
      String(Math.round((audio.currentTime / audio.duration) * 100) || 0),
    );
  };

  const updateDuration = () => {
    if (audio.duration && Number.isFinite(audio.duration) && !particleSys.hasParticles) {
      particleSys.init(audio.duration);
    }
    reverseAudio.prepare();
  };

  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("loadedmetadata", updateDuration);
  audio.addEventListener("durationchange", updateDuration);
  audio.addEventListener("error", () => {
    console.warn(
      "[hourglass] Audio failed to load:",
      audio.error?.message || "unknown error",
      audio.src,
    );
  });

  // --- Click to toggle play ---
  wrapper.addEventListener("click", (e) => {
    if (e.target === scrubZone) return;
    if (wrapper.dataset.wasRotating === "true") {
      wrapper.dataset.wasRotating = "false";
      return;
    }
    const playing = !audio.paused || reverseAudio.isReversed;
    if (playing) {
      userPaused = true;
      audio.pause();
      reverseAudio.stop();
    } else {
      userPaused = false;
    }
  });

  // --- Scrub interaction ---
  let scrubStartY = 0;
  let scrubStartProgress = 0;

  const handleScrubStart = (e) => {
    if (!audio.duration || !Number.isFinite(audio.duration)) return;
    if (reverseAudio.isReversed) reverseAudio.stop();
    isDragging = true;
    scrubStartY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    scrubStartProgress = progress;
    e.preventDefault();
  };

  const handleScrubMove = (e) => {
    if (!isDragging) return;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const deltaY = clientY - scrubStartY;
    const deltaProgress = deltaY / HEIGHT;
    progress = Math.max(0, Math.min(1, scrubStartProgress + deltaProgress));
    const newTime = progress * audio.duration;
    audio.currentTime = newTime;
    particleProgress = newTime;
    particleSys.redistribute(newTime);
  };

  const handleScrubEnd = () => {
    isDragging = false;
  };

  scrubZone.addEventListener("mousedown", handleScrubStart);
  scrubZone.addEventListener("touchstart", handleScrubStart, { passive: false });
  window.addEventListener("mousemove", handleScrubMove);
  window.addEventListener("touchmove", handleScrubMove, { passive: true });

  // --- Rotation interaction ---
  const handleRotationStart = (e) => {
    isSnapping = false;
    if (e.target === scrubZone) return;

    const rect = wrapper.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;

    const fromDragZone = e.target === dragZone;

    if (!fromDragZone) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distFromCenter = Math.sqrt(
        Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2),
      );
      const minRotationRadius = Math.min(rect.width, rect.height) * 0.15;
      if (distFromCenter < minRotationRadius) return;
    }

    isRotating = true;
    rotationStartAngle = rotationAngle;
    pointerStartAngle = getPointerAngle(clientX, clientY, rect);
    e.preventDefault();
  };

  const handleRotationMove = (e) => {
    if (!isRotating) return;

    const rect = wrapper.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;

    const currentPointerAngle = getPointerAngle(clientX, clientY, rect);
    let deltaAngle = currentPointerAngle - pointerStartAngle;

    if (deltaAngle > 180) deltaAngle -= 360;
    if (deltaAngle < -180) deltaAngle += 360;

    let newAngle = rotationStartAngle + deltaAngle;

    shakeDetector.detect(newAngle);

    // Magnetic snap detents at 0, 90, 180, 270
    const SNAP_THRESHOLD = 6;
    const SNAP_STRENGTH = 0.35;
    const normalized = ((newAngle % 360) + 360) % 360;
    const detents = [0, 90, 180, 270];
    for (const d of detents) {
      let dist = normalized - d;
      if (dist > 180) dist -= 360;
      if (dist < -180) dist += 360;
      if (Math.abs(dist) < SNAP_THRESHOLD) {
        newAngle -= dist * SNAP_STRENGTH;
        break;
      }
    }

    rotationAngle = newAngle;
    wrapper.style.transform = `rotate(${rotationAngle}deg)`;
    userPaused = false;
  };

  const handleRotationEnd = () => {
    if (!isRotating) return;
    isRotating = false;
    wrapper.dataset.wasRotating = "true";
    shakeDetector.resetDirection();

    const target = findSnapTarget(rotationAngle);
    if (target !== null) {
      snapStartAngle = rotationAngle;
      snapTargetAngle = target;
      snapStartTime = performance.now();
      isSnapping = true;
    }
  };

  wrapper.addEventListener("mousedown", handleRotationStart);
  wrapper.addEventListener("touchstart", handleRotationStart, { passive: false });
  window.addEventListener("mousemove", handleRotationMove);
  window.addEventListener("touchmove", handleRotationMove, { passive: true });
  window.addEventListener("mouseup", handleRotationEnd);
  window.addEventListener("touchend", handleRotationEnd);
  window.addEventListener("mouseup", handleScrubEnd);
  window.addEventListener("touchend", handleScrubEnd);

  // --- Keyboard ---
  scrubZone.addEventListener("keydown", (e) => {
    if (!audio.duration || !Number.isFinite(audio.duration)) return;
    const step = audio.duration * 0.05;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
      e.preventDefault();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      audio.currentTime = Math.max(0, audio.currentTime - step);
      e.preventDefault();
    }
  });

  // --- Init ---
  updateDuration();
  updateTime();
  animationFrame = requestAnimationFrame(tick);

  // Launch 3D overlay
  if (!prefersReducedMotion) {
    initHourglass3D(wrapper)
      .then((api) => {
        if (disposed) {
          api?.dispose();
          return;
        }
        three3d = api;
        if (three3d) {
          frameEl.style.display = "none";
          wrapper.insertBefore(three3d.canvas, scrubZone);
        }
      })
      .catch(() => {});
  }

  // --- Public API ---
  return {
    get speed() {
      return userPaused ? 0 : playbackSpeed;
    },

    togglePlay() {
      const playing = !audio.paused || reverseAudio.isReversed;
      if (playing) {
        userPaused = true;
        audio.pause();
        reverseAudio.stop();
      } else {
        userPaused = false;
        audio.play().catch(() => {});
      }
    },

    get playing() {
      return !audio.paused || reverseAudio.isReversed;
    },

    restart() {
      reverseAudio.stop();
      audio.currentTime = 0;
      particleProgress = 0;
      playbackSpeed = 1;
      userPaused = false;
      particleSys.redistribute(0);
      audio.play().catch(() => {});
    },

    dispose() {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      shakeDetector.dispose();
      if (retryTimeout) clearTimeout(retryTimeout);
      reverseAudio.dispose();
      if (three3d) {
        three3d.dispose();
        three3d = null;
      }

      window.removeEventListener("mousemove", handleScrubMove);
      window.removeEventListener("touchmove", handleScrubMove);
      window.removeEventListener("mouseup", handleScrubEnd);
      window.removeEventListener("touchend", handleScrubEnd);
      window.removeEventListener("mousemove", handleRotationMove);
      window.removeEventListener("touchmove", handleRotationMove);
      window.removeEventListener("mouseup", handleRotationEnd);
      window.removeEventListener("touchend", handleRotationEnd);

      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("durationchange", updateDuration);

      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    },
  };
};
