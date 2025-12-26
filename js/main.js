const app = document.getElementById("app");
const svg = document.getElementById("map-svg");
const dataUrl = app?.dataset.geojson;

const svgNS = "http://www.w3.org/2000/svg";
const stateColors = new Map();
const oceanColor = "#d7dee8";
const goldenAngle = 137.508;

let activeCell = null;
let geojsonData = null; // store loaded geojson for single-state rendering

// Delegated click handler so clicks on `.cell` are always caught and logged.
svg.addEventListener("click", (e) => {
  let node = e.target;
  while (node && node !== svg) {
    if (node.classList && node.classList.contains("cell")) {
        setActiveCell(node);
        // Show bounding rect overlay for clicked state (start of animation sequence)
        const stateId = node.dataset.state;
        if (stateId) {
          prefetchStateResources(stateId);
          showBoundingRect(stateId);
        }
      return;
    }
    node = node.parentNode;
  }
});

// Prefetch the state page and geojson so the destination is ready post-animation.
function prefetchStateResources(stateId) {
  // prefetch state.html
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = `state.html?state=${encodeURIComponent(String(stateId))}`;
  document.head.appendChild(link);

  // prefetch geojson
  const geo = document.createElement('link');
  geo.rel = 'preload';
  geo.as = 'fetch';
  geo.href = dataUrl || 'Mia%20Cells%202025-12-23.geojson';
  document.head.appendChild(geo);
}

const bounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

const updateBounds = (x, y) => {
  if (x < bounds.minX) bounds.minX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y > bounds.maxY) bounds.maxY = y;
};

const forEachCoordinate = (geometry, callback) => {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => {
      ring.forEach(([x, y]) => callback(x, y));
    });
    return;
  }
  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        ring.forEach(([x, y]) => callback(x, y));
      });
    });
  }
};

const ringToPath = (ring) => {
  if (!ring.length) return "";
  const [firstX, firstY] = ring[0];
  let d = `M ${firstX} ${firstY}`;
  for (let i = 1; i < ring.length; i += 1) {
    const [x, y] = ring[i];
    d += ` L ${x} ${y}`;
  }
  return `${d} Z`;
};

const geometryToPath = (geometry) => {
  if (!geometry) return "";
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map(ringToPath).join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => polygon.map(ringToPath).join(" "))
      .join(" ");
  }
  return "";
};

const colorForState = (stateId, isOcean) => {
  if (isOcean) return oceanColor;
  if (stateColors.has(stateId)) return stateColors.get(stateId);
  const hue = (Number(stateId) * goldenAngle) % 360;
  const color = `hsl(${hue} 55% 58%)`;
  stateColors.set(stateId, color);
  return color;
};

const setActiveCell = (cell) => {
  console.log("Cell clicked:", cell);
  if (activeCell) activeCell.classList.remove("is-active");
  activeCell = cell;
  if (activeCell) activeCell.classList.add("is-active");
  console.log(activeCell ? `Active state: ${activeCell.dataset.state}` : "No active state");
};

// Note: single-state rendering now happens on a separate page (state.html).

