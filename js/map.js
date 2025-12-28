import { forEachCoordinate, geometryToPath } from "./geometry.js";

const svgNS = "http://www.w3.org/2000/svg";
const goldenAngle = 137.508;

export const createStateColor = (options = {}) => {
  const oceanColor = options.oceanColor || "#1b2212";
  const palette = options.palette || [
    "#a0764a",
    "#b08b5a",
    "#8c6b3e",
    "#c2a06b",
    "#a05a3c",
    "#7b4b2a",
    "#b58d6a",
    "#9b7a4a",
    "#7f8a5b",
    "#6f5a3f",
  ];
  const stateColors = new Map();
  return (stateId, isOcean) => {
    if (isOcean) return oceanColor;
    if (stateColors.has(stateId)) return stateColors.get(stateId);
    const index = Number(stateId) % palette.length;
    const color = palette[Math.abs(index)];
    stateColors.set(stateId, color);
    return color;
  };
};

export const createMap = ({ svg, geojson, colorForState }) => {
  if (!svg || !geojson) {
    return {
      fullViewBox: null,
      getStateBounds: () => null,
      setActiveState: () => {},
      focusState: () => {},
      resetFocus: () => {},
    };
  }

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const baseGroup = document.createElementNS(svgNS, "g");
  baseGroup.setAttribute("id", "map-base");
  const cellGroup = document.createElementNS(svgNS, "g");
  cellGroup.setAttribute("id", "map-cells");
  const borderGroup = document.createElementNS(svgNS, "g");
  borderGroup.setAttribute("id", "map-borders");
  const focusGroup = document.createElementNS(svgNS, "g");
  focusGroup.setAttribute("id", "map-focus");
  const snapshotGroup = document.createElementNS(svgNS, "g");
  snapshotGroup.setAttribute("id", "map-snapshot");
  snapshotGroup.setAttribute("visibility", "hidden");
  baseGroup.appendChild(cellGroup);
  baseGroup.appendChild(borderGroup);
  svg.appendChild(baseGroup);
  svg.appendChild(focusGroup);
  svg.appendChild(snapshotGroup);

  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const stateBounds = new Map();
  const stateCells = new Map();
  const snapshotCache = new Map();
  const maxSnapshotCacheSize = 24;
  let activeNodes = [];
  let focusedNodes = [];
  let focusedStateId = null;
  let snapshotNode = null;

  const updateBounds = (x, y) => {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  };

  const updateStateBounds = (stateId, x, y) => {
    let state = stateBounds.get(stateId);
    if (!state) {
      state = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      stateBounds.set(stateId, state);
    }
    if (x < state.minX) state.minX = x;
    if (y < state.minY) state.minY = y;
    if (x > state.maxX) state.maxX = x;
    if (y > state.maxY) state.maxY = y;
  };

  const edgeMap = new Map();
  const edgeKey = (a, b) => {
    const ka = `${a[0]},${a[1]}`;
    const kb = `${b[0]},${b[1]}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };

  const recordEdges = (ring, stateId) => {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const key = edgeKey(a, b);
      const existing = edgeMap.get(key);
      if (existing) {
        existing.states.add(stateId);
      } else {
        edgeMap.set(key, { states: new Set([stateId]), coords: [a, b] });
      }
    }
  };

  const fragment = document.createDocumentFragment();

  geojson.features.forEach((feature) => {
    const geometry = feature.geometry;
    const properties = feature.properties || {};
    const stateId = String(properties.state ?? "0");
    const isOcean = Number(stateId) === 0;

    forEachCoordinate(geometry, (x, y) => {
      updateBounds(x, y);
      updateStateBounds(stateId, x, y);
    });

    if (geometry) {
      if (geometry.type === "Polygon") {
        geometry.coordinates.forEach((ring) => recordEdges(ring, stateId));
      }
      if (geometry.type === "MultiPolygon") {
        geometry.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => recordEdges(ring, stateId));
        });
      }
    }

    const pathData = geometryToPath(geometry);
    if (!pathData) return;

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);
    const fill = colorForState(stateId, isOcean);
    path.setAttribute("fill", fill);
    path.setAttribute("stroke", fill);
    path.style.color = fill;
    path.classList.add("cell");
    path.dataset.state = stateId;
    if (isOcean) path.classList.add("is-ocean");

    if (!stateCells.has(stateId)) stateCells.set(stateId, []);
    stateCells.get(stateId).push(path);

    fragment.appendChild(path);

  });

  cellGroup.appendChild(fragment);

  const stateBorderMap = new Map();
  const borderFragment = document.createDocumentFragment();
  for (const entry of edgeMap.values()) {
    const statesArray = Array.from(entry.states).map((s) => String(s));
    if (statesArray.length > 1) {
      const [a, b] = entry.coords;
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`);
      path.classList.add("state-border");
      path.dataset.states = statesArray.join(",");
      statesArray.forEach((state) => {
        if (!stateBorderMap.has(state)) stateBorderMap.set(state, []);
        stateBorderMap.get(state).push(path);
      });
      borderFragment.appendChild(path);
    }
  }
  borderGroup.appendChild(borderFragment);

  const highlightStateBorder = (stateId, isHover) => {
    if (!stateId || !stateBorderMap.has(stateId)) return;
    stateBorderMap.get(stateId).forEach((path) => {
      path.classList.toggle("is-hover", isHover);
    });
  };

  const clearHover = () => {
    stateBorderMap.forEach((paths) => {
      paths.forEach((path) => path.classList.remove("is-hover"));
    });
  };

  const handleHover = (event, isHover) => {
    if (svg.classList.contains("is-collapsed")) return;
    let node = event.target;
    while (node && node !== svg) {
      if (node.classList && node.classList.contains("cell")) {
        const stateId = node.dataset.state;
        if (stateId === "0") return;
        highlightStateBorder(stateId, isHover);
        return;
      }
      node = node.parentNode;
    }
  };

  svg.addEventListener("pointerover", (event) => handleHover(event, true));
  svg.addEventListener("pointerout", (event) => handleHover(event, false));

  const setActiveState = (stateId) => {
    activeNodes.forEach((cell) => cell.classList.remove("is-active"));
    activeNodes = [];
    if (!stateId) return;
    const nodes = stateCells.get(String(stateId)) || [];
    nodes.forEach((node) => node.classList.add("is-active"));
    activeNodes = nodes;
  };

  const clearSnapshot = () => {
    if (snapshotNode && snapshotNode.parentNode) {
      snapshotNode.parentNode.removeChild(snapshotNode);
    }
    snapshotNode = null;
    snapshotGroup.setAttribute("visibility", "hidden");
    focusGroup.setAttribute("visibility", "visible");
  };

  const buildSnapshotForState = (stateId) => {
    const boundsForState = stateBounds.get(String(stateId));
    if (!boundsForState || !Number.isFinite(boundsForState.minX)) return null;
    const width = Math.max(1, boundsForState.maxX - boundsForState.minX);
    const height = Math.max(1, boundsForState.maxY - boundsForState.minY);
    const wrapper = document.createElementNS(svgNS, "svg");
    wrapper.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    wrapper.setAttribute(
      "viewBox",
      `${boundsForState.minX} ${boundsForState.minY} ${width} ${height}`
    );
    wrapper.setAttribute("width", `${width}`);
    wrapper.setAttribute("height", `${height}`);
    const group = document.createElementNS(svgNS, "g");
    const nodes = stateCells.get(String(stateId)) || [];
    nodes.forEach((node) => group.appendChild(node.cloneNode(true)));
    wrapper.appendChild(group);
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(wrapper);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    return {
      url,
      x: boundsForState.minX,
      y: boundsForState.minY,
      width,
      height,
    };
  };

  const evictOldestSnapshot = () => {
    const first = snapshotCache.entries().next();
    if (first.done) return;
    const [key, snapshot] = first.value;
    if (snapshot?.url) URL.revokeObjectURL(snapshot.url);
    snapshotCache.delete(key);
  };

  const touchSnapshot = (key, snapshot) => {
    if (!snapshot) return;
    snapshotCache.delete(key);
    snapshotCache.set(key, snapshot);
  };

  const getSnapshotForState = (stateId) => {
    const key = String(stateId);
    if (snapshotCache.has(key)) {
      const snapshot = snapshotCache.get(key);
      touchSnapshot(key, snapshot);
      return snapshot;
    }
    const snapshot = buildSnapshotForState(key);
    if (snapshot) {
      snapshotCache.set(key, snapshot);
      while (snapshotCache.size > maxSnapshotCacheSize) {
        evictOldestSnapshot();
      }
    }
    return snapshot;
  };

  const createSnapshot = (stateId) => {
    clearSnapshot();
    const snapshot = getSnapshotForState(stateId);
    if (!snapshot) return false;
    const image = document.createElementNS(svgNS, "image");
    image.setAttribute("href", snapshot.url);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", snapshot.url);
    image.setAttribute("x", `${snapshot.x}`);
    image.setAttribute("y", `${snapshot.y}`);
    image.setAttribute("width", `${snapshot.width}`);
    image.setAttribute("height", `${snapshot.height}`);
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    snapshotGroup.appendChild(image);
    snapshotNode = image;
    focusGroup.setAttribute("visibility", "hidden");
    snapshotGroup.setAttribute("visibility", "visible");
    return true;
  };

  const preloadSnapshots = async (options = {}) => {
    const stateIds = Array.from(stateCells.keys()).filter((id) => id !== "0");
    const total = stateIds.length;
    let completed = 0;
    for (const stateId of stateIds) {
      if (!snapshotCache.has(stateId)) {
        const snapshot = buildSnapshotForState(stateId);
        if (snapshot) {
          snapshotCache.set(stateId, snapshot);
          while (snapshotCache.size > maxSnapshotCacheSize) {
            evictOldestSnapshot();
          }
        }
      } else {
        touchSnapshot(stateId, snapshotCache.get(stateId));
      }
      completed += 1;
      if (options.onProgress) options.onProgress(completed, total);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return snapshotCache;
  };

  const resetFocus = () => {
    clearSnapshot();
    if (!focusedNodes.length) {
      focusedStateId = null;
      return;
    }
    focusedNodes.forEach(({ node, nextSibling }) => {
      if (nextSibling && nextSibling.parentNode === cellGroup) {
        cellGroup.insertBefore(node, nextSibling);
      } else {
        cellGroup.appendChild(node);
      }
    });
    focusedNodes = [];
    focusedStateId = null;
  };

  const focusState = (stateId) => {
    const normalized = String(stateId);
    if (focusedStateId === normalized) return;
    resetFocus();
    const nodes = stateCells.get(normalized) || [];
    focusedNodes = nodes.map((node) => ({ node, nextSibling: node.nextSibling }));
    nodes.forEach((node) => focusGroup.appendChild(node));
    focusedStateId = normalized;
  };

  const getStateBounds = (stateId) => {
    const boundsForState = stateBounds.get(String(stateId));
    if (!boundsForState || !Number.isFinite(boundsForState.minX)) return null;
    return {
      minX: boundsForState.minX,
      minY: boundsForState.minY,
      maxX: boundsForState.maxX,
      maxY: boundsForState.maxY,
    };
  };

  let fullViewBox = null;
  if (Number.isFinite(bounds.minX)) {
    const width = bounds.maxX - bounds.minX || 1;
    const height = bounds.maxY - bounds.minY || 1;
    fullViewBox = { x: bounds.minX, y: bounds.minY, width, height };
  }
  return {
    fullViewBox,
    getStateBounds,
    setActiveState,
    focusState,
    resetFocus,
    createSnapshot,
    clearSnapshot,
    clearHover,
    preloadSnapshots,
    getFocusLayer: () => focusGroup,
    getSnapshotLayer: () => snapshotGroup,
  };
};
