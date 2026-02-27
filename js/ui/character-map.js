/**
 * @module ui/character-map
 * Map-view character: SVG image on trail layer, puff particles, bark speech bubbles.
 */

import { SVG_NS, PREFERS_REDUCED_MOTION } from "../core/constants.js";
import { CHARACTER_MOVE_MAP } from "./character-data.js";

const prefersReducedMotion = PREFERS_REDUCED_MOTION;

export const createMapCharacterManager = ({
  svg,
  getMapApi,
  getFullViewBox,
  getSelectedCharacter,
  getExplorationTrails,
  getExplorationOrder,
  getMapPane,
}) => {
  let mapCharacter = null;
  let mapCharacterFrameIdx = 0;
  let mapCharacterInterval = null;
  let mapCharacterStateId = null;
  let mapCharacterBarkTimers = [];
  let mapCharacterBark = null;
  let barkRafId = null;

  const getStateCenter = (stateId) => {
    const mapApi = getMapApi();
    const bounds = mapApi?.getStateBounds(stateId);
    if (!bounds) return null;
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
  };

  const getMarkerRadius = () => {
    const fullViewBox = getFullViewBox();
    if (!fullViewBox) return 3;
    return Math.min(fullViewBox.width, fullViewBox.height) * 0.005;
  };

  const spawnPuffParticles = (cx, cy, size, layer) => {
    const count = 7;
    const drift = size * 0.6;
    const dur = "700ms";
    const wisps = [];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const dx = Math.cos(angle) * drift * (0.6 + Math.random() * 0.4);
      const dy = Math.sin(angle) * drift * (0.6 + Math.random() * 0.4);
      const baseR = size * (0.08 + Math.random() * 0.06);
      const stagger = `${i * 30}ms`;

      const el = document.createElementNS(SVG_NS, "ellipse");
      el.setAttribute("cx", cx);
      el.setAttribute("cy", cy);
      el.setAttribute("rx", baseR);
      el.setAttribute("ry", baseR * 0.7);
      el.setAttribute("fill", "rgba(189,255,0,0.35)");
      el.setAttribute("filter", "url(#puff-blur)");
      el.classList.add("puff-wisp");

      const attrs = [
        ["cx", `${cx}`, `${cx + dx}`],
        ["cy", `${cy}`, `${cy + dy}`],
        ["rx", `${baseR}`, `${baseR * 2.5}`],
        ["ry", `${baseR * 0.7}`, `${baseR * 1.8}`],
        ["opacity", "0.6", "0"],
      ];
      for (const [attr, from, to] of attrs) {
        const anim = document.createElementNS(SVG_NS, "animate");
        anim.setAttribute("attributeName", attr);
        anim.setAttribute("from", from);
        anim.setAttribute("to", to);
        anim.setAttribute("dur", dur);
        anim.setAttribute("begin", stagger);
        anim.setAttribute("fill", "freeze");
        el.appendChild(anim);
      }
      layer.appendChild(el);
      wisps.push(el);
    }
    setTimeout(() => wisps.forEach((w) => w.remove()), 900);
  };

  const stopBarkTracking = () => {
    if (barkRafId) {
      cancelAnimationFrame(barkRafId);
      barkRafId = null;
    }
  };

  const updateBarkPosition = () => {
    if (!mapCharacterBark || !mapCharacter) {
      stopBarkTracking();
      return;
    }
    const mapPane = getMapPane();
    const rect = mapCharacter.getBoundingClientRect();
    const parentRect = mapPane.getBoundingClientRect();
    mapCharacterBark.style.left = `${rect.left - parentRect.left + rect.width / 2}px`;
    mapCharacterBark.style.top = `${rect.top - parentRect.top - 8}px`;
    barkRafId = requestAnimationFrame(updateBarkPosition);
  };

  const hideBark = () => {
    mapCharacterBarkTimers.forEach((t) => clearTimeout(t));
    mapCharacterBarkTimers = [];
    stopBarkTracking();
    if (mapCharacterBark) {
      mapCharacterBark.remove();
      mapCharacterBark = null;
    }
  };

  const showBark = (text, duration = 4000) => {
    if (mapCharacterBark) {
      stopBarkTracking();
      mapCharacterBark.remove();
      mapCharacterBark = null;
    }
    const mapPane = getMapPane();
    if (!mapCharacter || !svg) return;
    const rect = mapCharacter.getBoundingClientRect();
    const parentRect = mapPane.getBoundingClientRect();
    const bubble = document.createElement("div");
    bubble.className = "state-character-bubble";
    bubble.textContent = text;
    bubble.style.left = `${rect.left - parentRect.left + rect.width / 2}px`;
    bubble.style.top = `${rect.top - parentRect.top - 8}px`;
    mapPane.appendChild(bubble);
    mapCharacterBark = bubble;
    barkRafId = requestAnimationFrame(updateBarkPosition);
    mapCharacterBarkTimers.push(
      setTimeout(() => {
        if (mapCharacterBark === bubble) {
          stopBarkTracking();
          bubble.remove();
          mapCharacterBark = null;
        }
      }, duration),
    );
  };

  const remove = () => {
    stopBarkTracking();
    hideBark();
    if (mapCharacterInterval) {
      clearInterval(mapCharacterInterval);
      mapCharacterInterval = null;
    }
    if (mapCharacter) {
      const layer = mapCharacter.parentNode;
      if (layer) layer.querySelectorAll(".puff-wisp").forEach((w) => w.remove());
      mapCharacter.remove();
      mapCharacter = null;
    }
    mapCharacterStateId = null;
    mapCharacterFrameIdx = 0;
  };

  const create = (arriving = false) => {
    remove();
    const selectedCharacter = getSelectedCharacter();
    const mapApi = getMapApi();
    if (!selectedCharacter || !mapApi) return;
    const moveSet = CHARACTER_MOVE_MAP[selectedCharacter];
    if (!moveSet?.idle?.length) return;

    const layer = mapApi.getTrailLayer();
    if (!layer) return;

    const explorationOrder = getExplorationOrder();
    const targetState =
      explorationOrder.length > 0 ? explorationOrder[explorationOrder.length - 1] : "1";
    const center = getStateCenter(targetState);
    if (!center) return;

    const size = getMarkerRadius() * 8;
    const img = document.createElementNS(SVG_NS, "image");
    img.setAttribute("width", size);
    img.setAttribute("height", size);
    img.setAttribute("x", center.x - size / 2);
    img.setAttribute("y", center.y - size / 2);
    img.setAttribute("href", moveSet.idle[0]);
    img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", moveSet.idle[0]);
    img.classList.add("map-character");

    const isFirstArrival = arriving && explorationOrder.length <= 1;
    if (isFirstArrival && !prefersReducedMotion) {
      spawnPuffParticles(center.x, center.y, size, layer);
      img.classList.add("map-character--arriving");
    }

    layer.appendChild(img);
    mapCharacter = img;
    mapCharacterFrameIdx = 0;
    mapCharacterStateId = targetState;

    if (isFirstArrival && !prefersReducedMotion) {
      setTimeout(() => mapCharacter?.classList.remove("map-character--arriving"), 800);
    }

    mapCharacterInterval = setInterval(() => {
      mapCharacterFrameIdx = (mapCharacterFrameIdx + 1) % moveSet.idle.length;
      if (mapCharacter) {
        const src = moveSet.idle[mapCharacterFrameIdx];
        mapCharacter.setAttribute("href", src);
        mapCharacter.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", src);
      }
    }, 350);
  };

  const renderTrails = () => {
    const mapApi = getMapApi();
    const layer = mapApi?.getTrailLayer();
    if (!layer) return;

    const hadCharacter = !!mapCharacter;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (hadCharacter) mapCharacter = null;

    const r = getMarkerRadius();
    const explorationTrails = getExplorationTrails();
    const explorationOrder = getExplorationOrder();

    explorationTrails.forEach(({ from, to }) => {
      const fromCenter = getStateCenter(from);
      const toCenter = getStateCenter(to);
      if (!fromCenter || !toCenter) return;

      const mid = mapApi.getSharedBorderMidpoint(from, to);
      let d;
      if (mid) {
        d = `M ${fromCenter.x} ${fromCenter.y} Q ${mid.x} ${mid.y} ${toCenter.x} ${toCenter.y}`;
      } else {
        const mx = (fromCenter.x + toCenter.x) / 2;
        const my = (fromCenter.y + toCenter.y) / 2;
        const dx = toCenter.x - fromCenter.x;
        const dy = toCenter.y - fromCenter.y;
        const offset = Math.sqrt(dx * dx + dy * dy) * 0.15;
        d = `M ${fromCenter.x} ${fromCenter.y} Q ${mx + (-dy * offset) / Math.sqrt(dx * dx + dy * dy)} ${my + (dx * offset) / Math.sqrt(dx * dx + dy * dy)} ${toCenter.x} ${toCenter.y}`;
      }

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.classList.add("trail-line");
      layer.appendChild(path);
    });

    explorationOrder.forEach((stateId, i) => {
      const center = getStateCenter(stateId);
      if (!center) return;
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", center.x);
      circle.setAttribute("cy", center.y);
      circle.setAttribute("r", r);
      circle.classList.add("trail-marker");
      if (i === 0) circle.classList.add("trail-marker--origin");
      layer.appendChild(circle);
    });

    const selectedCharacter = getSelectedCharacter();
    if (hadCharacter && selectedCharacter) {
      create();
    }
  };

  const drawTrailSegment = (fromStateId, toStateId) => {
    const mapApi = getMapApi();
    const layer = mapApi?.getTrailLayer();
    if (!layer) return;

    const fromCenter = getStateCenter(fromStateId);
    const toCenter = getStateCenter(toStateId);
    if (!fromCenter || !toCenter) return;

    const r = getMarkerRadius();
    const mid = mapApi.getSharedBorderMidpoint(fromStateId, toStateId);

    let d;
    if (mid) {
      d = `M ${fromCenter.x} ${fromCenter.y} Q ${mid.x} ${mid.y} ${toCenter.x} ${toCenter.y}`;
    } else {
      const mx = (fromCenter.x + toCenter.x) / 2;
      const my = (fromCenter.y + toCenter.y) / 2;
      const dx = toCenter.x - fromCenter.x;
      const dy = toCenter.y - fromCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const offset = dist * 0.15;
      d = `M ${fromCenter.x} ${fromCenter.y} Q ${mx + (-dy * offset) / dist} ${my + (dx * offset) / dist} ${toCenter.x} ${toCenter.y}`;
    }

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.classList.add("trail-line");
    layer.appendChild(path);

    if (!prefersReducedMotion) {
      path.classList.add("trail-line--appear");
      setTimeout(() => {
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", toCenter.x);
        circle.setAttribute("cy", toCenter.y);
        circle.setAttribute("r", r);
        circle.classList.add("trail-marker", "trail-marker--appear");
        layer.appendChild(circle);
        if (mapCharacter) layer.appendChild(mapCharacter);
      }, 800);
    } else {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", toCenter.x);
      circle.setAttribute("cy", toCenter.y);
      circle.setAttribute("r", r);
      circle.classList.add("trail-marker");
      layer.appendChild(circle);
    }

    if (mapCharacter) layer.appendChild(mapCharacter);
  };

  const updatePosition = (toStateId, fromStateId, animate = true) => {
    if (!mapCharacter) return;
    const toCenter = getStateCenter(toStateId);
    if (!toCenter) return;

    const size = parseFloat(mapCharacter.getAttribute("width"));

    if (!animate || prefersReducedMotion || !fromStateId) {
      mapCharacter.setAttribute("x", toCenter.x - size / 2);
      mapCharacter.setAttribute("y", toCenter.y - size / 2);
      mapCharacterStateId = toStateId;
      return;
    }

    const fromCenter = getStateCenter(fromStateId);
    if (!fromCenter) {
      mapCharacter.setAttribute("x", toCenter.x - size / 2);
      mapCharacter.setAttribute("y", toCenter.y - size / 2);
      mapCharacterStateId = toStateId;
      return;
    }

    const mapApi = getMapApi();
    let cp;
    const mid = mapApi?.getSharedBorderMidpoint(fromStateId, toStateId);
    if (mid) {
      cp = mid;
    } else {
      const mx = (fromCenter.x + toCenter.x) / 2;
      const my = (fromCenter.y + toCenter.y) / 2;
      const dx = toCenter.x - fromCenter.x;
      const dy = toCenter.y - fromCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const offset = dist * 0.15;
      cp = { x: mx + (-dy * offset) / dist, y: my + (dx * offset) / dist };
    }

    const duration = 1400;
    const start = performance.now();

    const step = (now) => {
      const elapsed = now - start;
      let t = Math.min(elapsed / duration, 1);
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const u = 1 - t;
      const bx = u * u * fromCenter.x + 2 * u * t * cp.x + t * t * toCenter.x;
      const by = u * u * fromCenter.y + 2 * u * t * cp.y + t * t * toCenter.y;

      mapCharacter.setAttribute("x", bx - size / 2);
      mapCharacter.setAttribute("y", by - size / 2);

      if (elapsed < duration) {
        requestAnimationFrame(step);
      } else {
        mapCharacterStateId = toStateId;
      }
    };

    requestAnimationFrame(step);
  };

  return {
    create,
    remove,
    renderTrails,
    drawTrailSegment,
    updatePosition,
    showBark,
    hideBark,
    getStateCenter,
    getMarkerRadius,
    get element() {
      return mapCharacter;
    },
    get barkTimers() {
      return mapCharacterBarkTimers;
    },
  };
};
