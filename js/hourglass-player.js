/**
 * Simplified hourglass audio player with two triangles and physics-based particles.
 * 1 particle per second of track duration.
 */

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
  const dy = isTop ? (TOP_APEX_Y - TOP_BASE_Y) : (BOTTOM_BASE_Y - BOTTOM_APEX_Y);
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
    this.nearWall = false; // Near triangle wall (for bottom triangle)
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
    this.nearWall = false;
  }
}

/**
 * SVG frame for the hourglass - trapezoids with hole
 */
const HOURGLASS_FRAME_SVG = `
<svg viewBox="0 0 100 160" width="100" height="160" xmlns="http://www.w3.org/2000/svg">
  <!-- Top trapezoid (inverted, with hole at bottom) -->
  <path d="M 10,10 L 90,10 L 54,78 L 46,78 Z"
        fill="none" stroke="rgba(189,255,0,0.4)" stroke-width="2"/>
  <!-- Bottom trapezoid (with hole at top) -->
  <path d="M 46,82 L 54,82 L 90,150 L 10,150 Z"
        fill="none" stroke="rgba(189,255,0,0.4)" stroke-width="2"/>
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
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;

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

  // Rotation state
  let rotationAngle = 0;        // Current visual rotation (degrees)
  let targetRotation = 0;       // Target for snapping
  let isRotating = false;       // Rotation drag state
  let rotationStartAngle = 0;   // Angle when drag started
  let pointerStartAngle = 0;    // Pointer angle when drag started
  let isRewinding = false;      // Whether we're in rewind mode
  let lastRewindTime = 0;       // For manual rewind timing
  let userPaused = false;       // Track if user manually paused

  // Particle size and hole width (calculated when duration is known)
  let particleRadius = 3;
  let holeHalfWidth = 4; // Minimum hole half-width to fit one particle

  // Rotation constants
  const SNAP_ANGLES = [0, 90, 180, 270];
  const SNAP_THRESHOLD = 15;

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
   * Snap angle to nearest key angle if within threshold.
   */
  const snapToNearestAngle = (angle) => {
    const normalized = ((angle % 360) + 360) % 360;
    for (const snap of SNAP_ANGLES) {
      const diff = Math.abs(normalized - snap);
      if (diff < SNAP_THRESHOLD || diff > 360 - SNAP_THRESHOLD) {
        return snap;
      }
    }
    return normalized;
  };

  /**
   * Get normalized rotation (0-360).
   */
  const getNormalizedRotation = () => {
    return ((rotationAngle % 360) + 360) % 360;
  };

  /**
   * Update audio playback based on rotation angle.
   */
  const updateAudioFromRotation = () => {
    const normalized = getNormalizedRotation();

    if (normalized === 0 || normalized === 360) {
      // Normal forward playback
      if (audio.paused && !userPaused) audio.play().catch(() => {});
      isRewinding = false;
    } else if (normalized === 90 || normalized === 270) {
      // Paused state
      audio.pause();
      isRewinding = false;
    } else if (normalized === 180) {
      // Rewind at 2x speed
      audio.pause();
      isRewinding = true;
      lastRewindTime = performance.now();
    }
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
    const rotationRad = rotationAngle * (Math.PI / 180);
    const gravityX = gravityMagnitude * Math.sin(rotationRad);
    const gravityY = gravityMagnitude * Math.cos(rotationRad);

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
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
    });

    // Find best particle to release (if needed)
    if (!releasedThisFrame && fallenCount < targetFallen) {
      let bestParticle = null;
      let bestScore = Infinity;

      // Find the settled particle in top triangle closest to the hole
      particles.forEach((p) => {
        if (p.settled && !p.inBottom && !p.falling) {
          // Score: distance from center + distance from bottom (lower = better)
          const distFromCenter = Math.abs(p.x - CENTER_X);
          const distFromBottom = TOP_APEX_Y - p.y;
          const score = distFromCenter + distFromBottom * 0.5;
          if (score < bestScore) {
            bestScore = score;
            bestParticle = p;
          }
        }
      });

      // Release the best candidate
      if (bestParticle) {
        bestParticle.settled = false;
        bestParticle.falling = true;
        bestParticle.x = CENTER_X;
        bestParticle.y = TOP_APEX_Y;
        bestParticle.vy = 0.5;
        fallenCount++;
        releasedThisFrame = true;

        // Wake up all other settled particles in top triangle so they fall to fill the gap
        particles.forEach((p) => {
          if (p !== bestParticle && p.settled && !p.inBottom) {
            p.settled = false;
            p.onFloor = false;
          }
        });
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

        if (p.y > BOTTOM_APEX_Y + p.size) {
          p.falling = false;
          p.inBottom = true;
          p.settled = false;

          // Wake up settled particles in bottom triangle so they recompute positions
          // when the new particle arrives and collides with them
          particles.forEach((other) => {
            if (other !== p && other.inBottom && other.settled) {
              other.settled = false;
              other.onFloor = false;
            }
          });
        }
        return;
      }

      if (p.settled) return;

      // Active particle - handle boundaries
      if (!p.inBottom) {
        // Top triangle
        const bounds = getTriangleBounds(p.y, true, holeHalfWidth);
        if (bounds) {
          // Wall collisions
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * bounceDamping;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * bounceDamping;
          }
        }

        // Floor collision (bottom of top triangle)
        if (p.y >= TOP_APEX_Y - p.size) {
          p.y = TOP_APEX_Y - p.size;
          p.vy = -Math.abs(p.vy) * bounceDamping;
          p.onFloor = true;
        } else {
          p.onFloor = false;
        }
      } else {
        // Bottom triangle
        const bounds = getTriangleBounds(p.y, false, holeHalfWidth);
        let hitWall = false;
        if (bounds) {
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * bounceDamping * 0.5; // Extra damping at walls
            p.vy *= 0.8;
            hitWall = true;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * bounceDamping * 0.5;
            p.vy *= 0.8;
            hitWall = true;
          }
          // Track if near wall (for collision logic)
          p.nearWall = (p.x < bounds.left + p.size * 3) || (p.x > bounds.right - p.size * 3);
        }

        // Floor collision
        if (p.y >= BOTTOM_BASE_Y - p.size - 2) {
          p.y = BOTTOM_BASE_Y - p.size - 2;
          p.vy = -Math.abs(p.vy) * bounceDamping;
          p.vx *= 0.9; // Friction on floor
          p.onFloor = true;
        } else {
          p.onFloor = false;
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
                // Only add slide velocity if not near wall
                if (!p1.nearWall) {
                  const slideDir = p1.x < CENTER_X ? -1 : 1;
                  p1.vx += slideDir * 0.2;
                }
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
                if (!p2.nearWall) {
                  const slideDir = p2.x < CENTER_X ? -1 : 1;
                  p2.vx += slideDir * 0.2;
                }
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

    // Fourth pass: settle particles
    particles.forEach((p) => {
      if (p.settled || p.falling) return;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

      if (p.inBottom) {
        // Bottom triangle: settle on floor, or if near wall and very slow
        if (p.onFloor && speed < 0.6) {
          p.settled = true;
          p.vx = 0;
          p.vy = 0;
        } else if (p.nearWall && speed < 0.3) {
          // Near wall and very slow - settle to prevent corner jitter
          p.settled = true;
          p.vx = 0;
          p.vy = 0;
        }
      } else {
        // Top triangle: settle when on floor or resting on particles, and slow
        if (p.onFloor && speed < 0.5) {
          p.settled = true;
          p.vx = 0;
          p.vy = 0;
        }
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
   * Animation loop.
   */
  let lastTime = performance.now();
  const tick = () => {
    if (disposed) return;

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Handle rewind mode
    if (isRewinding && audio.currentTime > 0) {
      const elapsed = (now - lastRewindTime) / 1000;
      lastRewindTime = now;

      // Rewind at 2x speed (2 seconds of audio per real second)
      const rewindAmount = elapsed * 2;
      const newTime = Math.max(0, audio.currentTime - rewindAmount);
      audio.currentTime = newTime;
      redistributeParticles(newTime);
    }

    // Animate rotation snapping
    if (!isRotating && Math.abs(rotationAngle - targetRotation) > 0.5) {
      const diff = targetRotation - rotationAngle;
      rotationAngle += diff * 0.15; // Smooth interpolation
      if (Math.abs(diff) < 0.5) {
        rotationAngle = targetRotation;
      }
      wrapper.style.transform = `rotate(${rotationAngle}deg)`;
    }

    // Update progress from audio
    const currentTime = audio.currentTime || 0;
    if (!isDragging && audio.duration && Number.isFinite(audio.duration)) {
      progress = currentTime / audio.duration;
    }

    if (prefersReducedMotion) {
      renderStatic();
    } else {
      updateParticles(dt, currentTime);
      render();
    }

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

  // Scrub zone
  const scrubZone = document.createElement("div");
  scrubZone.className = "hourglass-scrub";
  scrubZone.setAttribute("role", "slider");
  scrubZone.setAttribute("aria-label", "Seek");
  scrubZone.setAttribute("aria-valuemin", "0");
  scrubZone.setAttribute("aria-valuemax", "100");
  scrubZone.setAttribute("aria-valuenow", "0");
  scrubZone.tabIndex = 0;
  wrapper.appendChild(scrubZone);

  // Controls
  const controls = document.createElement("div");
  controls.className = "hourglass-controls";

  const playBtn = document.createElement("button");
  playBtn.className = "hourglass-rune";
  playBtn.type = "button";
  playBtn.setAttribute("data-action", "play");
  playBtn.innerHTML = '<span class="rune-icon">&#9654;</span>';
  playBtn.setAttribute("aria-label", "Play");

  const timeDisplay = document.createElement("div");
  timeDisplay.className = "hourglass-time";
  timeDisplay.innerHTML = `<span data-role="current">--:--</span> / <span data-role="total">--:--</span>`;

  const muteBtn = document.createElement("button");
  muteBtn.className = "hourglass-rune";
  muteBtn.type = "button";
  muteBtn.setAttribute("data-action", "mute");
  muteBtn.innerHTML = '<span class="rune-icon">&#9836;</span>';
  muteBtn.setAttribute("aria-label", "Mute");

  controls.appendChild(playBtn);
  controls.appendChild(timeDisplay);
  controls.appendChild(muteBtn);

  // Assemble
  container.appendChild(wrapper);
  container.appendChild(controls);

  // Element references
  const currentLabel = timeDisplay.querySelector("[data-role='current']");
  const totalLabel = timeDisplay.querySelector("[data-role='total']");

  // Event handlers
  const updatePlayState = () => {
    playBtn.innerHTML = audio.paused
      ? '<span class="rune-icon">&#9654;</span>'
      : '<span class="rune-icon">&#10074;&#10074;</span>';
    playBtn.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
  };

  const updateMuteState = () => {
    muteBtn.innerHTML = audio.muted
      ? '<span class="rune-icon">&#128263;</span>'
      : '<span class="rune-icon">&#9836;</span>';
    muteBtn.setAttribute("aria-label", audio.muted ? "Unmute" : "Mute");
  };

  const updateTime = () => {
    if (currentLabel) currentLabel.textContent = formatTime(audio.currentTime);
    scrubZone.setAttribute("aria-valuenow", String(Math.round((audio.currentTime / audio.duration) * 100) || 0));
  };

  const updateDuration = () => {
    if (totalLabel) totalLabel.textContent = formatTime(audio.duration);
    // Initialize particles when duration is known
    if (audio.duration && Number.isFinite(audio.duration) && particles.length === 0) {
      initParticles(audio.duration);
    }
  };

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      userPaused = false;
      audio.play().catch(() => {});
    } else {
      userPaused = true;
      audio.pause();
    }
  });

  muteBtn.addEventListener("click", () => {
    audio.muted = !audio.muted;
  });

  // Click on hourglass to toggle play (only if not rotating)
  wrapper.addEventListener("click", (e) => {
    if (e.target === scrubZone) return;
    // Don't toggle if this was a rotation gesture
    if (wrapper.dataset.wasRotating === "true") {
      wrapper.dataset.wasRotating = "false";
      return;
    }
    if (audio.paused) {
      userPaused = false;
      audio.play().catch(() => {});
    } else {
      userPaused = true;
      audio.pause();
    }
  });

  // Scrub interaction (vertical drag)
  let scrubStartY = 0;
  let scrubStartProgress = 0;

  const handleScrubStart = (e) => {
    if (!audio.duration || !Number.isFinite(audio.duration)) return;
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
    // Only start rotation from outer area (not scrub zone)
    if (e.target === scrubZone) return;

    const rect = wrapper.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;

    // Check if pointer is near the edge (for rotation) vs center (for click)
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distFromCenter = Math.sqrt(
      Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2)
    );
    const minRotationRadius = Math.min(rect.width, rect.height) * 0.25;

    if (distFromCenter < minRotationRadius) return; // Too close to center

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
    const deltaAngle = currentPointerAngle - pointerStartAngle;

    rotationAngle = rotationStartAngle + deltaAngle;
    targetRotation = rotationAngle; // During drag, target follows current
    wrapper.style.transform = `rotate(${rotationAngle}deg)`;
  };

  const handleRotationEnd = () => {
    if (!isRotating) return;

    isRotating = false;
    wrapper.dataset.wasRotating = "true"; // Prevent click handler

    // Snap to nearest angle
    const snappedAngle = snapToNearestAngle(rotationAngle);
    targetRotation = snappedAngle;

    // Update audio based on snapped rotation
    // We need to wait for the animation to complete, so set a small delay
    setTimeout(() => {
      rotationAngle = targetRotation;
      wrapper.style.transform = `rotate(${rotationAngle}deg)`;
      updateAudioFromRotation();
    }, 200);
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
  audio.addEventListener("play", updatePlayState);
  audio.addEventListener("pause", updatePlayState);
  audio.addEventListener("volumechange", updateMuteState);

  // Initial state
  updatePlayState();
  updateMuteState();
  updateDuration();
  updateTime();

  // Start animation
  animationFrame = requestAnimationFrame(tick);

  // API
  return {
    /**
     * Dispose of the player and clean up resources.
     */
    dispose() {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);

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
      audio.removeEventListener("play", updatePlayState);
      audio.removeEventListener("pause", updatePlayState);
      audio.removeEventListener("volumechange", updateMuteState);

      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
      if (controls.parentNode) {
        controls.parentNode.removeChild(controls);
      }
    },
  };
};