const buildMap = (geojson) => {
  const fragment = document.createDocumentFragment();

  // Map of normalized edge key -> { states: Set<stateId>, coords: [a,b] }
  const edgeMap = new Map();
  const edgeKey = (a, b) => {
    const ka = `${a[0]},${a[1]}`;
    const kb = `${b[0]},${b[1]}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  geojson.features.forEach((feature) => {
    const geometry = feature.geometry;
    const properties = feature.properties || {};
    const stateId = String(properties.state ?? "0");
    const isOcean = Number(stateId) === 0;

    forEachCoordinate(geometry, updateBounds);

    // Record edges for this feature so we can detect shared edges
    if (geometry) {
      if (geometry.type === "Polygon") {
        geometry.coordinates.forEach((ring) => {
          for (let i = 0; i < ring.length; i += 1) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            const k = edgeKey(a, b);
            const existing = edgeMap.get(k);
            if (existing) {
              existing.states.add(String(stateId));
            } else {
              edgeMap.set(k, { states: new Set([String(stateId)]), coords: [a, b] });
            }
          }
        });
      }
      if (geometry.type === "MultiPolygon") {
        geometry.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => {
            for (let i = 0; i < ring.length; i += 1) {
              const a = ring[i];
              const b = ring[(i + 1) % ring.length];
              const k = edgeKey(a, b);
              const existing = edgeMap.get(k);
              if (existing) {
                existing.states.add(String(stateId));
              } else {
                edgeMap.set(k, { states: new Set([String(stateId)]), coords: [a, b] });
              }
            }
          });
        });
      }
    }

    const pathData = geometryToPath(geometry);
    if (!pathData) return;

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", colorForState(stateId, isOcean));
    path.classList.add("cell");
    path.dataset.state = stateId;
    if (isOcean) path.classList.add("is-ocean");

    // Clicks are handled by delegated listener on the SVG element.

    fragment.appendChild(path);
  });

  svg.appendChild(fragment);

  // Build state borders from shared edges in the cells GeoJSON.
  // Draw an edge when adjacent features have different `state` properties.
  const borderGroup = document.createDocumentFragment();
  // Map stateId -> array of border path elements for quick highlighting
  const stateBorderMap = new Map();
    for (const [, entry] of edgeMap.entries()) {
    const statesArray = Array.from(entry.states).map((s) => String(s));
    if (statesArray.length > 1) {
      // adjacent features belong to multiple states -> state border
      const [a, b] = entry.coords;
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`);
      p.classList.add("state-border");
      // store a small attribute with the touching states for hover mapping
      p.dataset.states = statesArray.join(",");
      // register this border for each touching state (including ocean)
      statesArray.forEach((s) => {
        if (!stateBorderMap.has(s)) stateBorderMap.set(s, []);
        stateBorderMap.get(s).push(p);
      });
      borderGroup.appendChild(p);
    }
  }
  svg.appendChild(borderGroup);

  // Hover handling: highlight state borders when hovering any cell of that state.
  svg.addEventListener("pointerover", (e) => {
    let node = e.target;
    
    while (node && node !== svg) {
      if (node.classList && node.classList.contains("cell")) {
          const state = node.dataset.state;
          if (state === "0") return; // ignore ocean hover
          if (state && stateBorderMap.has(state)) {
            stateBorderMap.get(state).forEach((p) => p.classList.add("is-hover"));
          }
        return;
      }
      node = node.parentNode;
    }
  });

  svg.addEventListener("pointerout", (e) => {
    let node = e.target;
    while (node && node !== svg) {
      if (node.classList && node.classList.contains("cell")) {
        const state = node.dataset.state;
        if (state === "0") return; // ignore ocean hover out
        if (state && stateBorderMap.has(state)) {
          stateBorderMap.get(state).forEach((p) => p.classList.remove("is-hover"));
        }
        return;
      }
      node = node.parentNode;
    }
  });

  if (Number.isFinite(bounds.minX)) {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    svg.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${width} ${height}`);
  }
};

const init = async () => {
  if (!dataUrl) return;
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("Failed to load geojson");
    const geojson = await response.json();
    geojsonData = geojson;
    buildMap(geojson);
  } catch (error) {
    console.error(error);
  }
};

init();

// Animate a clicked state element from its current screen position into the
// left-half target area, then navigate to the provided URL when animation finishes.
function animateStateToLeftAndNavigate(stateId, targetUrl) {
  // find a visible element for the state - prefer the active cell if present
  const srcEl = activeCell && String(activeCell.dataset.state) === String(stateId) ? activeCell : document.querySelector(`.cell[data-state="${stateId}"]`);
  if (!srcEl) { window.location.href = targetUrl; return; }

  const srcRect = srcEl.getBoundingClientRect();
  
  const svgNS = "http://www.w3.org/2000/svg";

  // create overlay container
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh',
    pointerEvents: 'none', zIndex: 9999, overflow: 'visible'
  });
  document.body.appendChild(overlay);
  console.log('Overlay created');
  // create a small svg positioned at the element's screen location
  const clipSvg = document.createElementNS(svgNS, 'svg');
  clipSvg.setAttribute('width', Math.max(1, srcRect.width));
  clipSvg.setAttribute('height', Math.max(1, srcRect.height));
  clipSvg.style.position = 'absolute';
  clipSvg.style.color = 'red';
  clipSvg.style.left = `${srcRect.left}px`;
  clipSvg.style.top = `${srcRect.top}px`;
  clipSvg.style.transformOrigin = '0 0';
  
  overlay.appendChild(clipSvg);

  // clone the clicked node into the small svg
  const cloned = srcEl.cloneNode(true);
  
  const g = document.createElementNS(svgNS, 'g');
  g.appendChild(cloned);
  clipSvg.appendChild(g);

  // compute target: center inside left half
  const leftPane = { left: 0, top: 0, width: window.innerWidth * 0.5, height: window.innerHeight };
  const targetCenterX = leftPane.left + leftPane.width / 2;
  const targetCenterY = leftPane.top + leftPane.height / 2;

  const srcCenterX = srcRect.left + srcRect.width / 2;
  const srcCenterY = srcRect.top + srcRect.height / 2;

  const desiredFraction = 0.6;
  const scale = ((leftPane.width * desiredFraction) / Math.max(8, srcRect.width));

  const deltaX = targetCenterX - srcCenterX;
  const deltaY = targetCenterY - srcCenterY;

  // Ensure cloned shapes carry inline fill values so animations target concrete colors
  const applyInlineFills = (original, copy) => {
    const originals = [original, ...Array.from(original.querySelectorAll('*'))];
    const copies = [copy, ...Array.from(copy.querySelectorAll('*'))];
    for (let i = 0; i < originals.length && i < copies.length; i++) {
      try {
        const comp = window.getComputedStyle(originals[i]);
        const f = comp && comp.fill && comp.fill !== 'none' ? comp.fill : originals[i].getAttribute('fill');
        if (f) copies[i].setAttribute('fill', f);
      } catch (err) {
        const f = originals[i].getAttribute && originals[i].getAttribute('fill');
        if (f) copies[i].setAttribute('fill', f);
      }
    }
  };

  applyInlineFills(srcEl, cloned);

  const initial = { transform: 'translate(0px, 0px) scale(1)' };
  const final = { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scale})` };
  const timing = { duration: 700, easing: 'cubic-bezier(.2,0,.0,1)', fill: 'forwards' };
  const anim = g.animate([initial, final], timing);

  // subtle fade of the page to make transition feel smoother
  const fade = document.documentElement.animate([{ opacity: 1 }, { opacity: 0.6 }], { duration: timing.duration, fill: 'forwards' });

  // Color animation: cycle fills randomly during the transform
  const randomHsl = () => {
    const h = Math.floor(Math.random() * 360);
    const s = 45 + Math.floor(Math.random() * 30);
    const l = 40 + Math.floor(Math.random() * 25);
    return `hsl(${h} ${s}% ${l}%)`;
  };

  const shapeSelector = 'path, rect, circle, ellipse, polygon, polyline';
  const fillElements = Array.from(g.querySelectorAll(shapeSelector));
  // include cloned itself if it's a shape element
  if (cloned && shapeSelector.includes(cloned.tagName)) {
    if (!fillElements.includes(cloned)) fillElements.unshift(cloned);
  }

  const fillAnims = [];
  for (const el of fillElements) {
    const start = el.getAttribute('fill') || window.getComputedStyle(el).fill || 'currentColor';
    const keyframes = [ { fill: start } ];
    const midCount = 3;
    for (let i = 0; i < midCount; i++) keyframes.push({ fill: randomHsl() });
    keyframes.push({ fill: start });
    const delay = Math.random() * 120; // small stagger
    const fa = el.animate(keyframes, { duration: timing.duration, easing: 'linear', fill: 'forwards', delay });
    fillAnims.push(fa);
  }

  anim.onfinish = () => {
    // make sure animations finish then navigate
    // overlay.remove();
    // // fade.cancel();
    // window.location.href = targetUrl;
  };
}

