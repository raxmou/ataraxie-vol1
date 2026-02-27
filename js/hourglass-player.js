/**
 * Simplified hourglass audio player with two triangles and physics-based particles.
 * 1 particle per second of track duration.
 */

import { loadThreeModule } from "./three/three-loader.js";

const WIDTH = 100;
const HEIGHT = 160;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const TRIANGLE_HEIGHT = 70;
const GAP = 4;
const PARTICLE_COLOR = { r: 189, g: 255, b: 0 };

// Triangle vertices
const TOP_APEX_Y = CENTER_Y - GAP / 2;
const TOP_BASE_Y = 10;
const BOTTOM_APEX_Y = CENTER_Y + GAP / 2;
const BOTTOM_BASE_Y = HEIGHT - 10;

// Triangle half-width at base
const BASE_HALF_WIDTH = 40;

// Triangle area calculation for particle sizing
// Base = 80, Height = 68, Area = 0.5 * 80 * 68 = 2720
const TRIANGLE_AREA = 0.5 * (BASE_HALF_WIDTH * 2) * (TOP_APEX_Y - TOP_BASE_Y);
const TARGET_FILL = 0.8; // Particles should fill 80% of triangle
const PACKING_EFFICIENCY = 0.35; // Physics packing in triangular shape is ~35% efficient

// Detect reduced motion preference
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Build a procedural 3D hourglass overlay.
 * @param {HTMLElement} wrapper - The .hourglass-container element
 * @returns {Promise<{ render: (dt: number) => void, dispose: () => void, canvas: HTMLCanvasElement } | null>}
 */
const initHourglass3D = async (wrapper) => {
  const THREE = await loadThreeModule();

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
  const canvas3d = renderer.domElement;
  canvas3d.className = "hourglass-3d";

  // --- Scene & Camera ---
  const scene = new THREE.Scene();
  const fov = 20;
  const vFov = (fov * Math.PI) / 180;
  const camDist = 160 / 2 / Math.tan(vFov / 2);
  const camera = new THREE.PerspectiveCamera(
    fov,
    wrapper.clientWidth / wrapper.clientHeight,
    1,
    camDist * 3,
  );
  camera.position.set(0, 0, camDist);
  camera.lookAt(0, 0, 0);

  // --- Lighting ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
  keyLight.position.set(30, 60, 80);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xbdff00, 0.35);
  rimLight.position.set(-40, -20, 60);
  scene.add(rimLight);

  // --- Hourglass profile (LatheGeometry) ---
  const BASE_R = 40;
  const NECK_R = 4;
  const HALF_H = 70;
  const POINTS = 48;
  const profilePts = [];
  for (let i = 0; i <= POINTS; i++) {
    const u = (i / POINTS) * 2 - 1; // -1 (bottom) to +1 (top)
    const r = NECK_R + (BASE_R - NECK_R) * Math.pow(Math.abs(u), 1.3);
    const y = u * HALF_H;
    profilePts.push(new THREE.Vector2(r, y));
  }
  const hourglassGeo = new THREE.LatheGeometry(profilePts, 32);

  // --- Materials (all depthWrite: false for transparency layering) ---
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbdff00,
    emissive: 0xbdff00,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.2,
    metalness: 0.0,
    clearcoat: 0.3,
  });

  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xbdff00,
    wireframe: true,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
  });

  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xbdff00,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.BackSide,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xbdff00,
    emissive: 0xbdff00,
    emissiveIntensity: 0.15,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    metalness: 0.6,
    roughness: 0.3,
  });

  // --- Group ---
  const group = new THREE.Group();

  group.add(new THREE.Mesh(hourglassGeo, glassMat));
  group.add(new THREE.Mesh(hourglassGeo, wireMat));
  group.add(new THREE.Mesh(hourglassGeo, edgeMat));

  // Rims at top & bottom
  const rimGeo = new THREE.TorusGeometry(BASE_R, 1.2, 12, 32);
  const topRim = new THREE.Mesh(rimGeo, rimMat);
  topRim.position.y = HALF_H;
  topRim.rotation.x = Math.PI / 2;
  group.add(topRim);

  const bottomRim = new THREE.Mesh(rimGeo, rimMat);
  bottomRim.position.y = -HALF_H;
  bottomRim.rotation.x = Math.PI / 2;
  group.add(bottomRim);

  // Neck ring
  const neckGeo = new THREE.TorusGeometry(NECK_R, 0.6, 8, 32);
  const neckRing = new THREE.Mesh(neckGeo, rimMat);
  neckRing.rotation.x = Math.PI / 2;
  group.add(neckRing);

  scene.add(group);

  // --- Animation state ---
  let elapsed = 0;

  return {
    canvas: canvas3d,
    render(dt) {
      elapsed += dt;
      group.rotation.y = Math.sin(elapsed * 0.4) * 0.15;
      renderer.render(scene, camera);
    },
    dispose() {
      hourglassGeo.dispose();
      rimGeo.dispose();
      neckGeo.dispose();
      glassMat.dispose();
      wireMat.dispose();
      edgeMat.dispose();
      rimMat.dispose();
      renderer.dispose();
      if (canvas3d.parentNode) canvas3d.parentNode.removeChild(canvas3d);
    },
  };
};

/**
 * Calculate particle radius based on count to fill 80% of triangle area.
 * Accounts for circle packing inefficiency.
 * @param {number} count - Number of particles
 * @returns {number} Particle radius
 */
const calculateParticleRadius = (count) => {
  if (count <= 0) return 3;
  // With packing efficiency, actual usable area for circles is less
  // Total circle area = TRIANGLE_AREA * TARGET_FILL * PACKING_EFFICIENCY
  const totalCircleArea = TRIANGLE_AREA * TARGET_FILL * PACKING_EFFICIENCY;
  const particleArea = totalCircleArea / count;
  const radius = Math.sqrt(particleArea / Math.PI);
  // Clamp between min and max for visibility (allow smaller for long tracks)
  return Math.max(1.2, Math.min(4, radius));
};

