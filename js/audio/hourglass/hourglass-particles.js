/**
 * @module audio/hourglass/hourglass-particles
 * Particle class, physics simulation, and rendering for the hourglass player.
 */

import {
  CENTER_X,
  PARTICLE_COLOR,
  TOP_APEX_Y,
  TOP_BASE_Y,
  BOTTOM_APEX_Y,
  BOTTOM_BASE_Y,
  BASE_HALF_WIDTH,
  TRIANGLE_AREA,
  TARGET_FILL,
  PACKING_EFFICIENCY,
  prefersReducedMotion,
} from "./hourglass-constants.js";

/**
 * Calculate particle radius based on count to fill 80% of triangle area.
 * @param {number} count - Number of particles
 * @returns {number} Particle radius
 */
const calculateParticleRadius = (count) => {
  if (count <= 0) return 3;
  const totalCircleArea = TRIANGLE_AREA * TARGET_FILL * PACKING_EFFICIENCY;
  const particleArea = totalCircleArea / count;
  const radius = Math.sqrt(particleArea / Math.PI);
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
    if (y < TOP_BASE_Y || y > TOP_APEX_Y) return null;
    const t = (y - TOP_BASE_Y) / (TOP_APEX_Y - TOP_BASE_Y);
    const halfWidth = BASE_HALF_WIDTH * (1 - t) + holeHalfWidth * t;
    return { left: CENTER_X - halfWidth, right: CENTER_X + halfWidth };
  } else {
    if (y < BOTTOM_APEX_Y || y > BOTTOM_BASE_Y) return null;
    const t = (y - BOTTOM_APEX_Y) / (BOTTOM_BASE_Y - BOTTOM_APEX_Y);
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
  const dx = isLeft ? -BASE_HALF_WIDTH : BASE_HALF_WIDTH;
  const dy = isTop ? TOP_APEX_Y - TOP_BASE_Y : BOTTOM_BASE_Y - BOTTOM_APEX_Y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (isTop) {
    return isLeft ? { nx: dy / len, ny: -dx / len } : { nx: -dy / len, ny: dx / len };
  } else {
    return isLeft ? { nx: dy / len, ny: dx / len } : { nx: -dy / len, ny: -dx / len };
  }
};