// Show a temporary overlay rectangle matching the clicked element's boundingClientRect.
// This is a debugging/UX step before implementing the full animation.
function showBoundingRect(stateId) {
  const nodes = Array.from(document.querySelectorAll(`.cell[data-state="${stateId}"]`));
  if (!nodes.length) return;

  // compute union of client rects
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.left < minX) minX = r.left;
    if (r.top < minY) minY = r.top;
    if (r.right > maxX) maxX = r.right;
    if (r.bottom > maxY) maxY = r.bottom;
  });
  const rect = { left: minX, top: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };

  // compute union bbox in SVG user coordinates using getBBox()
  let minUX = Infinity, minUY = Infinity, maxUX = -Infinity, maxUY = -Infinity;
  nodes.forEach((n) => {
    try {
      const b = n.getBBox();
      if (b.x < minUX) minUX = b.x;
      if (b.y < minUY) minUY = b.y;
      if (b.x + b.width > maxUX) maxUX = b.x + b.width;
      if (b.y + b.height > maxUY) maxUY = b.y + b.height;
    } catch (err) {
      // ignore elements without bbox
    }
  });
  if (!Number.isFinite(minUX)) {
    // fallback: show simple div overlay
    const fallback = document.createElement('div');
    Object.assign(fallback.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, background: 'rgba(255,0,0,0.08)', pointerEvents: 'none', zIndex: 9999 });
    document.body.appendChild(fallback);
    setTimeout(() => fallback.remove(), 800);
    return;
  }

  const userWidth = maxUX - minUX;
  const userHeight = maxUY - minUY;

  // create overlay SVG positioned at the union client rect, with viewBox in user coords
  const overlaySvg = document.createElementNS(svgNS, 'svg');
  overlaySvg.setAttribute('viewBox', `${minUX} ${minUY} ${userWidth} ${userHeight}`);
  overlaySvg.setAttribute('width', `${Math.max(1, rect.width)}`);
  overlaySvg.setAttribute('height', `${Math.max(1, rect.height)}`);
  overlaySvg.style.position = 'fixed';
  overlaySvg.style.left = `${rect.left}px`;
  overlaySvg.style.top = `${rect.top}px`;
  overlaySvg.style.overflow = 'visible';
  overlaySvg.style.zIndex = 9999;
  overlaySvg.style.pointerEvents = 'none';
  overlaySvg.style.transition = 'opacity 200ms linear';
  document.body.appendChild(overlaySvg);

  // add label
  const label = document.createElement('div');
  label.textContent = `state: ${stateId}`;
  Object.assign(label.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${Math.max(0, rect.top - 28)}px`,
    padding: '4px 8px', background: 'rgba(17,24,39,0.9)', color: 'white',
    fontSize: '12px', borderRadius: '4px', zIndex: 10000, pointerEvents: 'none'
  });
  document.body.appendChild(label);

  // clone all the state nodes into the overlay. We'll inline fills so animation targets concrete colors.
  const group = document.createElementNS(svgNS, 'g');
  nodes.forEach((n) => {
    const copy = n.cloneNode(true);
    // inline computed fill and stroke
    try {
      const cs = window.getComputedStyle(n);
      if (cs.fill && cs.fill !== 'none') copy.setAttribute('fill', cs.fill);
      if (cs.stroke && cs.stroke !== 'none') copy.setAttribute('stroke', cs.stroke);
    } catch (err) {
      const f = n.getAttribute && n.getAttribute('fill');
      if (f) copy.setAttribute('fill', f);
    }
    group.appendChild(copy);
  });
  overlaySvg.appendChild(group);

  // animate the overlay SVG element's pixel rect to the destination (left half)
  requestAnimationFrame(() => { overlaySvg.style.opacity = '1'; });
  const leftPane = { left: 0, top: 0, width: window.innerWidth * 0.5, height: window.innerHeight };
  const desiredFraction = 0.6;
  const targetWidth = Math.max(8, leftPane.width * desiredFraction);
  const targetHeight = (userHeight / userWidth) * targetWidth;
  const targetLeft = leftPane.left + (leftPane.width - targetWidth) / 2;
  const targetTop = leftPane.top + (leftPane.height - targetHeight) / 2;

  const duration = 300;
  const anim = overlaySvg.animate([
    { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, opacity: 1 },
    { left: `${targetLeft}px`, top: `${targetTop}px`, width: `${targetWidth}px`, height: `${targetHeight}px`, opacity: 1 }
  ], { duration, easing: 'cubic-bezier(.2,0,.0,1)', fill: 'forwards' });

  const labelAnim = label.animate([
    { left: `${rect.left}px`, top: `${Math.max(0, rect.top - 28)}px`, opacity: 1 },
    { left: `${targetLeft}px`, top: `${Math.max(0, targetTop - 28)}px`, opacity: 1 }
  ], { duration, easing: 'cubic-bezier(.2,0,.0,1)', fill: 'forwards' });

  anim.onfinish = () => {
    setTimeout(() => {
      const fadeOut = overlaySvg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      const labelFade = label.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      labelFade.onfinish = () => {
        try {
          const payload = {
            svg: overlaySvg.outerHTML,
            meta: {
              startRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
              targetRect: { left: targetLeft, top: targetTop, width: targetWidth, height: targetHeight },
              viewBox: overlaySvg.getAttribute('viewBox'),
              stateId: String(stateId)
            }
          };
          sessionStorage.setItem('sharedOverlay', payload.svg);
          sessionStorage.setItem('sharedOverlayMeta', JSON.stringify(payload.meta));
        } catch (err) {
          console.warn('Could not persist overlay for transition', err);
        }
        // navigate to state view now that animation finished
        window.location.href = `state.html?state=${encodeURIComponent(String(stateId))}`;
      };
    }, 220);
  };
}