/**
 * Get triangle bounds at a given y position.
 * @param {number} y - Y coordinate
 * @param {boolean} isTop - True for top triangle, false for bottom
 * @param {number} holeHalfWidth - Minimum half-width at the apex (hole size)
 * @returns {{ left: number, right: number } | null}
 */
const getTriangleBounds = (y, isTop, holeHalfWidth = 0) => {
  if (isTop) {
    // Top triangle: apex at bottom, base at top
    if (y < TOP_BASE_Y || y > TOP_APEX_Y) return null;
    const t = (y - TOP_BASE_Y) / (TOP_APEX_Y - TOP_BASE_Y);
    // Interpolate from BASE_HALF_WIDTH to holeHalfWidth (not to 0)
    const halfWidth = BASE_HALF_WIDTH * (1 - t) + holeHalfWidth * t;
    return { left: CENTER_X - halfWidth, right: CENTER_X + halfWidth };
  } else {
    // Bottom triangle: apex at top, base at bottom
    if (y < BOTTOM_APEX_Y || y > BOTTOM_BASE_Y) return null;
    const t = (y - BOTTOM_APEX_Y) / (BOTTOM_BASE_Y - BOTTOM_APEX_Y);
    // Interpolate from holeHalfWidth to BASE_HALF_WIDTH
    const halfWidth = holeHalfWidth * (1 - t) + BASE_HALF_WIDTH * t;
    return { left: CENTER_X - halfWidth, right: CENTER_X + halfWidth };
  }
};

/**
 * Get wall normal for collision with triangle wall.
 * @param {boolean} isTop - True for top triangle
 * @param {boolean} isLeft - True for left wall
 * @returns {{ nx: number, ny: number }}
 */
const getWallNormal = (isTop, isLeft) => {
  // Calculate normal from wall slope
  const dx = isLeft ? -BASE_HALF_WIDTH : BASE_HALF_WIDTH;
  const dy = isTop ? TOP_APEX_Y - TOP_BASE_Y : BOTTOM_BASE_Y - BOTTOM_APEX_Y;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Normal points inward
  if (isTop) {
    return isLeft ? { nx: dy / len, ny: -dx / len } : { nx: -dy / len, ny: dx / len };
  } else {
    return isLeft ? { nx: dy / len, ny: dx / len } : { nx: -dy / len, ny: -dx / len };
  }
};

/**
 * Format time as MM:SS
 */
const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * Particle class
 */
