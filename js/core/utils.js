/**
 * @module core/utils
 * Pure utility functions shared across the application.
 */

export const formatTime = (value) => {
  if (!Number.isFinite(value)) return "--:--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const hash2 = (x, y) => {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

export const valueNoise2D = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(ix, iy);
  const v10 = hash2(ix + 1, iy);
  const v01 = hash2(ix, iy + 1);
  const v11 = hash2(ix + 1, iy + 1);
  return (v00 + (v10 - v00) * sx) * (1 - sy) + (v01 + (v11 - v01) * sx) * sy;
};

export const fbmNoise2D = (x, y, octaves = 3) => {
  let value = 0,
    amp = 0.5,
    freq = 1,
    max = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return value / max;
};
