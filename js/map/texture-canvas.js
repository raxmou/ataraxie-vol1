/**
 * Canvas-based texture renderer for state patchwork effect.
 * Renders textures clipped to state outlines, synced with SVG viewBox.
 */

import { TEXTURE_FILES, getTextureIndexForState } from "../core/constants.js";

/**
 * Create a texture canvas renderer.
 * @param {Object} options
 * @param {HTMLElement} options.container - Container element (.map-pane)
 * @param {SVGElement} options.svg - The SVG element to sync viewBox with
 * @param {Map} options.stateOutlines - Map of stateId -> {pathData, rings, bounds}
 * @returns {Object} Canvas API
 */
export const createTextureCanvas = ({ container, svg, stateOutlines }) => {
  const canvas = document.createElement("canvas");
  canvas.className = "texture-canvas";
  container.insertBefore(canvas, svg);

  const ctx = canvas.getContext("2d", { willReadFrequently: false });

  // Texture image cache
  const textureImages = new Map(); // index -> Image
  let texturesLoaded = false;

  // Current state
  let currentViewBox = null;
  let currentRevealedStates = new Set();
  let currentHoveredState = null;

  // Precomputed Path2D objects for each state
  const statePaths = new Map();
  for (const [stateId, outline] of stateOutlines) {
    try {
      const path = new Path2D(outline.pathData);
      statePaths.set(stateId, path);
    } catch (e) {
      console.warn(`Failed to create Path2D for state ${stateId}:`, e);
    }
  }

  /**
   * Load all texture images.
   */
  const loadTextures = async () => {
    const promises = TEXTURE_FILES.map((url, index) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          textureImages.set(index, img);
          resolve(img);
        };
        img.onerror = reject;
        img.src = url;
      });
    });

    await Promise.all(promises);
    texturesLoaded = true;
  };

  /**
   * Resize canvas to match container.
   */
  const resize = () => {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // Re-render after resize
    if (currentViewBox) {
      render(currentRevealedStates, currentViewBox);
    }
  };

  /**
   * Parse SVG viewBox string.
   */
  const parseViewBox = (viewBoxStr) => {
    if (!viewBoxStr) return null;
    const parts = viewBoxStr.split(/\s+/).map(Number);
    if (parts.length !== 4) return null;
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  };

  /**
   * Render textures for revealed states.
   * @param {Set} revealedStates - Set of revealed state IDs
   * @param {Object|string} viewBox - ViewBox object or string
   */
  const render = (revealedStates, viewBox) => {
    if (!texturesLoaded) return;

    currentRevealedStates = revealedStates;

    // Parse viewBox if string
    if (typeof viewBox === "string") {
      viewBox = parseViewBox(viewBox);
    }
    if (!viewBox) {
      viewBox = parseViewBox(svg.getAttribute("viewBox"));
    }
    if (!viewBox) return;

    currentViewBox = viewBox;

    const { x, y, width, height } = viewBox;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Clear canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Set transform to match SVG viewBox
    const scaleX = canvasWidth / width;
    const scaleY = canvasHeight / height;
    ctx.setTransform(scaleX, 0, 0, scaleY, -x * scaleX, -y * scaleY);

    // Draw faint textures for fogged (unrevealed) states
    ctx.globalAlpha = 0.15;
    for (const [stateId, path] of statePaths) {
      if (stateId === "0" || revealedStates.has(stateId)) continue;

      const outline = stateOutlines.get(stateId);
      if (!outline) continue;

      const textureIndex = getTextureIndexForState(stateId);
      const textureImg = textureImages.get(textureIndex);
      if (!textureImg) continue;

      const { bounds } = outline;

      ctx.save();
      ctx.clip(path);

      // Same adaptive tile sizing as revealed states
      const scale = Math.max(scaleX, scaleY);
      const texNaturalSize = Math.max(textureImg.naturalWidth, textureImg.naturalHeight);
      let texSize = texNaturalSize / scale;
      texSize = Math.max(64, Math.min(512, texSize));

      const startX = Math.floor(bounds.minX / texSize) * texSize;
      const startY = Math.floor(bounds.minY / texSize) * texSize;

      for (let tx = startX; tx < bounds.maxX; tx += texSize) {
        for (let ty = startY; ty < bounds.maxY; ty += texSize) {
          ctx.drawImage(textureImg, tx, ty, texSize, texSize);
        }
      }

      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Drop shadow behind revealed states to lift them off the background
    const shadowBlur = 24 / Math.max(scaleX, scaleY);
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    for (const stateId of revealedStates) {
      if (stateId === "0") continue;
      const path = statePaths.get(stateId);
      if (!path) continue;
      ctx.fill(path);
    }
    ctx.restore();

    // Draw textures for revealed states
    for (const stateId of revealedStates) {
      if (stateId === "0") continue; // Skip ocean

      const outline = stateOutlines.get(stateId);
      const path = statePaths.get(stateId);
      if (!outline || !path) continue;

      const textureIndex = getTextureIndexForState(stateId);
      const textureImg = textureImages.get(textureIndex);
      if (!textureImg) continue;

      const { bounds } = outline;

      ctx.save();
      ctx.clip(path);

      // Calculate adaptive tile size based on zoom level
      // Goal: texture pixels should roughly match canvas pixels for crisp rendering
      const scale = Math.max(scaleX, scaleY);
      const texNaturalSize = Math.max(textureImg.naturalWidth, textureImg.naturalHeight);

      // Target: each texture pixel covers ~1 canvas pixel
      // texSize (in SVG units) * scale = texNaturalSize (texture pixels)
      // So: texSize = texNaturalSize / scale
      let texSize = texNaturalSize / scale;

      // Clamp to reasonable range to avoid too many tiles when zoomed out
      // or too large tiles when extremely zoomed in
      const minTileSize = 64;
      const maxTileSize = 512;
      texSize = Math.max(minTileSize, Math.min(maxTileSize, texSize));

      const startX = Math.floor(bounds.minX / texSize) * texSize;
      const startY = Math.floor(bounds.minY / texSize) * texSize;

      for (let tx = startX; tx < bounds.maxX; tx += texSize) {
        for (let ty = startY; ty < bounds.maxY; ty += texSize) {
          ctx.drawImage(textureImg, tx, ty, texSize, texSize);
        }
      }

      ctx.restore();
    }

    // Draw borders on top of textures for revealed states
    ctx.strokeStyle = "#bdff00";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const baseLineWidth = 4 / Math.max(scaleX, scaleY);
    const hoverLineWidth = 8 / Math.max(scaleX, scaleY);

    for (const stateId of revealedStates) {
      if (stateId === "0") continue;
      const path = statePaths.get(stateId);
      if (!path) continue;

      const isHovered = stateId === currentHoveredState;
      ctx.lineWidth = isHovered ? hoverLineWidth : baseLineWidth;
      ctx.globalAlpha = isHovered ? 1 : 0.85;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
  };

  /**
   * Sync render with current SVG viewBox.
   */
  const syncWithSvg = () => {
    const viewBoxStr = svg.getAttribute("viewBox");
    if (viewBoxStr) {
      render(currentRevealedStates, viewBoxStr);
    }
  };

  /**
   * Set hovered state and re-render.
   * @param {string|null} stateId - State ID to highlight, or null to clear
   */
  const setHoveredState = (stateId) => {
    if (currentHoveredState === stateId) return;
    currentHoveredState = stateId;
    if (currentViewBox) {
      render(currentRevealedStates, currentViewBox);
    }
  };

  /**
   * Dispose of canvas and resources.
   */
  const dispose = () => {
    if (canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
    textureImages.clear();
    statePaths.clear();
  };

  // Set up resize observer
  const resizeObserver = new ResizeObserver(() => {
    resize();
  });
  resizeObserver.observe(container);

  // Initial resize
  resize();

  return {
    canvas,
    loadTextures,
    resize,
    render,
    syncWithSvg,
    setHoveredState,
    dispose,
    get texturesLoaded() {
      return texturesLoaded;
    },
  };
};
