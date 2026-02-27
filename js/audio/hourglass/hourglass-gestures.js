/**
 * @module audio/hourglass/hourglass-gestures
 * Rotation, shake detection, snap-on-release, speed mapping.
 */

// Snap-on-release threshold: degrees from detent to trigger snap
const SNAP_RELEASE_THRESHOLD = 20;

// Shake detection
const SHAKE_WINDOW = 500; // ms to detect shake pattern
const SHAKE_MIN_CHANGES = 2; // Min direction reversals needed
const SHAKE_BOOST_DURATION = 2000; // How long x2 lasts (ms)

/**
 * Get pointer angle from center of wrapper (0° at top, clockwise positive).
 */
export const getPointerAngle = (clientX, clientY, rect) => {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  return Math.atan2(dx, -dy) * (180 / Math.PI); // 0° at top
};

/**
 * Get playback speed from rotation angle using linear interpolation.
 * 0° → 1 (forward), 90° → 0 (paused), 180° → -1 (reverse), 270° → 0 (paused)
 */
export const getSpeedFromRotation = (angle) => {
  const normalized = ((angle % 360) + 360) % 360;

  if (normalized <= 90) {
    return 1 - normalized / 90;
  } else if (normalized <= 180) {
    return -((normalized - 90) / 90);
  } else if (normalized <= 270) {
    return -1 + (normalized - 180) / 90;
  } else {
    return (normalized - 270) / 90;
  }
};

/**
 * Find snap target preserving winding direction.
 * Returns target angle (accounting for multi-revolution) or null if too far.
 */
export const findSnapTarget = (angle) => {
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

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Compute playback speed from rotation and shake state.
 */
export const computePlaybackSpeed = (rotationAngle, isShaking) => {
  const baseSpeed = getSpeedFromRotation(rotationAngle);
  return isShaking ? baseSpeed * 2 : baseSpeed;
};

/**
 * Factory for shake gesture detection.
 * @param {HTMLElement} wrapper - Element receiving visual feedback
 */
export const createShakeDetector = (wrapper) => {
  let shakeHistory = [];
  let lastRotationDirection = 0;
  let lastRotationAngle = 0;
  let isShaking = false;
  let shakeDecayTimer = null;

  const triggerBoost = () => {
    isShaking = true;
    shakeHistory = [];
    if (shakeDecayTimer) clearTimeout(shakeDecayTimer);
    shakeDecayTimer = setTimeout(() => {
      isShaking = false;
      wrapper.classList.remove("is-boosted");
    }, SHAKE_BOOST_DURATION);
    wrapper.classList.add("is-boosted");
  };

  const detect = (currentAngle) => {
    const delta = currentAngle - lastRotationAngle;
    if (Math.abs(delta) < 2) return;

    const direction = delta > 0 ? 1 : -1;

    if (direction !== lastRotationDirection && lastRotationDirection !== 0) {
      shakeHistory.push(performance.now());
      const now = performance.now();
      shakeHistory = shakeHistory.filter((t) => now - t < SHAKE_WINDOW);
      if (shakeHistory.length >= SHAKE_MIN_CHANGES) {
        triggerBoost();
      }
    }

    lastRotationDirection = direction;
    lastRotationAngle = currentAngle;
  };

  const resetDirection = () => {
    lastRotationDirection = 0;
  };

  const dispose = () => {
    if (shakeDecayTimer) clearTimeout(shakeDecayTimer);
  };

  return {
    detect,
    resetDirection,
    dispose,
    get isShaking() {
      return isShaking;
    },
  };
};
