/**
 * @module audio/hourglass/hourglass-constants
 * Hourglass geometry, colors, and physics constants.
 */

export const WIDTH = 100;
export const HEIGHT = 160;
export const CENTER_X = WIDTH / 2;
export const CENTER_Y = HEIGHT / 2;
export const GAP = 4;
export const PARTICLE_COLOR = { r: 189, g: 255, b: 0 };

// Triangle vertices
export const TOP_APEX_Y = CENTER_Y - GAP / 2;
export const TOP_BASE_Y = 10;
export const BOTTOM_APEX_Y = CENTER_Y + GAP / 2;
export const BOTTOM_BASE_Y = HEIGHT - 10;

// Triangle half-width at base
export const BASE_HALF_WIDTH = 40;

// Triangle area calculation for particle sizing
// Base = 80, Height = 68, Area = 0.5 * 80 * 68 = 2720
export const TRIANGLE_AREA = 0.5 * (BASE_HALF_WIDTH * 2) * (TOP_APEX_Y - TOP_BASE_Y);
export const TARGET_FILL = 0.8; // Particles should fill 80% of triangle
export const PACKING_EFFICIENCY = 0.35; // Physics packing in triangular shape is ~35% efficient

export const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
