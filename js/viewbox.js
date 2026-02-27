import { easeInOutCubic } from "./core/utils.js";

export const createViewBoxAnimator = (svg, options = {}) => {
  const prefersReducedMotion = Boolean(options.prefersReducedMotion);
  let frameId = null;
  let activeComplete = null;

  const set = (box) => {
    if (!svg || !box) return;
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  };

  const parse = () => {
    const attr = svg?.getAttribute("viewBox");
    if (!attr) return null;
    const [x, y, width, height] = attr.split(/\s+/).map(Number);
    if (![x, y, width, height].every((v) => Number.isFinite(v))) return null;
    return { x, y, width, height };
  };

  const animate = (target, duration = 700, onComplete) => {
    if (!svg || !target) return;
    const from = parse();
    if (!from || duration === 0 || prefersReducedMotion) {
      set(target);
      if (onComplete) onComplete();
      return;
    }
    if (frameId) {
      cancelAnimationFrame(frameId);
      if (activeComplete) activeComplete();
    }
    activeComplete = onComplete;
    const start = performance.now();
    const step = (now) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = easeInOutCubic(t);
      const next = {
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        width: from.width + (target.width - from.width) * eased,
        height: from.height + (target.height - from.height) * eased,
      };
      set(next);
      if (t < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        frameId = null;
        if (activeComplete) activeComplete();
        activeComplete = null;
      }
    };
    frameId = requestAnimationFrame(step);
  };

  return {
    set,
    parse,
    animate,
  };
};

export const createTransformAnimator = (element, options = {}) => {
  const prefersReducedMotion = Boolean(options.prefersReducedMotion);
  let frameId = null;
  let activeComplete = null;
  let targetElement = element;

  const setElement = (nextElement) => {
    targetElement = nextElement;
  };

  const set = ({ x = 0, y = 0, scale = 1 }) => {
    if (!targetElement) return;
    if (x === 0 && y === 0 && scale === 1) {
      targetElement.removeAttribute("transform");
      return;
    }
    targetElement.setAttribute("transform", `matrix(${scale} 0 0 ${scale} ${x} ${y})`);
  };

  const animate = (from, to, duration = 700, onComplete) => {
    if (!targetElement || !to) return;
    if (duration === 0 || prefersReducedMotion) {
      set(to);
      if (onComplete) onComplete();
      return;
    }
    if (frameId) {
      cancelAnimationFrame(frameId);
      if (activeComplete) activeComplete();
    }
    activeComplete = onComplete;
    const start = performance.now();
    const step = (now) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = easeInOutCubic(t);
      const next = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        scale: from.scale + (to.scale - from.scale) * eased,
      };
      set(next);
      if (t < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        frameId = null;
        if (activeComplete) activeComplete();
        activeComplete = null;
      }
    };
    frameId = requestAnimationFrame(step);
  };

  return {
    setElement,
    set,
    animate,
  };
};
