/**
 * @module map/map-gestures
 * Pinch-to-zoom and pan gesture handling for the SVG map.
 */

/**
 * Map gestures — pinch-to-zoom + drag-to-pan via Pointer Events.
 * Manipulates the SVG viewBox; texture canvas auto-syncs via MutationObserver.
 *
 * @param {SVGSVGElement} svg
 * @param {Object} opts
 * @param {Function} opts.getFullViewBox  — returns { x, y, width, height }
 * @param {Function} opts.getViewBox      — returns current viewBox
 * @param {Function} opts.setViewBox      — sets viewBox
 * @param {number}   [opts.minZoomRatio=0.15]  — min viewBox width as fraction of full
 * @param {number}   [opts.maxZoomRatio=1.0]   — max viewBox width as fraction of full
 * @returns {{ enable, disable, reset, destroy, getUserViewBox }}
 */
export function createMapGestures(
  svg,
  { getFullViewBox, getViewBox, setViewBox, minZoomRatio = 0.15, maxZoomRatio = 1.0 } = {},
) {
  let enabled = false;
  let userViewBox = null; // last user pan/zoom position (to restore after state view)
  const pointers = new Map(); // pointerId → { x, y }
  let dragStart = null; // { vbx, vby } at gesture start
  let pinchStartDist = 0;
  let pinchStartWidth = 0;
  let pinchMidSVG = null;
  let totalMovement = 0;
  let pointerDownTime = 0;
  let momentumId = null;
  let velocity = { x: 0, y: 0 };
  let lastMoveTime = 0;
  let lastDelta = { x: 0, y: 0 };

  // ── Coordinate helpers ──

  const screenToSVG = (sx, sy) => {
    const vb = getViewBox();
    const rect = svg.getBoundingClientRect();
    if (!vb || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: vb.x + ((sx - rect.left) / rect.width) * vb.width,
      y: vb.y + ((sy - rect.top) / rect.height) * vb.height,
    };
  };

  const clamp = (vb) => {
    const full = getFullViewBox();
    if (!full) return vb;
    // Clamp width
    const minW = full.width * minZoomRatio;
    const maxW = full.width * maxZoomRatio;
    let w = Math.max(minW, Math.min(maxW, vb.width));
    // Derive height from aspect ratio of the SVG element
    const rect = svg.getBoundingClientRect();
    const aspect = rect.height / rect.width;
    let h = w * aspect;
    // Clamp position within full bounds
    let x = Math.max(full.x, Math.min(full.x + full.width - w, vb.x));
    let y = Math.max(full.y, Math.min(full.y + full.height - h, vb.y));
    return { x, y, width: w, height: h };
  };

  // ── Momentum ──

  const startMomentum = () => {
    stopMomentum();
    if (Math.abs(velocity.x) < 0.5 && Math.abs(velocity.y) < 0.5) return;
    const friction = 0.92;
    const tick = () => {
      velocity.x *= friction;
      velocity.y *= friction;
      if (Math.abs(velocity.x) < 0.5 && Math.abs(velocity.y) < 0.5) {
        momentumId = null;
        return;
      }
      const vb = getViewBox();
      if (!vb) {
        momentumId = null;
        return;
      }
      const full = getFullViewBox();
      if (!full) {
        momentumId = null;
        return;
      }
      // Convert pixel velocity to SVG units
      const rect = svg.getBoundingClientRect();
      const scale = vb.width / rect.width;
      const next = clamp({
        ...vb,
        x: vb.x - velocity.x * scale,
        y: vb.y - velocity.y * scale,
      });
      setViewBox(next);
      userViewBox = next;
      momentumId = requestAnimationFrame(tick);
    };
    momentumId = requestAnimationFrame(tick);
  };

  const stopMomentum = () => {
    if (momentumId) {
      cancelAnimationFrame(momentumId);
      momentumId = null;
    }
  };

  // ── Pointer handlers ──

  const onPointerDown = (e) => {
    if (!enabled) return;
    stopMomentum();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);

    if (pointers.size === 1) {
      totalMovement = 0;
      pointerDownTime = performance.now();
      const vb = getViewBox();
      dragStart = vb ? { vbx: vb.x, vby: vb.y } : null;
      velocity = { x: 0, y: 0 };
      lastMoveTime = performance.now();
      lastDelta = { x: 0, y: 0 };
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(b.x - a.x, b.y - a.y);
      const vb = getViewBox();
      pinchStartWidth = vb ? vb.width : 0;
      pinchMidSVG = screenToSVG((a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  };

  const onPointerMove = (e) => {
    if (!enabled || !pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    totalMovement += Math.abs(dx) + Math.abs(dy);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const vb = getViewBox();
    if (!vb) return;
    const rect = svg.getBoundingClientRect();
    const scale = vb.width / rect.width;

    if (pointers.size === 1 && dragStart) {
      // Pan
      const now = performance.now();
      const dt = now - lastMoveTime;
      lastMoveTime = now;
      lastDelta = { x: dx, y: dy };
      if (dt > 0) {
        velocity = { x: (dx / dt) * 16, y: (dy / dt) * 16 }; // normalize to ~frame
      }
      const next = clamp({
        ...vb,
        x: vb.x - dx * scale,
        y: vb.y - dy * scale,
      });
      setViewBox(next);
      userViewBox = next;
    } else if (pointers.size === 2 && pinchStartDist > 0) {
      // Pinch zoom
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ratio = pinchStartDist / dist; // >1 = zoom out, <1 = zoom in
      const newWidth = pinchStartWidth * ratio;

      // Anchor on pinch midpoint in SVG space
      const midScreen = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const midFrac = {
        x: (midScreen.x - rect.left) / rect.width,
        y: (midScreen.y - rect.top) / rect.height,
      };
      const aspect = rect.height / rect.width;
      const newHeight = newWidth * aspect;
      const next = clamp({
        x: pinchMidSVG.x - midFrac.x * newWidth,
        y: pinchMidSVG.y - midFrac.y * newHeight,
        width: newWidth,
        height: newHeight,
      });
      setViewBox(next);
      userViewBox = next;
    }
  };

  const onPointerUp = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (pointers.size === 0) {
      const elapsed = performance.now() - pointerDownTime;
      const isTap = totalMovement < 10 && elapsed < 300;
      if (!isTap && enabled) {
        startMomentum();
      }
      dragStart = null;
    }
    // If back to 1 pointer after pinch, reset drag origin
    if (pointers.size === 1) {
      const vb = getViewBox();
      dragStart = vb ? { vbx: vb.x, vby: vb.y } : null;
      pinchStartDist = 0;
      velocity = { x: 0, y: 0 };
    }
  };

  const onPointerCancel = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragStart = null;
  };

  // Suppress click after drag (not tap)
  const onClickCapture = (e) => {
    if (totalMovement >= 10) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // ── Public API ──

  const enable = () => {
    if (enabled) return;
    enabled = true;
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerCancel);
    svg.addEventListener("click", onClickCapture, true);
    svg.style.touchAction = "none";
  };

  const disable = () => {
    if (!enabled) return;
    enabled = false;
    stopMomentum();
    pointers.clear();
    dragStart = null;
    svg.removeEventListener("pointerdown", onPointerDown);
    svg.removeEventListener("pointermove", onPointerMove);
    svg.removeEventListener("pointerup", onPointerUp);
    svg.removeEventListener("pointercancel", onPointerCancel);
    svg.removeEventListener("click", onClickCapture, true);
    svg.style.touchAction = "";
  };

  const reset = () => {
    userViewBox = null;
    stopMomentum();
  };

  const destroy = () => {
    disable();
    userViewBox = null;
  };

  const getUserViewBox = () => userViewBox;

  return { enable, disable, reset, destroy, getUserViewBox };
}
