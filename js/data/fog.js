/**
 * @module data/fog
 * Fog of war state: revealed states, questioned states, neighbor graph, exploration trails.
 */

// Fog of war state management

// Track which states are revealed (initially only state 1)
export const revealedStates = new Set(["1"]);

// Track which states have shown their question (to avoid re-asking)
export const questionedStates = new Set();

// Exploration trail data
export const explorationTrails = []; // [{ from: string, to: string }]
export const explorationOrder = ["1"]; // Discovery sequence (state "1" is the origin)

export const addTrail = (fromStateId, toStateId) => {
  explorationTrails.push({ from: String(fromStateId), to: String(toStateId) });
  explorationOrder.push(String(toStateId));
};

// State neighbor map (built from GeoJSON)
let stateNeighborMap = new Map();

export const isStateRevealed = (stateId) => {
  return revealedStates.has(String(stateId));
};

export const hasBeenQuestioned = (stateId) => {
  return questionedStates.has(String(stateId));
};

export const markAsQuestioned = (stateId) => {
  questionedStates.add(String(stateId));
};

export const revealState = (stateId) => {
  revealedStates.add(String(stateId));
};

export const getNeighbors = (stateId) => {
  return stateNeighborMap.get(String(stateId)) || [];
};

/**
 * Build state-to-state neighbor map from GeoJSON
 * Uses the pre-computed `neighbors` array in each feature's properties
 */
export const buildStateNeighborMap = (geojsonData) => {
  if (!geojsonData || !geojsonData.features) return;

  const map = new Map();
  const cellIdToStateId = new Map();

  // First pass: build cellId -> stateId lookup
  geojsonData.features.forEach((feature) => {
    const cellId = feature.properties?.id;
    const stateId = String(feature.properties?.state ?? "0");
    if (cellId !== undefined) {
      cellIdToStateId.set(cellId, stateId);
    }
  });

  // Second pass: aggregate state-level neighbors
  geojsonData.features.forEach((feature) => {
    const stateId = String(feature.properties?.state ?? "0");
    if (stateId === "0") return; // Skip ocean

    const neighbors = feature.properties?.neighbors || [];

    neighbors.forEach((neighborCellId) => {
      const neighborStateId = cellIdToStateId.get(neighborCellId);
      if (!neighborStateId || neighborStateId === "0" || neighborStateId === stateId) {
        return; // Skip ocean, missing, and self
      }

      // Add to neighbor set
      if (!map.has(stateId)) {
        map.set(stateId, new Set());
      }
      map.get(stateId).add(neighborStateId);
    });
  });

  // Convert Sets to Arrays
  map.forEach((neighbors, stateId) => {
    map.set(stateId, Array.from(neighbors));
  });

  stateNeighborMap = map;
};
