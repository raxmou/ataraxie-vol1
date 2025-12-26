const app = document.getElementById("app");
const svg = document.getElementById("map-svg");
const dataUrl = app?.dataset.geojson;

const svgNS = "http://www.w3.org/2000/svg";
const stateColors = new Map();
const oceanColor = "#d7dee8";
const goldenAngle = 137.508;

let activeCell = null;

// Delegated click handler so clicks on `.cell` are always caught and logged.
svg.addEventListener("click", (e) => {
  let node = e.target;
  while (node && node !== svg) {
    if (node.classList && node.classList.contains("cell")) {
      
      setActiveCell(node);
      return;
    }
    node = node.parentNode;
  }
});

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
    console.log(node);
    while (node && node !== svg) {
      if (node.classList && node.classList.contains("cell")) {
          const state = node.dataset.state;
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
    buildMap(geojson);
  } catch (error) {
    console.error(error);
  }
};

init();