class Particle {
  constructor(x, y, size) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = 0;
    this.size = size * (0.85 + Math.random() * 0.3); // Slight variation
    this.alpha = 0.75 + Math.random() * 0.25;
    this.settled = false;
    this.inBottom = false;
    this.falling = false; // Currently falling through the gap
    this.onFloor = false; // Touching floor or resting on another particle
    this.restFrames = 0; // Consecutive near-rest frames for settling
  }

  reset(x, y, inBottom) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = 0;
    this.settled = false;
    this.inBottom = inBottom;
    this.falling = false;
    this.onFloor = false;
    this.restFrames = 0;
  }
}

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

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.className = "hourglass-canvas";
  canvas.width = WIDTH * 2; // 2x for retina
  canvas.height = HEIGHT * 2;

  const ctx = canvas.getContext("2d");

  // Particles - will be created when audio duration is known
  let particles = [];
  let totalParticles = 0;

  // State
  let progress = 0;
  let animationFrame = null;
  let isDragging = false;
  let disposed = false;
  let fallenCount = 0; // Tracks how many particles have fallen through the hole
  let particleProgress = 0; // Independent progress for particles (can go backwards)
  let three3d = null; // 3D hourglass overlay (set async)

  // Rotation state
  let rotationAngle = 0; // Current visual rotation (degrees)
  let isRotating = false; // Rotation drag state
  let rotationStartAngle = 0; // Angle when drag started
  let pointerStartAngle = 0; // Pointer angle when drag started
  let userPaused = false; // Track if user manually paused

  // Playback speed state
  let playbackSpeed = 1; // Current speed: -2 to 2
  let shakeHistory = []; // Recent rotation direction changes (timestamps)
  let lastRotationDirection = 0; // 1 = clockwise, -1 = counter-clockwise
  let lastRotationAngle = 0; // Previous angle for direction detection
  let isShaking = false; // Shake boost active
  let shakeDecayTimer = null; // Timer to reset shake boost

  // Shake detection constants
  const SHAKE_WINDOW = 500; // ms to detect shake pattern
  const SHAKE_MIN_CHANGES = 2; // Min direction reversals needed
  const SHAKE_BOOST_DURATION = 2000; // How long x2 lasts (ms)

  // Snap-on-release
  let isSnapping = false;
  let snapStartAngle = 0;
  let snapTargetAngle = 0;
  let snapStartTime = 0;
  const SNAP_DURATION = 200; // ms
  const SNAP_RELEASE_THRESHOLD = 20; // degrees from detent to trigger snap

  // Particle size and hole width (calculated when duration is known)
  let particleRadius = 3;
  let holeHalfWidth = 4; // Minimum hole half-width to fit one particle
  let lastPhysicsAngle = 0; // Track rotation for waking settled particles

  // Reverse audio playback (Web Audio API)
  let audioCtx = null;
  let reversedBuffer = null;
  let reverseSource = null;
  let reverseStartCtxTime = 0; // AudioContext.currentTime when reverse started
  let reverseStartOffset = 0; // Offset in reversed buffer when started
  let isPlayingReversed = false;

  const ensureAudioContext = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  };

  /** Fetch + decode audio, then reverse the buffer data. */
  const prepareReverseBuffer = async () => {
    if (reversedBuffer) return;
    const src = audio.currentSrc || audio.src;
    if (!src) return;
    try {
      const ctx = ensureAudioContext();
      const resp = await fetch(src);
      const buf = await resp.arrayBuffer();
      const original = await ctx.decodeAudioData(buf);
      reversedBuffer = ctx.createBuffer(
        original.numberOfChannels,
        original.length,
        original.sampleRate,
      );
      for (let ch = 0; ch < original.numberOfChannels; ch++) {
        const fwd = original.getChannelData(ch);
        const rev = reversedBuffer.getChannelData(ch);
        for (let i = 0, len = fwd.length; i < len; i++) {
          rev[i] = fwd[len - 1 - i];
        }
      }
    } catch (_) {
      // Reverse audio unavailable — silent fallback
    }
  };

  const startReversePlayback = (forwardTime) => {
    if (!reversedBuffer) return;
    stopReversePlayback();
    const ctx = ensureAudioContext();
    const offset = Math.max(0, reversedBuffer.duration - forwardTime);
    reverseSource = ctx.createBufferSource();
    reverseSource.buffer = reversedBuffer;
    reverseSource.playbackRate.value = Math.min(4, Math.max(0.25, Math.abs(playbackSpeed)));
    reverseSource.connect(ctx.destination);
    reverseSource.start(0, offset);
    reverseStartCtxTime = ctx.currentTime;
    reverseStartOffset = offset;
    isPlayingReversed = true;
  };

  const stopReversePlayback = () => {
    if (reverseSource) {
      try {
        reverseSource.stop();
      } catch (_) {}
      reverseSource.disconnect();
      reverseSource = null;
    }
    isPlayingReversed = false;
  };

  /** Map current position in reversed buffer back to forward time. */
  const getReverseForwardTime = () => {
    if (!isPlayingReversed || !audioCtx || !reversedBuffer) return audio.currentTime || 0;
    const elapsed = audioCtx.currentTime - reverseStartCtxTime;
    const rate = reverseSource ? reverseSource.playbackRate.value : 1;
    const pos = reverseStartOffset + elapsed * rate;
    return Math.max(0, reversedBuffer.duration - pos);
  };

  /**
   * Get pointer angle from center of wrapper (0° at top, clockwise positive).
   */
  const getPointerAngle = (clientX, clientY, rect) => {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    return Math.atan2(dx, -dy) * (180 / Math.PI); // 0° at top
  };

  /**
   * Get normalized rotation (0-360).
   */
  const getNormalizedRotation = () => {
    return ((rotationAngle % 360) + 360) % 360;
  };

  /**
   * Get playback speed from rotation angle using linear interpolation.
   * 0° → 1 (forward), 90° → 0 (paused), 180° → -1 (reverse), 270° → 0 (paused)
   */
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  /**
   * Find snap target preserving winding direction.
   * Returns target angle (accounting for multi-revolution) or null if too far.
   */
  const findSnapTarget = (angle) => {
    const normalized = ((angle % 360) + 360) % 360;
    const base = angle - normalized; // winding offset
    const detents = [0, 90, 180, 270, 360]; // 360 to handle wrap from ~350°
    let bestDetent = null;
    let bestDist = Infinity;
    for (const d of detents) {
      const dist = Math.abs(normalized - d);
      if (dist < bestDist) {
        bestDist = dist;
        bestDetent = d;
      }
    }
    if (bestDist > SNAP_RELEASE_THRESHOLD) return null;
    // 360 detent means snap to next revolution's 0
    return base + bestDetent;
  };

  const getSpeedFromRotation = (angle) => {
    const normalized = ((angle % 360) + 360) % 360;

    if (normalized <= 90) {
      // 0° to 90°: x1 → x0
      return 1 - normalized / 90;
    } else if (normalized <= 180) {
      // 90° to 180°: x0 → x-1
      return -((normalized - 90) / 90);
    } else if (normalized <= 270) {
      // 180° to 270°: x-1 → x0
      return -1 + (normalized - 180) / 90;
    } else {
      // 270° to 360°: x0 → x1
      return (normalized - 270) / 90;
    }
  };

  /**
   * Detect shake gesture by tracking rotation direction reversals.
   */
  const detectShake = (currentAngle) => {
    const delta = currentAngle - lastRotationAngle;
    // Ignore very small movements
    if (Math.abs(delta) < 2) return;

    const direction = delta > 0 ? 1 : -1;

    if (direction !== lastRotationDirection && lastRotationDirection !== 0) {
      // Direction changed - record timestamp
      shakeHistory.push(performance.now());

      // Clean old entries outside the window
      const now = performance.now();
      shakeHistory = shakeHistory.filter((t) => now - t < SHAKE_WINDOW);

      // Check if enough reversals in window
      if (shakeHistory.length >= SHAKE_MIN_CHANGES) {
        triggerShakeBoost();
      }
    }

    lastRotationDirection = direction;
    lastRotationAngle = currentAngle;
  };

  /**
   * Trigger shake boost - doubles speed for SHAKE_BOOST_DURATION.
   */
  const triggerShakeBoost = () => {
    isShaking = true;
    shakeHistory = [];

    // Clear previous timer
    if (shakeDecayTimer) clearTimeout(shakeDecayTimer);

    // Auto-decay after duration
    shakeDecayTimer = setTimeout(() => {
      isShaking = false;
      wrapper.classList.remove("is-boosted");
    }, SHAKE_BOOST_DURATION);

    // Visual feedback
    wrapper.classList.add("is-boosted");
  };

  /**
   * Update playback speed based on rotation and shake state.
   */
  const updatePlaybackSpeed = () => {
    const baseSpeed = getSpeedFromRotation(rotationAngle);
    // Shake doubles the speed (preserving direction)
    playbackSpeed = isShaking ? baseSpeed * 2 : baseSpeed;
  };

  /**
   * Initialize particles based on track duration.
   */
  const initParticles = (duration) => {
    totalParticles = Math.floor(duration);
    particles = [];
    fallenCount = 0; // Reset fallen count

    if (prefersReducedMotion || totalParticles === 0) return;

    // Calculate particle size to fill 80% of triangle
    particleRadius = calculateParticleRadius(totalParticles);

    // Hole must fit at least one particle with some margin
    holeHalfWidth = particleRadius + 1;

    for (let i = 0; i < totalParticles; i++) {
      // Random position in top triangle, respecting particle size margins
      const margin = particleRadius + 2;
      const y = TOP_BASE_Y + margin + Math.random() * (TOP_APEX_Y - TOP_BASE_Y - margin * 2 - 10);
      const bounds = getTriangleBounds(y, true, holeHalfWidth);
      if (bounds) {
        const x = bounds.left + margin + Math.random() * (bounds.right - bounds.left - margin * 2);
        particles.push(new Particle(x, y, particleRadius));
      }
    }
  };

  /**
   * Update particle physics.
   * @param {number} dt - Delta time in seconds
   * @param {number} currentTime - Current audio time in seconds
   */
  const updateParticles = (dt, currentTime) => {
    if (prefersReducedMotion || particles.length === 0) return;

    const gravityMagnitude = 0.3;
    const friction = 0.92;
    const bounceDamping = 0.3;

    // Calculate gravity vector based on rotation
    // Transforms world gravity (always down) into hourglass local coordinates
    const rotationRad = rotationAngle * (Math.PI / 180);
    const gravityX = gravityMagnitude * Math.sin(rotationRad);
    const gravityY = gravityMagnitude * Math.cos(rotationRad);

    // Wake settled particles when rotation changes (gravity direction shifted)
    const angleDelta = Math.abs(rotationAngle - lastPhysicsAngle);
    if (angleDelta > 0.5) {
      particles.forEach((p) => {
        if (p.settled && !p.falling) {
          p.settled = false;
          p.onFloor = false;
        }
      });
      lastPhysicsAngle = rotationAngle;
    }

    // Determine if we're inverted based on playback speed direction
    // (negative speed means we're going backwards, so particles should flow upward)
    const isInverted = playbackSpeed < 0;

    // Target: 1 particle should fall per second of audio
    const targetFallen = Math.min(Math.floor(currentTime), totalParticles);
    let releasedThisFrame = false;

    // Reset onFloor for all non-settled particles (will be recalculated)
    particles.forEach((p) => {
      if (!p.settled) p.onFloor = false;
    });

    // First pass: apply gravity and movement to all non-settled particles
    particles.forEach((p) => {
      if (p.settled || p.falling) return;

      // Apply gravity (direction based on rotation)
      p.vx += gravityX;
      p.vy += gravityY;
      p.vx *= friction;
      p.vy *= friction;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
    });

    // Particle release logic - depends on direction
    if (!isInverted) {
      // Normal: release from top triangle when more particles should have fallen
      if (!releasedThisFrame && fallenCount < targetFallen) {
        let bestParticle = null;
        let bestScore = Infinity;

        // Find the settled particle in top triangle closest to the hole
        particles.forEach((p) => {
          if (p.settled && !p.inBottom && !p.falling) {
            const distFromCenter = Math.abs(p.x - CENTER_X);
            const distFromBottom = TOP_APEX_Y - p.y;
            const score = distFromCenter + distFromBottom * 0.5;
            if (score < bestScore) {
              bestScore = score;
              bestParticle = p;
            }
          }
        });

        if (bestParticle) {
          bestParticle.settled = false;
          bestParticle.falling = true;
          bestParticle.x = CENTER_X;
          bestParticle.y = TOP_APEX_Y;
          bestParticle.vy = 0.5;
          fallenCount++;
          releasedThisFrame = true;

          // Wake up particles in top triangle
          particles.forEach((p) => {
            if (p !== bestParticle && p.settled && !p.inBottom) {
              p.settled = false;
              p.onFloor = false;
            }
          });
        }
      }
    } else {
      // Inverted: release from bottom triangle when particles should return
      if (!releasedThisFrame && fallenCount > targetFallen) {
        let bestParticle = null;
        let bestScore = Infinity;

        // Find the settled particle in bottom triangle closest to the hole (at top of bottom)
        particles.forEach((p) => {
          if (p.settled && p.inBottom && !p.falling) {
            const distFromCenter = Math.abs(p.x - CENTER_X);
            const distFromTop = p.y - BOTTOM_APEX_Y; // Distance from hole
            const score = distFromCenter + distFromTop * 0.5;
            if (score < bestScore) {
              bestScore = score;
              bestParticle = p;
            }
          }
        });

        if (bestParticle) {
          bestParticle.settled = false;
          bestParticle.falling = true;
          bestParticle.x = CENTER_X;
          bestParticle.y = BOTTOM_APEX_Y;
          bestParticle.vy = -0.5; // Upward velocity
          fallenCount--;
          releasedThisFrame = true;

          // Wake up particles in bottom triangle
          particles.forEach((p) => {
            if (p !== bestParticle && p.settled && p.inBottom) {
              p.settled = false;
              p.onFloor = false;
            }
          });
        }
      }
    }

    // Second pass: handle collisions and boundaries
    particles.forEach((p) => {
      if (p.falling) {
        // Particle falling through the hole
        p.vx += gravityX;
        p.vy += gravityY;
        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;

        if (!isInverted) {
          // Normal: falling down from top to bottom
          if (p.y > BOTTOM_APEX_Y + p.size) {
            p.falling = false;
            p.inBottom = true;
            p.settled = false;

            // Wake up nearby particles in bottom triangle (not all)
            const wakeRadius = p.size * 6;
            particles.forEach((other) => {
              if (other !== p && other.inBottom && other.settled) {
                const dx = other.x - p.x;
                const dy = other.y - p.y;
                if (dx * dx + dy * dy < wakeRadius * wakeRadius) {
                  other.settled = false;
                  other.onFloor = false;
                  other.restFrames = 0;
                }
              }
            });
          }
        } else {
          // Inverted: falling up from bottom to top
          if (p.y < TOP_APEX_Y - p.size) {
            p.falling = false;
            p.inBottom = false;
            p.settled = false;

            // Wake up nearby particles in top triangle (not all)
            const wakeRadius = p.size * 6;
            particles.forEach((other) => {
              if (other !== p && !other.inBottom && other.settled) {
                const dx = other.x - p.x;
                const dy = other.y - p.y;
                if (dx * dx + dy * dy < wakeRadius * wakeRadius) {
                  other.settled = false;
                  other.onFloor = false;
                  other.restFrames = 0;
                }
              }
            });
          }
        }
        return;
      }

      if (p.settled) return;

      // Active particle - handle boundaries
      if (!p.inBottom) {
        // Top triangle
        const bounds = getTriangleBounds(p.y, true, holeHalfWidth);
        if (bounds) {
          // Wall collisions with sliding force
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * bounceDamping * 0.3;
            // Apply wall-sliding force from gravity
            const normal = getWallNormal(true, true);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * bounceDamping * 0.3;
            // Apply wall-sliding force from gravity
            const normal = getWallNormal(true, false);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
        }

        // Floor/ceiling collision depends on gravity direction
        if (!isInverted) {
          // Normal: floor at bottom of top triangle (apex)
          if (p.y >= TOP_APEX_Y - p.size) {
            p.y = TOP_APEX_Y - p.size;
            p.vy = -Math.abs(p.vy) * bounceDamping;
            p.onFloor = true;
          } else {
            p.onFloor = false;
          }
        } else {
          // Inverted: floor at top of top triangle (base)
          if (p.y <= TOP_BASE_Y + p.size) {
            p.y = TOP_BASE_Y + p.size;
            p.vy = Math.abs(p.vy) * bounceDamping;
            p.onFloor = true;
          } else {
            p.onFloor = false;
          }
        }
      } else {
        // Bottom triangle
        const bounds = getTriangleBounds(p.y, false, holeHalfWidth);
        let hitWall = false;
        if (bounds) {
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * bounceDamping * 0.3;
            hitWall = true;
            // Apply wall-sliding force from gravity
            const normal = getWallNormal(false, true);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * bounceDamping * 0.3;
            hitWall = true;
            // Apply wall-sliding force from gravity
            const normal = getWallNormal(false, false);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
        }

        // Floor/ceiling collision depends on gravity direction
        if (!isInverted) {
          // Normal: floor at bottom of bottom triangle (base)
          if (p.y >= BOTTOM_BASE_Y - p.size - 2) {
            p.y = BOTTOM_BASE_Y - p.size - 2;
            p.vy = -Math.abs(p.vy) * bounceDamping;
            p.vx *= 0.9; // Friction on floor
            p.onFloor = true;
          } else {
            p.onFloor = false;
          }
        } else {
          // Inverted: floor at top of bottom triangle (apex)
          if (p.y <= BOTTOM_APEX_Y + p.size + 2) {
            p.y = BOTTOM_APEX_Y + p.size + 2;
            p.vy = Math.abs(p.vy) * bounceDamping;
            p.vx *= 0.9; // Friction on floor
            p.onFloor = true;
          } else {
            p.onFloor = false;
          }
        }

        // General velocity decay in bottom triangle to help settling
        p.vx *= 0.98;
        p.vy *= 0.98;
      }
    });

    // Third pass: particle-to-particle collision (multiple passes for chain reaction)
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        if (p1.falling) continue;

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          if (p2.falling) continue;
          if (p1.inBottom !== p2.inBottom) continue;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const distSq = dx * dx + dy * dy;
          const minDist = p1.size + p2.size;

          if (distSq < minDist * minDist && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;

            const p1IsAbove = p1.y < p2.y;
            const inBottom = p1.inBottom;

            // Calculate impact force from moving particle
            const p1Speed = Math.sqrt(p1.vx * p1.vx + p1.vy * p1.vy);
            const p2Speed = Math.sqrt(p2.vx * p2.vx + p2.vy * p2.vy);

            if (p2.settled && p1Speed > 0.3) {
              // p1 is moving fast and hits settled p2 - transfer momentum
              p2.settled = false;
              p2.onFloor = false;
              // Transfer velocity along collision normal
              const transferFactor = 0.6;
              const impactVel = (p1.vx * nx + p1.vy * ny) * transferFactor;
              p2.vx += impactVel * nx;
              p2.vy += impactVel * ny;
              // Dampen p1
              p1.vx *= 0.5;
              p1.vy *= 0.5;
              // Push apart
              p1.x -= nx * overlap;
              p1.y -= ny * overlap;
            } else if (p1.settled && p2Speed > 0.3) {
              // p2 is moving fast and hits settled p1 - transfer momentum
              p1.settled = false;
              p1.onFloor = false;
              const transferFactor = 0.6;
              const impactVel = (p2.vx * nx + p2.vy * ny) * transferFactor;
              p1.vx -= impactVel * nx;
              p1.vy -= impactVel * ny;
              p2.vx *= 0.5;
              p2.vy *= 0.5;
              p2.x += nx * overlap;
              p2.y += ny * overlap;
            } else if (p2.settled || p2.onFloor) {
              // p2 is grounded, p1 is slow - just push apart
              p1.x -= nx * overlap;
              p1.y -= ny * overlap;
              if (inBottom) {
                // Nudge toward center to prevent stacking against walls
                const slideDir = p1.x < CENTER_X ? 1 : -1;
                p1.vx += slideDir * 0.03;
                p1.vy *= 0.5;
                // Propagate support only if p2 is SETTLED (not just onFloor)
                // This ensures p1 falls if p2 moves during recompute
                if (p1.y < p2.y && p2.settled) {
                  p1.onFloor = true;
                }
              } else {
                if (p1IsAbove) p1.onFloor = true;
                p1.vy *= 0.3;
              }
            } else if (p1.settled || p1.onFloor) {
              // p1 is grounded, p2 is slow - just push apart
              p2.x += nx * overlap;
              p2.y += ny * overlap;
              if (inBottom) {
                // Nudge toward center to prevent stacking against walls
                const slideDir = p2.x < CENTER_X ? 1 : -1;
                p2.vx += slideDir * 0.03;
                p2.vy *= 0.5;
                // Propagate support only if p1 is SETTLED (not just onFloor)
                if (p2.y < p1.y && p1.settled) {
                  p2.onFloor = true;
                }
              } else {
                if (!p1IsAbove) p2.onFloor = true;
                p2.vy *= 0.3;
              }
            } else {
              // Both moving - exchange momentum
              p1.x -= nx * overlap * 0.5;
              p1.y -= ny * overlap * 0.5;
              p2.x += nx * overlap * 0.5;
              p2.y += ny * overlap * 0.5;

              // Momentum transfer
              const relVel = (p1.vx - p2.vx) * nx + (p1.vy - p2.vy) * ny;
              if (relVel > 0) {
                p1.vx -= relVel * nx * 0.5;
                p1.vy -= relVel * ny * 0.5;
                p2.vx += relVel * nx * 0.5;
                p2.vy += relVel * ny * 0.5;
              }
            }
          }
        }
      }
    }

    // Fourth pass: settle particles (rest-frame counter tolerates onFloor flicker)
    particles.forEach((p) => {
      if (p.settled || p.falling) return;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const threshold = p.inBottom ? 0.8 : 0.6;

      if (p.onFloor && speed < threshold) {
        p.restFrames++;
        if (p.restFrames >= 4) {
          p.settled = true;
          p.vx = 0;
          p.vy = 0;
        }
      } else {
        p.restFrames = 0;
      }
    });

    // Fifth pass: strict boundary enforcement - clamp particles inside triangles
    particles.forEach((p) => {
      if (p.falling) return;

      if (!p.inBottom) {
        // Top triangle bounds
        // Clamp Y within triangle
        if (p.y < TOP_BASE_Y + p.size) {
          p.y = TOP_BASE_Y + p.size;
          p.vy = Math.abs(p.vy) * 0.3;
        }
        if (p.y > TOP_APEX_Y - p.size) {
          p.y = TOP_APEX_Y - p.size;
          p.vy = -Math.abs(p.vy) * 0.3;
        }
        // Clamp X within triangle at current Y
        const bounds = getTriangleBounds(p.y, true, holeHalfWidth);
        if (bounds) {
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * 0.3;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * 0.3;
          }
        }
      } else {
        // Bottom triangle bounds
        // Clamp Y within triangle
        if (p.y < BOTTOM_APEX_Y + p.size) {
          p.y = BOTTOM_APEX_Y + p.size;
          p.vy = Math.abs(p.vy) * 0.3;
        }
        if (p.y > BOTTOM_BASE_Y - p.size - 2) {
          p.y = BOTTOM_BASE_Y - p.size - 2;
          p.vy = -Math.abs(p.vy) * 0.3;
        }
        // Clamp X within triangle at current Y
        const bounds = getTriangleBounds(p.y, false, holeHalfWidth);
        if (bounds) {
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * 0.3;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * 0.3;
          }
        }
      }
    });
  };

  /**
   * Redistribute particles when scrubbing.
   * @param {number} currentTime - Current audio time in seconds
   */
  const redistributeParticles = (currentTime) => {
    if (particles.length === 0) return;

    // Sync fallenCount to current time (1 particle per second)
    const targetFallen = Math.min(Math.floor(currentTime), totalParticles);
    fallenCount = targetFallen;

    const currentBottomCount = particles.filter((p) => p.inBottom || p.falling).length;

    if (currentBottomCount < targetFallen) {
      // Move particles to bottom
      const toMove = targetFallen - currentBottomCount;
      let moved = 0;
      for (const p of particles) {
        if (!p.inBottom && !p.falling && moved < toMove) {
          p.inBottom = true;
          p.falling = false;
          // Position in bottom triangle
          const y = BOTTOM_BASE_Y - p.size - 5 - Math.random() * 30;
          const bounds = getTriangleBounds(y, false, holeHalfWidth);
          if (bounds) {
            p.x = bounds.left + p.size + Math.random() * (bounds.right - bounds.left - p.size * 2);
            p.y = y;
          }
          p.vx = 0;
          p.vy = 0;
          p.settled = true;
          moved++;
        }
      }
    } else if (currentBottomCount > targetFallen) {
      // Move particles back to top
      const toMove = currentBottomCount - targetFallen;
      let moved = 0;
      for (const p of particles) {
        if ((p.inBottom || p.falling) && moved < toMove) {
          p.inBottom = false;
          p.falling = false;
          // Position in top triangle
          const y = TOP_BASE_Y + p.size + 5 + Math.random() * 30;
          const bounds = getTriangleBounds(y, true, holeHalfWidth);
          if (bounds) {
            p.x = bounds.left + p.size + Math.random() * (bounds.right - bounds.left - p.size * 2);
            p.y = y;
          }
          p.vx = 0;
          p.vy = 0;
          p.settled = true;
          moved++;
        }
      }
    }
  };

  /**
   * Render particles to canvas.
   */
  const render = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(2, 2); // Scale for retina

    particles.forEach((p) => {
      ctx.shadowColor = `rgba(${PARTICLE_COLOR.r}, ${PARTICLE_COLOR.g}, ${PARTICLE_COLOR.b}, ${p.alpha * 0.5})`;
      ctx.shadowBlur = 3;
      ctx.fillStyle = `rgba(${PARTICLE_COLOR.r}, ${PARTICLE_COLOR.g}, ${PARTICLE_COLOR.b}, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  };

  /**
   * Render static fill for reduced motion.
   */
  const renderStatic = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(2, 2);

    const topFill = 1 - progress;
    const bottomFill = progress;

    ctx.fillStyle = `rgba(${PARTICLE_COLOR.r}, ${PARTICLE_COLOR.g}, ${PARTICLE_COLOR.b}, 0.4)`;

    // Top triangle fill
    if (topFill > 0) {
      const fillY = TOP_BASE_Y + (TOP_APEX_Y - TOP_BASE_Y) * (1 - topFill);
      const bounds = getTriangleBounds(fillY, true);
      if (bounds) {
        ctx.beginPath();
        ctx.moveTo(bounds.left, fillY);
        ctx.lineTo(bounds.right, fillY);
        ctx.lineTo(CENTER_X, TOP_APEX_Y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Bottom triangle fill
    if (bottomFill > 0) {
      const fillY = BOTTOM_BASE_Y - (BOTTOM_BASE_Y - BOTTOM_APEX_Y) * (1 - bottomFill);
      const bounds = getTriangleBounds(fillY, false);
      const baseBounds = getTriangleBounds(BOTTOM_BASE_Y - 1, false);
      if (bounds && baseBounds) {
        ctx.beginPath();
        ctx.moveTo(bounds.left, fillY);
        ctx.lineTo(bounds.right, fillY);
        ctx.lineTo(baseBounds.right, BOTTOM_BASE_Y);
        ctx.lineTo(baseBounds.left, BOTTOM_BASE_Y);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  };

  /**
   * Apply playback speed to audio.
   * Forward: HTML5 audio. Reverse: Web Audio reversed buffer.
   */
  const applyPlaybackSpeed = () => {
    updatePlaybackSpeed();

    if (userPaused) {
      if (isPlayingReversed) stopReversePlayback();
      return;
    }

    const absSpeed = Math.abs(playbackSpeed);

    if (absSpeed < 0.01) {
      // Paused (speed near 0 — at 90° or 270°)
      if (!audio.paused) audio.pause();
      if (isPlayingReversed) stopReversePlayback();
      return;
    }

    if (playbackSpeed > 0) {
      // Forward — HTML5 audio
      if (isPlayingReversed) {
        const t = getReverseForwardTime();
        stopReversePlayback();
        audio.currentTime = t;
      }
      audio.playbackRate = Math.min(4, Math.max(0.25, playbackSpeed));
      if (audio.paused) audio.play().catch(() => {});
    } else {
      // Reverse — Web Audio reversed buffer
      if (!audio.paused) audio.pause();
      if (!isPlayingReversed && reversedBuffer) {
        startReversePlayback(audio.currentTime);
      } else if (isPlayingReversed && reverseSource) {
        // Update speed on the fly
        reverseSource.playbackRate.value = Math.min(4, Math.max(0.25, absSpeed));
      }
    }
  };

  /**
   * Animation loop.
   */
  let lastTime = performance.now();
  const tick = () => {
    if (disposed) return;

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Snap-on-release animation
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

    // Apply playback speed (skip during scrub drag)
    if (!isDragging) applyPlaybackSpeed();

    // Late-init particles if duration became available after initial check
    if (particles.length === 0 && audio.duration && Number.isFinite(audio.duration)) {
      initParticles(audio.duration);
    }

    // Hide retry button once particles are loaded
    if (particles.length > 0 && !retryBtn.hidden) {
      retryBtn.hidden = true;
    }

    // Update progress and particle time
    const duration = audio.duration;
    if (!isDragging && duration && Number.isFinite(duration)) {
      if (isPlayingReversed) {
        // Reverse: get position from Web Audio reversed buffer
        const t = getReverseForwardTime();
        particleProgress = t;
        progress = t / duration;
      } else {
        // Forward: sync with HTML5 audio
        const currentTime = audio.currentTime || 0;
        particleProgress = currentTime;
        progress = currentTime / duration;
      }
    }

    if (prefersReducedMotion) {
      renderStatic();
    } else {
      updateParticles(dt, particleProgress);
      render();
    }

    // Render 3D overlay
    if (three3d) three3d.render(dt);

    animationFrame = requestAnimationFrame(tick);
  };

  // DOM setup
  const wrapper = document.createElement("div");
  wrapper.className = "hourglass-container";
  wrapper.innerHTML = HOURGLASS_FRAME_SVG;
  wrapper.style.transformOrigin = "center center";
  wrapper.style.transition = "none"; // We handle animation in tick

  const frameEl = wrapper.querySelector("svg");
  frameEl.classList.add("hourglass-frame");

  wrapper.insertBefore(canvas, frameEl);

  // Drag zone (large hit area for rotation)
  const dragZone = document.createElement("div");
  dragZone.className = "hourglass-drag-zone";
  wrapper.appendChild(dragZone);

  // Scrub zone (small center area)
  const scrubZone = document.createElement("div");
  scrubZone.className = "hourglass-scrub";
  scrubZone.setAttribute("role", "slider");
  scrubZone.setAttribute("aria-label", "Seek");
  scrubZone.setAttribute("aria-valuemin", "0");
  scrubZone.setAttribute("aria-valuemax", "100");
  scrubZone.setAttribute("aria-valuenow", "0");
  scrubZone.tabIndex = 0;
  wrapper.appendChild(scrubZone);

  // Retry button (shown when particles fail to load or audio fails to play)
  const retryBtn = document.createElement("button");
  retryBtn.className = "hourglass-retry";
  retryBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  retryBtn.hidden = true;
  retryBtn.setAttribute("aria-label", "Retry");
  wrapper.appendChild(retryBtn);

  const showRetryIfNeeded = () => {
    if (disposed) return;
    if (
      particles.length === 0 ||
      (audio.paused && !userPaused && !isPlayingReversed && audio.currentTime === 0)
    ) {
      retryBtn.hidden = false;
    }
  };

  let retryTimeout = null;
  if (!prefersReducedMotion) {
    retryTimeout = setTimeout(showRetryIfNeeded, 3000);
  }

  // Also show retry if audio fails to play
  audio.addEventListener("error", () => {
    if (!disposed) retryBtn.hidden = false;
  });

  retryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    retryBtn.hidden = true;
    if (audio.duration && Number.isFinite(audio.duration)) {
      initParticles(audio.duration);
    }
    audio.play().catch(() => {});
  });

  // Assemble
  container.appendChild(wrapper);

  // Event handlers
  const updateTime = () => {
    scrubZone.setAttribute(
      "aria-valuenow",
      String(Math.round((audio.currentTime / audio.duration) * 100) || 0),
    );
  };

  const updateDuration = () => {
    // Initialize particles when duration is known
    if (audio.duration && Number.isFinite(audio.duration) && particles.length === 0) {
      initParticles(audio.duration);
    }
    // Prepare reversed audio buffer in background for reverse playback
    prepareReverseBuffer();
  };

  // Click on hourglass to toggle play (only if not rotating)
  wrapper.addEventListener("click", (e) => {
    if (e.target === scrubZone) return;
    if (wrapper.dataset.wasRotating === "true") {
      wrapper.dataset.wasRotating = "false";
      return;
    }
    const playing = !audio.paused || isPlayingReversed;
    if (playing) {
      userPaused = true;
      audio.pause();
      stopReversePlayback();
    } else {
      userPaused = false;
    }
  });

  // Scrub interaction (vertical drag)
  let scrubStartY = 0;
  let scrubStartProgress = 0;

  const handleScrubStart = (e) => {
    if (!audio.duration || !Number.isFinite(audio.duration)) return;
    if (isPlayingReversed) stopReversePlayback();
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
    redistributeParticles(newTime);
  };

  const handleScrubEnd = () => {
    isDragging = false;
  };

  scrubZone.addEventListener("mousedown", handleScrubStart);
  scrubZone.addEventListener("touchstart", handleScrubStart, { passive: false });
  window.addEventListener("mousemove", handleScrubMove);
  window.addEventListener("touchmove", handleScrubMove, { passive: true });

  // Rotation interaction (circular drag)
  const handleRotationStart = (e) => {
    // Interrupt any in-progress snap
    isSnapping = false;

    // Only start rotation from outer area (not scrub zone)
    if (e.target === scrubZone) return;

    const rect = wrapper.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;

    // Drag zone hit — always allow rotation
    const fromDragZone = e.target === dragZone;

    if (!fromDragZone) {
      // Check if pointer is near the edge (for rotation) vs center (for click)
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distFromCenter = Math.sqrt(
        Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2),
      );
      const minRotationRadius = Math.min(rect.width, rect.height) * 0.15;

      if (distFromCenter < minRotationRadius) return; // Too close to center
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

    // Normalize delta to [-180, 180] to handle atan2 discontinuity at ±180°
    if (deltaAngle > 180) deltaAngle -= 360;
    if (deltaAngle < -180) deltaAngle += 360;

    let newAngle = rotationStartAngle + deltaAngle;

    // Detect shake gesture before updating angle
    detectShake(newAngle);

    // Magnetic snap detents at 0°, 90°, 180°, 270°
    const SNAP_THRESHOLD = 6; // degrees — zone of influence
    const SNAP_STRENGTH = 0.35; // 0 = no pull, 1 = hard snap
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

    // Rotation is an explicit playback control — override manual pause
    userPaused = false;
  };

  const handleRotationEnd = () => {
    if (!isRotating) return;

    isRotating = false;
    wrapper.dataset.wasRotating = "true"; // Prevent click handler

    // Reset direction tracking
    lastRotationDirection = 0;

    // Snap to nearest detent if close enough
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

  // Keyboard navigation
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

  // Audio events
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

  // Initial state
  updateDuration();
  updateTime();

  // Start animation
  animationFrame = requestAnimationFrame(tick);

  // Launch 3D overlay (non-blocking, SVG fallback on failure)
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

  // API
  return {
    /** Current effective playback speed (-2 … 2). */
    get speed() {
      return userPaused ? 0 : playbackSpeed;
    },

    /** Toggle play/pause, matching the hourglass click behavior. */
    togglePlay() {
      const playing = !audio.paused || isPlayingReversed;
      if (playing) {
        userPaused = true;
        audio.pause();
        stopReversePlayback();
      } else {
        userPaused = false;
        audio.play().catch(() => {});
      }
    },

    /** Whether audio is currently playing (forward or reverse). */
    get playing() {
      return !audio.paused || isPlayingReversed;
    },

    /** Reset track to beginning with full hourglass. */
    restart() {
      stopReversePlayback();
      audio.currentTime = 0;
      particleProgress = 0;
      playbackSpeed = 1;
      userPaused = false;
      redistributeParticles(0);
      audio.play().catch(() => {});
    },

    /**
     * Dispose of the player and clean up resources.
     */
    dispose() {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (shakeDecayTimer) clearTimeout(shakeDecayTimer);
      if (retryTimeout) clearTimeout(retryTimeout);
      stopReversePlayback();
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
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