class Particle {
  constructor(x, y, size) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = 0;
    this.size = size * (0.85 + Math.random() * 0.3);
    this.alpha = 0.75 + Math.random() * 0.25;
    this.settled = false;
    this.inBottom = false;
    this.falling = false;
    this.onFloor = false;
    this.restFrames = 0;
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
 * Factory for particle system.
 * @param {HTMLCanvasElement} canvas - The hourglass canvas element
 * @returns {Object} Particle system API
 */
export const createParticleSystem = (canvas) => {
  const ctx = canvas.getContext("2d");
  let particles = [];
  let totalParticles = 0;
  let fallenCount = 0;
  let particleRadius = 3;
  let holeHalfWidth = 4;
  let lastPhysicsAngle = 0;

  const init = (duration) => {
    totalParticles = Math.floor(duration);
    particles = [];
    fallenCount = 0;

    if (prefersReducedMotion || totalParticles === 0) return;

    particleRadius = calculateParticleRadius(totalParticles);
    holeHalfWidth = particleRadius + 1;

    for (let i = 0; i < totalParticles; i++) {
      const margin = particleRadius + 2;
      const y = TOP_BASE_Y + margin + Math.random() * (TOP_APEX_Y - TOP_BASE_Y - margin * 2 - 10);
      const bounds = getTriangleBounds(y, true, holeHalfWidth);
      if (bounds) {
        const x = bounds.left + margin + Math.random() * (bounds.right - bounds.left - margin * 2);
        particles.push(new Particle(x, y, particleRadius));
      }
    }
  };

  const update = (dt, currentTime, rotationAngle, playbackSpeed) => {
    if (prefersReducedMotion || particles.length === 0) return;

    const gravityMagnitude = 0.3;
    const friction = 0.92;
    const bounceDamping = 0.3;

    const rotationRad = rotationAngle * (Math.PI / 180);
    const gravityX = gravityMagnitude * Math.sin(rotationRad);
    const gravityY = gravityMagnitude * Math.cos(rotationRad);

    // Wake settled particles when rotation changes
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

    const isInverted = playbackSpeed < 0;
    const targetFallen = Math.min(Math.floor(currentTime), totalParticles);
    let releasedThisFrame = false;

    // Reset onFloor for non-settled particles
    particles.forEach((p) => {
      if (!p.settled) p.onFloor = false;
    });

    // First pass: apply gravity and movement
    particles.forEach((p) => {
      if (p.settled || p.falling) return;
      p.vx += gravityX;
      p.vy += gravityY;
      p.vx *= friction;
      p.vy *= friction;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
    });

    // Particle release logic
    if (!isInverted) {
      if (!releasedThisFrame && fallenCount < targetFallen) {
        let bestParticle = null;
        let bestScore = Infinity;
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
          particles.forEach((p) => {
            if (p !== bestParticle && p.settled && !p.inBottom) {
              p.settled = false;
              p.onFloor = false;
            }
          });
        }
      }
    } else {
      if (!releasedThisFrame && fallenCount > targetFallen) {
        let bestParticle = null;
        let bestScore = Infinity;
        particles.forEach((p) => {
          if (p.settled && p.inBottom && !p.falling) {
            const distFromCenter = Math.abs(p.x - CENTER_X);
            const distFromTop = p.y - BOTTOM_APEX_Y;
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
          bestParticle.vy = -0.5;
          fallenCount--;
          releasedThisFrame = true;
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
        p.vx += gravityX;
        p.vy += gravityY;
        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;

        if (!isInverted) {
          if (p.y > BOTTOM_APEX_Y + p.size) {
            p.falling = false;
            p.inBottom = true;
            p.settled = false;
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
          if (p.y < TOP_APEX_Y - p.size) {
            p.falling = false;
            p.inBottom = false;
            p.settled = false;
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

      if (!p.inBottom) {
        // Top triangle
        const bounds = getTriangleBounds(p.y, true, holeHalfWidth);
        if (bounds) {
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * bounceDamping * 0.3;
            const normal = getWallNormal(true, true);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * bounceDamping * 0.3;
            const normal = getWallNormal(true, false);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
        }

        if (!isInverted) {
          if (p.y >= TOP_APEX_Y - p.size) {
            p.y = TOP_APEX_Y - p.size;
            p.vy = -Math.abs(p.vy) * bounceDamping;
            p.onFloor = true;
          } else {
            p.onFloor = false;
          }
        } else {
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
        if (bounds) {
          if (p.x < bounds.left + p.size) {
            p.x = bounds.left + p.size;
            p.vx = Math.abs(p.vx) * bounceDamping * 0.3;
            const normal = getWallNormal(false, true);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
          if (p.x > bounds.right - p.size) {
            p.x = bounds.right - p.size;
            p.vx = -Math.abs(p.vx) * bounceDamping * 0.3;
            const normal = getWallNormal(false, false);
            const gravDotN = gravityX * normal.nx + gravityY * normal.ny;
            p.vx += (gravityX - gravDotN * normal.nx) * 0.5;
            p.vy += (gravityY - gravDotN * normal.ny) * 0.5;
          }
        }

        if (!isInverted) {
          if (p.y >= BOTTOM_BASE_Y - p.size - 2) {
            p.y = BOTTOM_BASE_Y - p.size - 2;
            p.vy = -Math.abs(p.vy) * bounceDamping;
            p.vx *= 0.9;
            p.onFloor = true;
          } else {
            p.onFloor = false;
          }
        } else {
          if (p.y <= BOTTOM_APEX_Y + p.size + 2) {
            p.y = BOTTOM_APEX_Y + p.size + 2;
            p.vy = Math.abs(p.vy) * bounceDamping;
            p.vx *= 0.9;
            p.onFloor = true;
          } else {
            p.onFloor = false;
          }
        }

        p.vx *= 0.98;
        p.vy *= 0.98;
      }
    });

    // Third pass: particle-to-particle collision
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

            const p1Speed = Math.sqrt(p1.vx * p1.vx + p1.vy * p1.vy);
            const p2Speed = Math.sqrt(p2.vx * p2.vx + p2.vy * p2.vy);

            if (p2.settled && p1Speed > 0.3) {
              p2.settled = false;
              p2.onFloor = false;
              const transferFactor = 0.6;
              const impactVel = (p1.vx * nx + p1.vy * ny) * transferFactor;
              p2.vx += impactVel * nx;
              p2.vy += impactVel * ny;
              p1.vx *= 0.5;
              p1.vy *= 0.5;
              p1.x -= nx * overlap;
              p1.y -= ny * overlap;
            } else if (p1.settled && p2Speed > 0.3) {
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
              p1.x -= nx * overlap;
              p1.y -= ny * overlap;
              if (inBottom) {
                const slideDir = p1.x < CENTER_X ? 1 : -1;
                p1.vx += slideDir * 0.03;
                p1.vy *= 0.5;
                if (p1.y < p2.y && p2.settled) {
                  p1.onFloor = true;
                }
              } else {
                if (p1IsAbove) p1.onFloor = true;
                p1.vy *= 0.3;
              }
            } else if (p1.settled || p1.onFloor) {
              p2.x += nx * overlap;
              p2.y += ny * overlap;
              if (inBottom) {
                const slideDir = p2.x < CENTER_X ? 1 : -1;
                p2.vx += slideDir * 0.03;
                p2.vy *= 0.5;
                if (p2.y < p1.y && p1.settled) {
                  p2.onFloor = true;
                }
              } else {
                if (!p1IsAbove) p2.onFloor = true;
                p2.vy *= 0.3;
              }
            } else {
              p1.x -= nx * overlap * 0.5;
              p1.y -= ny * overlap * 0.5;
              p2.x += nx * overlap * 0.5;
              p2.y += ny * overlap * 0.5;
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

    // Fifth pass: strict boundary enforcement
    particles.forEach((p) => {
      if (p.falling) return;

      if (!p.inBottom) {
        if (p.y < TOP_BASE_Y + p.size) {
          p.y = TOP_BASE_Y + p.size;
          p.vy = Math.abs(p.vy) * 0.3;
        }
        if (p.y > TOP_APEX_Y - p.size) {
          p.y = TOP_APEX_Y - p.size;
          p.vy = -Math.abs(p.vy) * 0.3;
        }
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
        if (p.y < BOTTOM_APEX_Y + p.size) {
          p.y = BOTTOM_APEX_Y + p.size;
          p.vy = Math.abs(p.vy) * 0.3;
        }
        if (p.y > BOTTOM_BASE_Y - p.size - 2) {
          p.y = BOTTOM_BASE_Y - p.size - 2;
          p.vy = -Math.abs(p.vy) * 0.3;
        }
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

  const redistribute = (currentTime) => {
    if (particles.length === 0) return;

    const targetFallen = Math.min(Math.floor(currentTime), totalParticles);
    fallenCount = targetFallen;

    const currentBottomCount = particles.filter((p) => p.inBottom || p.falling).length;

    if (currentBottomCount < targetFallen) {
      const toMove = targetFallen - currentBottomCount;
      let moved = 0;
      for (const p of particles) {
        if (!p.inBottom && !p.falling && moved < toMove) {
          p.inBottom = true;
          p.falling = false;
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
      const toMove = currentBottomCount - targetFallen;
      let moved = 0;
      for (const p of particles) {
        if ((p.inBottom || p.falling) && moved < toMove) {
          p.inBottom = false;
          p.falling = false;
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

  const render = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(2, 2);

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

  const renderStatic = (progress) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(2, 2);

    const topFill = 1 - progress;
    const bottomFill = progress;

    ctx.fillStyle = `rgba(${PARTICLE_COLOR.r}, ${PARTICLE_COLOR.g}, ${PARTICLE_COLOR.b}, 0.4)`;

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

  return {
    init,
    update,
    redistribute,
    render,
    renderStatic,
    get hasParticles() {
      return particles.length > 0;
    },
  };
};
