/**
 * @module map/outline
 * Computes state outlines by extracting exterior edges from hex cells.
 * An exterior edge belongs to only one cell within a state (count === 1).
 * Interior edges are shared by two cells (count === 2) and are filtered out.
 */

import { ringToPath } from "./geometry.js";

const edgeKey = (a, b) => {
  const ka = `${a[0]},${a[1]}`;
  const kb = `${b[0]},${b[1]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

const parseVertex = (str) => str.split(",").map(Number);

const chainEdges = (edges) => {
  if (!edges.length) return [];

  // Build adjacency: vertex -> [connected vertices]
  const adjacency = new Map();
  edges.forEach(([a, b]) => {
    const ka = `${a[0]},${a[1]}`;
    const kb = `${b[0]},${b[1]}`;
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka).push(kb);
    adjacency.get(kb).push(ka);
  });

  const rings = [];
  const visited = new Set();

  for (const [startKey] of adjacency) {
    if (visited.has(startKey)) continue;

    const ring = [];
    let current = startKey;
    let prev = null;

    while (true) {
      if (visited.has(current)) {
        // Completed a ring
        break;
      }

      visited.add(current);
      ring.push(parseVertex(current));

      const neighbors = adjacency.get(current) || [];
      // Pick next vertex that isn't where we came from
      let next = null;
      for (const n of neighbors) {
        if (n !== prev && !visited.has(n)) {
          next = n;
          break;
        }
      }

      if (!next) {
        // Check if we can close the loop
        for (const n of neighbors) {
          if (n === ring[0].join(",")) {
            break;
          }
        }
        break;
      }

      prev = current;
      current = next;
    }

    if (ring.length >= 3) {
      rings.push(ring);
    }
  }

  return rings;
};

/**
 * Compute state outlines from per-state edge counts.
 * @param {Map} stateEdgeCounts - Map of stateId -> Map<edgeKey, {count, coords}>
 * @param {Map} stateBounds - Map of stateId -> {minX, minY, maxX, maxY}
 * @returns {Map} stateId -> {pathData: string, rings: number[][][], bounds: object}
 */
export const computeStateOutlines = (stateEdgeCounts, stateBounds) => {
  const outlines = new Map();

  for (const [stateId, edgeCounts] of stateEdgeCounts) {
    if (stateId === "0") continue; // Skip ocean

    // Filter to exterior edges (count === 1 means boundary)
    const exteriorEdges = [];
    for (const [, data] of edgeCounts) {
      if (data.count === 1) {
        exteriorEdges.push(data.coords);
      }
    }

    if (!exteriorEdges.length) continue;

    // Chain edges into rings
    const rings = chainEdges(exteriorEdges);

    if (!rings.length) continue;

    // Convert to path data
    const pathData = rings.map(ringToPath).join(" ");

    // Get bounds
    const bounds = stateBounds.get(stateId) || { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    outlines.set(stateId, {
      pathData,
      rings,
      bounds: { ...bounds },
    });
  }

  return outlines;
};

/**
 * Build per-state edge counts from GeoJSON features.
 * Tracks how many times each edge appears within each state.
 */
export const buildStateEdgeCounts = (geojson) => {
  const stateEdgeCounts = new Map(); // stateId -> Map<edgeKey, {count, coords}>

  const recordEdge = (a, b, stateId) => {
    if (!stateEdgeCounts.has(stateId)) {
      stateEdgeCounts.set(stateId, new Map());
    }
    const stateMap = stateEdgeCounts.get(stateId);
    const key = edgeKey(a, b);

    if (stateMap.has(key)) {
      stateMap.get(key).count += 1;
    } else {
      stateMap.set(key, { count: 1, coords: [a, b] });
    }
  };

  geojson.features.forEach((feature) => {
    const geometry = feature.geometry;
    const properties = feature.properties || {};
    const stateId = String(properties.state ?? "0");

    if (!geometry) return;

    const processRing = (ring) => {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        recordEdge(a, b, stateId);
      }
    };

    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach(processRing);
    }
    if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => {
        polygon.forEach(processRing);
      });
    }
  });

  return stateEdgeCounts;
};
