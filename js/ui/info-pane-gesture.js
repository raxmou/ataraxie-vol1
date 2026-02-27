/**
 * @module ui/info-pane-gesture
 * Swipe-to-close gesture for the info pane.
 */

/**
 * Swipeable info pane gesture — portrait (vertical) + landscape (horizontal edge swipe).
 * @param {HTMLElement} infoPane
 * @param {Object} opts
 * @param {Function} opts.onMinimize
 * @param {Function} opts.onMaximize
 * @param {number}   [opts.peekHeight=60]
 * @param {number}   [opts.landscapePeekWidth=40]
 */
export function createInfoPaneGesture(
  infoPane,
  { onMinimize, onMaximize, peekHeight = 60, landscapePeekWidth = 40 } = {},
) {
  const handle = infoPane.querySelector(".info-pane-handle");
  let minimized = false;
  let disposed = false;

  // Gesture state
  let startPos = 0;
  let startTime = 0;
  let paneSize = 0;
  let maxTravel = 0;
  let axis = ""; // "y" or "x"

  const isLandscape = () => matchMedia("(max-width: 900px) and (orientation: landscape)").matches;

  // ── Portrait: vertical swipe on handle ──

  function onHandleTouchStart(e) {
    if (isLandscape() || disposed) return;
    const touch = e.touches[0];
    axis = "y";
    startPos = touch.clientY;
    startTime = Date.now();
    paneSize = infoPane.offsetHeight;
    maxTravel = paneSize - peekHeight;
    infoPane.classList.add("is-gesture-active");
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
  }

  // ── Landscape: horizontal edge swipe on pane ──

  function onPaneTouchStart(e) {
    if (!isLandscape() || disposed) return;
    const touch = e.touches[0];
    const rect = infoPane.getBoundingClientRect();
    const offsetX = touch.clientX - rect.left;

    // Only trigger from left 40px edge, or anywhere when minimized
    if (!minimized && offsetX > landscapePeekWidth) return;

    axis = "x";
    startPos = touch.clientX;
    startTime = Date.now();
    paneSize = infoPane.offsetWidth;
    maxTravel = paneSize - landscapePeekWidth;
    infoPane.classList.add("is-gesture-active");
    e.preventDefault();
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
  }

  function onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];

    if (axis === "y") {
      let delta = touch.clientY - startPos;
      // If maximized, only allow positive (downward) drag; if minimized, negative (upward)
      if (!minimized) delta = Math.max(0, Math.min(delta, maxTravel));
      else delta = Math.max(-maxTravel, Math.min(delta, 0));

      const base = minimized ? maxTravel : 0;
      infoPane.style.transform = `translateY(${base + delta}px)`;
    } else {
      let delta = touch.clientX - startPos;
      if (!minimized) delta = Math.max(0, Math.min(delta, maxTravel));
      else delta = Math.max(-maxTravel, Math.min(delta, 0));

      const base = minimized ? maxTravel : 0;
      infoPane.style.transform = `translateX(${base + delta}px)`;
    }
  }

  function onTouchEnd(e) {
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    infoPane.classList.remove("is-gesture-active");

    const touch = e.changedTouches[0];
    const endPos = axis === "y" ? touch.clientY : touch.clientX;
    const delta = endPos - startPos;
    const elapsed = Date.now() - startTime;
    const velocity = Math.abs(delta) / elapsed; // px/ms

    // Clear inline transform — CSS class handles final position
    infoPane.style.transform = "";

    const VELOCITY_THRESHOLD = 0.3;
    const POSITION_THRESHOLD = 0.4;

    let shouldMinimize;
    if (velocity > VELOCITY_THRESHOLD) {
      // Fast swipe — direction decides
      shouldMinimize = axis === "y" ? delta > 0 : delta > 0;
    } else {
      // Slow drag — position decides
      const travel = minimized ? -delta : delta;
      shouldMinimize = minimized
        ? travel < maxTravel * POSITION_THRESHOLD // didn't drag far enough to maximize
        : travel > maxTravel * POSITION_THRESHOLD; // dragged far enough to minimize
    }

    if (shouldMinimize && !minimized) {
      setMinimized(true);
    } else if (!shouldMinimize && minimized) {
      setMinimized(false);
    }
  }

  // ── Tap to toggle ──

  function onHandleClick() {
    if (disposed) return;
    toggle();
  }

  // ── State management ──

  function setMinimized(value) {
    minimized = value;
    infoPane.classList.toggle("is-minimized", minimized);
    if (minimized) {
      onMinimize?.();
    } else {
      onMaximize?.();
    }
  }

  function toggle() {
    setMinimized(!minimized);
  }

  function minimize() {
    if (!minimized) setMinimized(true);
  }

  function maximize() {
    if (minimized) setMinimized(false);
  }

  // ── Lifecycle ──

  function init() {
    if (handle) {
      handle.addEventListener("touchstart", onHandleTouchStart, { passive: true });
      handle.addEventListener("click", onHandleClick);
    }
    infoPane.addEventListener("touchstart", onPaneTouchStart, { passive: false });
  }

  function dispose() {
    disposed = true;
    if (handle) {
      handle.removeEventListener("touchstart", onHandleTouchStart);
      handle.removeEventListener("click", onHandleClick);
    }
    infoPane.removeEventListener("touchstart", onPaneTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    infoPane.classList.remove("is-minimized", "is-gesture-active");
    infoPane.style.transform = "";
  }

  return {
    init,
    dispose,
    minimize,
    maximize,
    toggle,
    get isMinimized() {
      return minimized;
    },
  };
}
