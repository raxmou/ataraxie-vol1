import { loadGeoJSON, loadSigils, loadTracks } from "./data.js";
import { createMap, createStateColor } from "./map.js";
import { createViewBoxAnimator, createTransformAnimator } from "./viewbox.js";

const svgNS = "http://www.w3.org/2000/svg";
const sigilLayerId = "map-sigils";

const app = document.getElementById("app");
const svg = document.getElementById("map-svg");
const mapPane = document.querySelector("#app .map-pane");
const infoPane = document.getElementById("info-pane");
const infoContent = document.getElementById("state-content");
const backButton = document.getElementById("state-back");
const loadingScreen = document.getElementById("loading-screen");
const loadingProgress = document.getElementById("loading-progress");
const stateCanvas = document.getElementById("state-3d-canvas");
const dataUrl = app?.dataset.geojson;
const sigilsUrl = app?.dataset.sigils;
const tracksUrl = app?.dataset.tracks;
const shouldPreloadSnapshots = app?.dataset.preloadSnapshots === "true";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let geojsonData = null;
let activeStateId = null;
let fullViewBox = null;
let mapApi = null;
let stateCounts = new Map();
let animationToken = 0;
let transformAnimator = null;
let lastSelectedViewBox = null;
let trackByState = new Map();
let trackById = new Map();
let activeAudio = null;
let threeApi = null;
let threeInitPromise = null;
let colorForState = null;
let sigilsByState = new Map();
let sigilLayer = null;
let focusSigilLayer = null;
let audioContext = null;
let audioAnalyser = null;
let audioData = null;
let audioAnimationFrame = null;
let audioSource = null;
let audioElement = null;
let audioTime = 0;
let isThreeDragging = false;
let activePointerId = null;
let lastPointerX = 0;
let lastPointerY = 0;

const formatTime = (value) => {
  if (!Number.isFinite(value)) return "--:--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getSigilBaseSize = () => {
  const baseBox = mapApi?.fullViewBox;
  return baseBox ? clamp(Math.min(baseBox.width, baseBox.height) * 0.04, 12, 28) : 18;
};

const resolveSigilMap = (payload) => {
  if (!payload || typeof payload !== "object") return new Map();
  const entries =
    payload.states && typeof payload.states === "object" ? payload.states : payload;
  return new Map(
    Object.entries(entries || {}).map(([stateId, href]) => [String(stateId), href])
  );
};

const clearSigilLayer = () => {
  if (!sigilLayer) return;
  sigilLayer.remove();
  sigilLayer = null;
};

const clearFocusSigilLayer = () => {
  if (!focusSigilLayer) return;
  focusSigilLayer.remove();
  focusSigilLayer = null;
};

const renderSigilLayer = () => {
  clearSigilLayer();
  if (!svg || !mapApi || !sigilsByState.size) return;
  const baseSize = getSigilBaseSize();
  const layer = document.createElementNS(svgNS, "g");
  layer.setAttribute("id", sigilLayerId);
  layer.classList.add("sigil-layer", "sigil-layer--map");
  layer.setAttribute("aria-hidden", "true");

  sigilsByState.forEach((href, stateId) => {
    if (!href || stateId === "0") return;
    const bounds = mapApi.getStateBounds(stateId);
    if (!bounds) return;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const size = baseSize;
    const centerX = bounds.minX + width / 2;
    const centerY = bounds.minY + height / 2;
    const image = document.createElementNS(svgNS, "image");
    const resolvedHref = encodeURI(href);
    image.setAttribute("href", resolvedHref);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", resolvedHref);
    image.setAttribute("x", (centerX - size / 2).toFixed(3));
    image.setAttribute("y", (centerY - size / 2).toFixed(3));
    image.setAttribute("width", size.toFixed(3));
    image.setAttribute("height", size.toFixed(3));
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    image.classList.add("sigil");
    image.dataset.state = stateId;
    layer.appendChild(image);
  });

  const focusLayer = mapApi.getFocusLayer?.();
  if (focusLayer?.parentNode === svg) {
    svg.insertBefore(layer, focusLayer);
  } else {
    svg.appendChild(layer);
  }
  sigilLayer = layer;
};

const renderFocusSigil = (stateId) => {
  clearFocusSigilLayer();
  if (!svg || !mapApi || !sigilsByState.size || !stateId) return;
  const href = sigilsByState.get(String(stateId));
  if (!href) return;
  const bounds = mapApi.getStateBounds(stateId);
  if (!bounds) return;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const size = getSigilBaseSize();
  const centerX = bounds.minX + width / 2;
  const centerY = bounds.minY + height / 2;
  const layer = document.createElementNS(svgNS, "g");
  layer.classList.add("sigil-layer", "sigil-layer--focus");
  layer.setAttribute("aria-hidden", "true");
  const image = document.createElementNS(svgNS, "image");
  const resolvedHref = encodeURI(href);
  image.setAttribute("href", resolvedHref);
  image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", resolvedHref);
  image.setAttribute("x", (centerX - size / 2).toFixed(3));
  image.setAttribute("y", (centerY - size / 2).toFixed(3));
  image.setAttribute("width", size.toFixed(3));
  image.setAttribute("height", size.toFixed(3));
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  image.classList.add("sigil");
  image.dataset.state = String(stateId);
  layer.appendChild(image);
  const focusLayer = mapApi.getFocusLayer?.();
  if (focusLayer) {
    focusLayer.appendChild(layer);
  } else {
    svg.appendChild(layer);
  }
  focusSigilLayer = layer;
};

const resetAudioVisuals = () => {
  if (!svg) return;
  svg.style.setProperty("--audio-stroke", "0.6px");
  svg.style.setProperty("--audio-opacity", "0.85");
  svg.style.setProperty("--audio-glow", "0px");
};

const resetMeshPulse = () => {
  if (!threeApi?.mesh) return;
  const {
    edgeMaterial,
    edgeBaseColor,
    edgeBasePositions,
    edgePositionAttr,
    terrainData,
    terrainTopZ,
    terrainBaseHeight,
    terrainHeights,
  } = threeApi.mesh.userData || {};
  if (edgeMaterial && edgeBaseColor) {
    edgeMaterial.color.copy(edgeBaseColor);
    edgeMaterial.opacity = 0.55;
  }
  if (edgeBasePositions && edgePositionAttr) {
    edgePositionAttr.array.set(edgeBasePositions);
    edgePositionAttr.needsUpdate = true;
  }
  if (Array.isArray(terrainData) && terrainBaseHeight !== null && terrainTopZ !== null) {
    terrainData.forEach((cell) => {
      (cell.meshes || []).forEach((mesh) => {
        mesh.position.z = terrainTopZ;
        mesh.scale.z = terrainBaseHeight;
      });
    });
    if (terrainHeights) terrainHeights.fill(terrainBaseHeight);
  }
};

const stopAudioReactive = () => {
  if (audioAnimationFrame) cancelAnimationFrame(audioAnimationFrame);
  audioAnimationFrame = null;
  resetAudioVisuals();
  resetMeshPulse();
};

const connectAudioAnalyser = (audio) => {
  if (!audio) return;
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    audioContext = new AudioContextCtor();
  }
  if (!audioAnalyser) {
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioData = new Uint8Array(audioAnalyser.frequencyBinCount);
  }
  if (audioElement !== audio) {
    if (audioSource) audioSource.disconnect();
    if (audio._audioSource) {
      audioSource = audio._audioSource;
    } else {
      audioSource = audioContext.createMediaElementSource(audio);
      audio._audioSource = audioSource;
    }
    audioSource.connect(audioAnalyser);
    audioAnalyser.connect(audioContext.destination);
    audioElement = audio;
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
};

const startAudioReactive = (audio) => {
  if (!audio || !svg) return;
  connectAudioAnalyser(audio);
  if (!audioAnalyser || !audioData) return;
  audioTime = 0;
  const tick = () => {
    if (!audioAnalyser || !audioData) return;
    audioAnalyser.getByteFrequencyData(audioData);
    audioTime += 0.016;
    const totalBins = audioData.length;
    const lowEnd = Math.max(1, Math.floor(totalBins * 0.2));
    const highStart = Math.floor(totalBins * 0.7);
    let lowSum = 0;
    let highSum = 0;
    for (let i = 0; i < lowEnd; i += 1) lowSum += audioData[i];
    for (let i = highStart; i < totalBins; i += 1) highSum += audioData[i];
    const low = lowSum / (lowEnd * 255);
    const high = highSum / ((totalBins - highStart) * 255);
    const intensity = Math.min(1, (low + high) / 2);
    const stroke = 0.6 + intensity * 1.8;
    const glow = intensity * 10;
    const opacity = 0.45 + intensity * 0.5;
    const is3d = mapPane?.classList.contains("is-3d");
    if (is3d && threeApi?.mesh) {
      const {
        terrainData,
        terrainTopZ,
        terrainBaseHeight,
        terrainMaxHeight,
        terrainNeighbors,
        terrainHeights,
      } = threeApi.mesh.userData || {};
      if (Array.isArray(terrainData) && terrainBaseHeight !== null && terrainMaxHeight !== null) {
        const maxBin = audioData.length - 1;
        const rawHeights = new Float32Array(terrainData.length);
        const smoothFactor = 0.25;
        terrainData.forEach((cell, index) => {
          const bin = Math.max(0, Math.min(maxBin, Math.floor(cell.xNorm * maxBin)));
          const amp = audioData[bin] / 255;
          const noise = 0.6 + 0.4 * Math.sin(cell.x * 1.1 + cell.y * 0.9 + audioTime * 0.6);
          rawHeights[index] = terrainBaseHeight + amp * terrainMaxHeight * cell.weight * noise;
        });
        terrainData.forEach((cell, index) => {
          let neighborSum = 0;
          let neighborCount = 0;
          const neighbors = terrainNeighbors ? terrainNeighbors[index] : null;
          if (neighbors && neighbors.length) {
            neighbors.forEach((neighborIndex) => {
              neighborSum += rawHeights[neighborIndex];
              neighborCount += 1;
            });
          }
          const neighborAvg = neighborCount ? neighborSum / neighborCount : rawHeights[index];
          const smoothed = rawHeights[index] * 0.35 + neighborAvg * 0.65;
          const current = terrainHeights ? terrainHeights[index] : smoothed;
          const blended = current + (smoothed - current) * smoothFactor;
          if (terrainHeights) terrainHeights[index] = blended;
          (cell.meshes || []).forEach((mesh) => {
            mesh.position.z = terrainTopZ;
            mesh.scale.z = blended;
          });
        });
      }
    } else if (svg) {
      svg.style.setProperty("--audio-stroke", `${stroke.toFixed(3)}px`);
      svg.style.setProperty("--audio-opacity", opacity.toFixed(3));
      svg.style.setProperty("--audio-glow", `${glow.toFixed(2)}px`);
    }
    audioAnimationFrame = requestAnimationFrame(tick);
  };
  if (audioAnimationFrame) cancelAnimationFrame(audioAnimationFrame);
  audioAnimationFrame = requestAnimationFrame(tick);
};

const setupTrackPlayer = (container, audio) => {
  if (!container || !(audio instanceof HTMLAudioElement)) return;
  const playButton = container.querySelector("[data-action='play']");
  const muteButton = container.querySelector("[data-action='mute']");
  const scrubber = container.querySelector("[data-action='scrub']");
  const currentLabel = container.querySelector("[data-role='current']");
  const totalLabel = container.querySelector("[data-role='total']");

  const updatePlayLabel = () => {
    if (!playButton) return;
    playButton.textContent = audio.paused ? "Play" : "Pause";
  };

  const updateMuteLabel = () => {
    if (!muteButton) return;
    muteButton.textContent = audio.muted ? "Muted" : "Sound";
  };

  const updateTime = () => {
    if (currentLabel) currentLabel.textContent = formatTime(audio.currentTime);
    if (scrubber) {
      const duration = audio.duration;
      scrubber.max = Number.isFinite(duration) ? String(duration) : "0";
      scrubber.value = Number.isFinite(audio.currentTime) ? String(audio.currentTime) : "0";
    }
  };

  const updateDuration = () => {
    if (totalLabel) totalLabel.textContent = formatTime(audio.duration);
    if (scrubber) {
      scrubber.max = Number.isFinite(audio.duration) ? String(audio.duration) : "0";
    }
  };

  playButton?.addEventListener("click", () => {
    if (audio.paused) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } else {
      audio.pause();
    }
  });

  muteButton?.addEventListener("click", () => {
    audio.muted = !audio.muted;
  });

  scrubber?.addEventListener("input", () => {
    const value = Number(scrubber.value);
    if (Number.isFinite(value)) audio.currentTime = value;
  });

  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("loadedmetadata", updateDuration);
  audio.addEventListener("play", updatePlayLabel);
  audio.addEventListener("pause", updatePlayLabel);
  audio.addEventListener("volumechange", updateMuteLabel);
  audio.addEventListener("play", () => startAudioReactive(audio));
  audio.addEventListener("pause", stopAudioReactive);
  audio.addEventListener("ended", stopAudioReactive);

  updatePlayLabel();
  updateMuteLabel();
  updateDuration();
  updateTime();
};

const viewbox = createViewBoxAnimator(svg, { prefersReducedMotion });

const disposeThreeObject = (object) => {
  if (!object) return;
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
};

const resizeThree = () => {
  if (!threeApi || !mapPane) return;
  const rect = mapPane.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  threeApi.renderer.setPixelRatio(window.devicePixelRatio || 1);
  threeApi.renderer.setSize(rect.width, rect.height, false);
  threeApi.camera.aspect = rect.width / rect.height;
  threeApi.camera.updateProjectionMatrix();
};

const initThree = async () => {
  if (threeInitPromise) return threeInitPromise;
  threeInitPromise = (async () => {
    if (!stateCanvas) return null;
    const THREE = await import("https://unpkg.com/three@0.164.1/build/three.module.js");
    const renderer = new THREE.WebGLRenderer({
      canvas: stateCanvas,
      antialias: true,
      alpha: true,
    });
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0.3, 4.2);
    camera.lookAt(0, 0, 0);
    const hemi = new THREE.HemisphereLight(0xe8ffb2, 0x0b0e07, 0.7);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0x1b240f, 0.45);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(4, 3, 6);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x6b7f2c, 0.65);
    rim.position.set(-4, -3, 2);
    scene.add(rim);
    threeApi = { THREE, renderer, scene, camera, mesh: null, frameId: null };
    resizeThree();
    return threeApi;
  })();
  return threeInitPromise;
};

const buildShapesFromGeometry = (geometry, THREE) => {
  const shapes = [];
  if (!geometry) return shapes;
  const ringToPath = (ring, PathCtor) => {
    const path = new PathCtor();
    ring.forEach((coord, index) => {
      const x = coord[0];
      const y = -coord[1];
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    return path;
  };
  const addPolygon = (coords) => {
    if (!coords.length) return;
    const shape = ringToPath(coords[0], THREE.Shape);
    for (let i = 1; i < coords.length; i += 1) {
      shape.holes.push(ringToPath(coords[i], THREE.Path));
    }
    shapes.push(shape);
  };
  if (geometry.type === "Polygon") {
    addPolygon(geometry.coordinates || []);
  } else if (geometry.type === "MultiPolygon") {
    (geometry.coordinates || []).forEach((polygon) => addPolygon(polygon));
  }
  return shapes;
};

const collectPolygonsFromGeometry = (geometry) => {
  const polygons = [];
  if (!geometry) return polygons;
  const ringToPoints = (ring) =>
    ring.map((coord) => ({
      x: coord[0],
      y: -coord[1],
    }));
  const addPolygon = (coords) => {
    if (!coords.length) return;
    const outer = ringToPoints(coords[0]);
    const holes = coords.slice(1).map(ringToPoints);
    polygons.push({ outer, holes });
  };
  if (geometry.type === "Polygon") {
    addPolygon(geometry.coordinates || []);
  } else if (geometry.type === "MultiPolygon") {
    (geometry.coordinates || []).forEach((polygon) => addPolygon(polygon));
  }
  return polygons;
};

const isPointInRing = (x, y, ring) => {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const isPointInPolygon = (x, y, polygon) => {
  if (!polygon || !isPointInRing(x, y, polygon.outer)) return false;
  return !(polygon.holes || []).some((hole) => isPointInRing(x, y, hole));
};

const isPointInAnyPolygon = (x, y, polygons) =>
  (polygons || []).some((polygon) => isPointInPolygon(x, y, polygon));

const getRingCentroid = (ring) => {
  if (!ring || ring.length < 3) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const next = (i + 1) % ring.length;
    const x0 = ring[i][0];
    const y0 = -ring[i][1];
    const x1 = ring[next][0];
    const y1 = -ring[next][1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sumX = 0;
    let sumY = 0;
    ring.forEach((coord) => {
      sumX += coord[0];
      sumY += -coord[1];
    });
    const count = ring.length || 1;
    return { x: sumX / count, y: sumY / count, area: 0 };
  }
  return { x: cx / (6 * area), y: cy / (6 * area), area: Math.abs(area) };
};

const getGeometryCellInfo = (geometry) => {
  if (!geometry) return null;
  const addInfo = (ring) => {
    const centroid = getRingCentroid(ring);
    if (!centroid) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    ring.forEach((coord) => {
      const x = coord[0];
      const y = -coord[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    return {
      centroid,
      width: maxX - minX,
      height: maxY - minY,
      area: centroid.area,
    };
  };
  const collect = [];
  if (geometry.type === "Polygon") {
    const info = addInfo((geometry.coordinates || [])[0] || []);
    if (info) collect.push(info);
  } else if (geometry.type === "MultiPolygon") {
    (geometry.coordinates || []).forEach((polygon) => {
      const info = addInfo((polygon || [])[0] || []);
      if (info) collect.push(info);
    });
  }
  if (!collect.length) return null;
  const totalArea = collect.reduce((sum, item) => sum + (item.area || 0), 0) || 1;
  const weighted = collect.reduce(
    (acc, item) => {
      const weight = (item.area || 0) / totalArea;
      acc.x += item.centroid.x * weight;
      acc.y += item.centroid.y * weight;
      acc.width += item.width;
      acc.height += item.height;
      return acc;
    },
    { x: 0, y: 0, width: 0, height: 0 }
  );
  return {
    centroid: { x: weighted.x, y: weighted.y },
    width: weighted.width / collect.length,
    height: weighted.height / collect.length,
  };
};

const hash2 = (x, y) => {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const buildStateMesh = (stateId, THREE) => {
  if (!geojsonData) return null;
  const features = geojsonData.features.filter(
    (feature) => String((feature.properties || {}).state ?? "0") === String(stateId)
  );
  const shapes = [];
  const polygons = [];
  const cells = [];
  features.forEach((feature) => {
    shapes.push(...buildShapesFromGeometry(feature.geometry, THREE));
    polygons.push(...collectPolygonsFromGeometry(feature.geometry));
    const info = getGeometryCellInfo(feature.geometry);
    if (info) cells.push(info);
  });
  if (!shapes.length) return null;
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: 2.0,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.1,
    bevelSegments: 2,
  });
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  let centerX = 0;
  let centerY = 0;
  let scale = 1;
  if (box) {
    const sizeX = box.max.x - box.min.x;
    const sizeY = box.max.y - box.min.y;
    const sizeZ = box.max.z - box.min.z;
    centerX = (box.max.x + box.min.x) / 2;
    centerY = (box.max.y + box.min.y) / 2;
    const centerZ = (box.max.z + box.min.z) / 2;
    geometry.translate(-centerX, -centerY, -centerZ);
    const maxSize = Math.max(sizeX, sizeY, sizeZ || 0.25);
    scale = maxSize > 0 ? 2.4 / maxSize : 1;
    geometry.scale(scale, scale, scale);
  }
  geometry.computeBoundingBox();
  const scaledBounds = geometry.boundingBox;
  const transformPoint = (point) => ({
    x: (point.x - centerX) * scale,
    y: (point.y - centerY) * scale,
  });
  const transformedPolygons = polygons.map((polygon) => ({
    outer: polygon.outer.map(transformPoint),
    holes: (polygon.holes || []).map((hole) => hole.map(transformPoint)),
  }));
  const baseColorValue = colorForState ? colorForState(stateId, false) : "#bdff00";
  const baseColor = new THREE.Color(baseColorValue);
  const sideColor = baseColor.clone().multiplyScalar(0.6);
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.35,
    metalness: 0.08,
    flatShading: false,
    emissive: baseColor.clone().multiplyScalar(0.2),
    emissiveIntensity: 0.2,
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: sideColor,
    roughness: 0.75,
    metalness: 0.1,
    emissive: sideColor.clone().multiplyScalar(0.2),
    emissiveIntensity: 0.2,
  });
  const mesh = new THREE.Mesh(geometry, [faceMaterial, sideMaterial]);

  let terrainGroup = null;
  const terrainData = [];
  let terrainBaseHeight = null;
  let terrainMaxHeight = null;
  let terrainTopZ = null;
  let terrainRangeX = null;
  let terrainSize = null;
  let terrainNeighbors = null;
  let terrainHeights = null;
  if (scaledBounds && cells.length) {
    const avgWidth = cells.reduce((sum, item) => sum + item.width, 0) / cells.length;
    const avgHeight = cells.reduce((sum, item) => sum + item.height, 0) / cells.length;
    terrainSize = Math.max(0.02, Math.min(avgWidth, avgHeight) * scale * 0.7);
    const terrainMat = new THREE.LineBasicMaterial({
      color: 0xbdff00,
      transparent: true,
      opacity: 0.7,
    });
    terrainGroup = new THREE.Group();
    terrainGroup.frustumCulled = false;
    const minX = scaledBounds.min.x;
    terrainRangeX = scaledBounds.max.x - scaledBounds.min.x || 1;
    terrainTopZ = scaledBounds.max.z + 0.02;
    terrainBaseHeight = 0.04;
    terrainMaxHeight = 0.35;
    const gridSize = terrainSize * 1.4;
    const grid = new Map();
    features.forEach((feature) => {
      const info = getGeometryCellInfo(feature.geometry);
      if (!info) return;
      const shapesForCell = buildShapesFromGeometry(feature.geometry, THREE);
      if (!shapesForCell.length) return;
      const x = (info.centroid.x - centerX) * scale;
      const y = (info.centroid.y - centerY) * scale;
      const xNorm = (x - minX) / terrainRangeX;
      const gridX = gridSize > 0 ? Math.round(x / gridSize) : 0;
      const gridY = gridSize > 0 ? Math.round(y / gridSize) : 0;
      const key = `${gridX},${gridY}`;
      if (!grid.has(key)) grid.set(key, []);
      const weight = 0.35 + hash2(x, y) * 0.65;
      const meshes = shapesForCell.map((shape) => {
        const cellGeometry = new THREE.ExtrudeGeometry([shape], {
          depth: 1,
          bevelEnabled: false,
        });
        cellGeometry.translate(-centerX, -centerY, 0);
        cellGeometry.scale(scale, scale, 1);
        const edgeGeometry = new THREE.EdgesGeometry(cellGeometry, 1);
        cellGeometry.dispose();
        const cellEdges = new THREE.LineSegments(edgeGeometry, terrainMat);
        cellEdges.position.z = terrainTopZ;
        cellEdges.scale.z = terrainBaseHeight;
        terrainGroup.add(cellEdges);
        return cellEdges;
      });
      const cellIndex = terrainData.length;
      grid.get(key).push(cellIndex);
      terrainData.push({
        meshes,
        x,
        y,
        xNorm,
        weight,
        gridX,
        gridY,
      });
    });
    terrainNeighbors = terrainData.map(() => []);
    terrainData.forEach((cell, index) => {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          const key = `${cell.gridX + dx},${cell.gridY + dy}`;
          const indices = grid.get(key);
          if (!indices) continue;
          indices.forEach((neighborIndex) => {
            terrainNeighbors[index].push(neighborIndex);
          });
        }
      }
    });
    terrainHeights = new Float32Array(terrainData.length).fill(terrainBaseHeight);
    mesh.add(terrainGroup);
  }
  mesh.rotation.x = -0.85;
  mesh.rotation.y = 0.55;
  mesh.userData = {
    terrainGroup,
    terrainData,
    terrainSize,
    terrainTopZ,
    terrainBaseHeight,
    terrainMaxHeight,
    terrainRangeX,
    terrainNeighbors,
    terrainHeights,
    faceMaterial,
    sideMaterial,
    baseScale: mesh.scale.clone(),
  };
  return mesh;
};

const startThreeRender = () => {
  if (!threeApi) return;
  const renderLoop = () => {
    if (!threeApi) return;
    if (threeApi.mesh && !isThreeDragging) {
      threeApi.mesh.rotation.z += 0.002;
    }
    threeApi.renderer.render(threeApi.scene, threeApi.camera);
    threeApi.frameId = requestAnimationFrame(renderLoop);
  };
  if (threeApi.frameId) cancelAnimationFrame(threeApi.frameId);
  threeApi.frameId = requestAnimationFrame(renderLoop);
};

const stopThreeRender = () => {
  if (!threeApi) return;
  if (threeApi.frameId) cancelAnimationFrame(threeApi.frameId);
  threeApi.frameId = null;
};

const showState3D = async (stateId) => {
  if (!stateId || !mapPane) return;
  const api = await initThree();
  if (!api) return;
  if (api.mesh) {
    api.scene.remove(api.mesh);
    disposeThreeObject(api.mesh);
    api.mesh = null;
  }
  const mesh = buildStateMesh(stateId, api.THREE);
  if (!mesh) return;
  api.scene.add(mesh);
  api.mesh = mesh;
  mapPane.classList.add("is-3d");
  stateCanvas?.setAttribute("aria-hidden", "false");
  resizeThree();
  startThreeRender();
};

const hideState3D = () => {
  if (!mapPane) return;
  mapPane.classList.remove("is-3d");
  stateCanvas?.setAttribute("aria-hidden", "true");
  isThreeDragging = false;
  if (!threeApi) return;
  if (threeApi.mesh) {
    threeApi.scene.remove(threeApi.mesh);
    disposeThreeObject(threeApi.mesh);
    threeApi.mesh = null;
  }
  stopThreeRender();
};

const handleThreePointerDown = (event) => {
  if (!stateCanvas || !mapPane?.classList.contains("is-3d")) return;
  if (activePointerId !== null) return;
  activePointerId = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  isThreeDragging = true;
  stateCanvas.setPointerCapture?.(event.pointerId);
};

const handleThreePointerMove = (event) => {
  if (!threeApi?.mesh) return;
  if (activePointerId !== event.pointerId) return;
  const deltaX = event.clientX - lastPointerX;
  const deltaY = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  const speed = 0.004;
  const nextX = threeApi.mesh.rotation.x + deltaY * speed;
  const nextY = threeApi.mesh.rotation.y + deltaX * speed;
  threeApi.mesh.rotation.x = Math.max(-1.6, Math.min(-0.2, nextX));
  threeApi.mesh.rotation.y = nextY;
};

const handleThreePointerUp = (event) => {
  if (activePointerId !== event.pointerId) return;
  activePointerId = null;
  isThreeDragging = false;
  stateCanvas?.releasePointerCapture?.(event.pointerId);
};

if (stateCanvas) {
  stateCanvas.addEventListener("pointerdown", handleThreePointerDown);
  stateCanvas.addEventListener("pointermove", handleThreePointerMove);
  stateCanvas.addEventListener("pointerup", handleThreePointerUp);
  stateCanvas.addEventListener("pointercancel", handleThreePointerUp);
  stateCanvas.addEventListener("pointerleave", handleThreePointerUp);
}

const setSplitLayout = (isSplit) => {
  if (!app || !infoPane) return;
  if (isSplit) {
    app.classList.add("is-split");
    infoPane.removeAttribute("aria-hidden");
    backButton?.removeAttribute("hidden");
  } else {
    app.classList.remove("is-split");
    infoPane.setAttribute("aria-hidden", "true");
    backButton?.setAttribute("hidden", "");
  }
};

const setCollapsed = (isCollapsed) => {
  if (!svg) return;
  svg.classList.toggle("is-collapsed", isCollapsed);
};

const setAnimating = (isAnimating) => {
  if (!svg) return;
  svg.classList.toggle("is-animating", isAnimating);
};

const setLoading = (isLoading, message) => {
  if (!loadingScreen) return;
  if (message && loadingProgress) {
    loadingProgress.textContent = message;
  }
  if (isLoading) {
    loadingScreen.classList.remove("is-hidden");
    loadingScreen.setAttribute("aria-hidden", "false");
    app?.setAttribute("aria-busy", "true");
  } else {
    loadingScreen.classList.add("is-hidden");
    loadingScreen.setAttribute("aria-hidden", "true");
    app?.removeAttribute("aria-busy");
  }
};

const updateLoadingProgress = (current, total) => {
  if (!loadingProgress) return;
  loadingProgress.textContent = `Preparing state views ${current}/${total}...`;
};

const getViewportScale = (box, viewport) =>
  Math.min(viewport.width / box.width, viewport.height / box.height);

const getViewportOffset = (box, viewport, scale) => ({
  x: (viewport.width - box.width * scale) / 2,
  y: (viewport.height - box.height * scale) / 2,
});

const getTransformForViewBox = (fromBox, toBox, viewport) => {
  const fromScale = getViewportScale(fromBox, viewport);
  const toScale = getViewportScale(toBox, viewport);
  const scale = toScale / fromScale;
  const fromOffset = getViewportOffset(fromBox, viewport, fromScale);
  const toOffset = getViewportOffset(toBox, viewport, toScale);
  return {
    x: fromBox.x + (-toBox.x * toScale + toOffset.x - fromOffset.x) / fromScale,
    y: fromBox.y + (-toBox.y * toScale + toOffset.y - fromOffset.y) / fromScale,
    scale,
  };
};

const animateToViewBox = (targetBox, duration, options = {}) => {
  const finalize = () => {
    if (targetBox) viewbox.set(targetBox);
    transformAnimator?.set({ x: 0, y: 0, scale: 1 });
    if (options.useSnapshot) mapApi?.clearSnapshot();
    setAnimating(false);
    if (options.onComplete) options.onComplete();
  };

  if (!targetBox || !mapApi || !transformAnimator) {
    finalize();
    return;
  }
  const baseBox = viewbox.parse() || fullViewBox;
  if (!baseBox) {
    finalize();
    return;
  }
  const useSnapshot = options.useSnapshot && mapApi.createSnapshot(options.stateId);
  const layer = useSnapshot ? mapApi.getSnapshotLayer() : mapApi.getFocusLayer();
  transformAnimator.setElement(layer);
  transformAnimator.set({ x: 0, y: 0, scale: 1 });
  const viewport = getMapPaneSize();
  const transform = getTransformForViewBox(baseBox, targetBox, viewport);
  animationToken += 1;
  const token = animationToken;
  setAnimating(true);
  const finish = () => {
    if (token !== animationToken) return;
    finalize();
  };
  transformAnimator.animate(
    { x: 0, y: 0, scale: 1 },
    transform,
    prefersReducedMotion ? 0 : duration,
    finish
  );
};

const renderInfo = (stateId) => {
  if (!infoContent) return;
  if (!stateId) {
    infoContent.innerHTML =
      '<h2 class="info-title">Explore the map</h2><div class="info-body">Select a state to see it highlighted and focused here.</div>';
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    stopAudioReactive();
    return;
  }
  if (!geojsonData) {
    infoContent.innerHTML = `<h2 class="info-title">State ${stateId}</h2><div class="info-body">Loading details...</div>`;
    return;
  }
  const count = stateCounts.get(String(stateId)) ?? 0;
  const sigilHref = sigilsByState.get(String(stateId));
  const trackId = trackByState.get(String(stateId));
  const track = trackId ? trackById.get(trackId) : null;
  const sigilMarkup = sigilHref
    ? `<div class="sigil-card"><img class="sigil-image" src="${encodeURI(sigilHref)}" alt="State ${stateId} sigil" /></div>`
    : "";
  const trackMarkup = track
    ? `<div class="track-card"><div class="track-label">Now playing</div><div class="track-title">${track.title}</div><div class="track-player" data-track-player><button class="track-glyph" type="button" data-action="play">Play</button><input class="track-scrub" type="range" min="0" max="0" step="0.1" value="0" data-action="scrub" aria-label="Seek" /><div class="track-time" data-role="current">--:--</div><div class="track-time" data-role="total">--:--</div><button class="track-glyph" type="button" data-action="mute">Sound</button></div><audio class="track-audio" preload="metadata" src="${encodeURI(track.file)}"></audio></div>`
    : '<div class="track-card is-empty">No track assigned.</div>';
  infoContent.innerHTML = `<h2 class="info-title">State ${stateId}</h2><div class="info-body">${count} mapped cell${count === 1 ? "" : "s"}.</div>${sigilMarkup}${trackMarkup}`;
  const audio = infoContent.querySelector(".track-audio");
  if (audio instanceof HTMLAudioElement) {
    if (activeAudio && activeAudio !== audio) {
      activeAudio.pause();
    }
    activeAudio = audio;
    const player = infoContent.querySelector("[data-track-player]");
    setupTrackPlayer(player, audio);
  } else {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    stopAudioReactive();
  }
};

const getMapPaneSize = () => {
  const rect = mapPane?.getBoundingClientRect();
  const width = rect?.width ?? window.innerWidth;
  const height = rect?.height ?? window.innerHeight;
  return { width, height };
};

const getTargetViewBoxForState = (stateId) => {
  const bounds = mapApi?.getStateBounds(stateId);
  if (!bounds || !fullViewBox) return fullViewBox;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const padding = 0.08;
  let targetWidth = width * (1 + padding * 2);
  let targetHeight = height * (1 + padding * 2);
  const centerX = bounds.minX + width / 2;
  const centerY = bounds.minY + height / 2;
  const pane = getMapPaneSize();
  const targetAspect = pane.width / pane.height;
  const boxAspect = targetWidth / targetHeight;
  if (boxAspect > targetAspect) {
    targetHeight = targetWidth / targetAspect;
  } else {
    targetWidth = targetHeight * targetAspect;
  }
  return {
    x: centerX - targetWidth / 2,
    y: centerY - targetHeight / 2,
    width: targetWidth,
    height: targetHeight,
  };
};

const updateUrlState = (stateId) => {
  const url = new URL(window.location.href);
  if (stateId) {
    url.searchParams.set("state", stateId);
  } else {
    url.searchParams.delete("state");
  }
  history.pushState({ stateId }, "", url);
};

const selectState = (stateId, options = {}) => {
  if (!stateId) return;
  const normalized = String(stateId);
  if (normalized === "0" || normalized === activeStateId) return;
  mapApi?.setActiveState(normalized);
  mapApi?.focusState(normalized);
  renderFocusSigil(normalized);
  setCollapsed(true);
  activeStateId = normalized;
  renderInfo(normalized);
  if (activeAudio) {
    const playPromise = activeAudio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }
  setSplitLayout(true);
  showState3D(normalized);
  if (options.pushState !== false) updateUrlState(normalized);
  requestAnimationFrame(() => {
    const target = getTargetViewBoxForState(normalized);
    if (!target) {
      setAnimating(false);
      return;
    }
    lastSelectedViewBox = target;
    animateToViewBox(target, 700, { stateId: normalized, useSnapshot: true });
  });
};

const clearSelection = (options = {}) => {
  const stateId = activeStateId;
  const previousBox = lastSelectedViewBox;
  mapApi?.resetFocus();
  mapApi?.setActiveState(null);
  mapApi?.clearHover();
  clearFocusSigilLayer();
  stopAudioReactive();
  hideState3D();
  activeStateId = null;
  renderInfo(null);
  setSplitLayout(false);
  if (options.pushState !== false) updateUrlState(null);
  setCollapsed(false);
  if (fullViewBox) viewbox.set(fullViewBox);
  setAnimating(false);
  lastSelectedViewBox = null;
  if (!stateId || !previousBox || !mapApi?.createSnapshot) return;
  if (!mapApi.createSnapshot(stateId)) return;
  const layer = mapApi.getSnapshotLayer();
  if (!layer || !transformAnimator || !fullViewBox) return;
  const startTransform = getTransformForViewBox(fullViewBox, previousBox, getMapPaneSize());
  transformAnimator.setElement(layer);
  transformAnimator.set(startTransform);
  animationToken += 1;
  const token = animationToken;
  setAnimating(true);
  transformAnimator.animate(
    startTransform,
    { x: 0, y: 0, scale: 1 },
    prefersReducedMotion ? 0 : 520,
    () => {
      if (token !== animationToken) return;
      mapApi.clearSnapshot();
      setAnimating(false);
    }
  );
};

const init = async () => {
  if (!dataUrl || !svg) return;
  try {
    setLoading(true, "Loading map data...");
    const [geojson, tracks, sigils] = await Promise.all([
      loadGeoJSON(dataUrl),
      tracksUrl ? loadTracks(tracksUrl) : Promise.resolve(null),
      sigilsUrl ? loadSigils(sigilsUrl) : Promise.resolve(null),
    ]);
    geojsonData = geojson;
    stateCounts = new Map();
    geojson.features.forEach((feature) => {
      const stateId = String((feature.properties || {}).state ?? "0");
      stateCounts.set(stateId, (stateCounts.get(stateId) ?? 0) + 1);
    });
    if (tracks) {
      trackByState = new Map(Object.entries(tracks.states || {}));
      trackById = new Map((tracks.tracks || []).map((item) => [item.id, item]));
    }
    if (sigils) {
      sigilsByState = resolveSigilMap(sigils);
    }
    colorForState = createStateColor({ oceanColor: "#1b2212" });
    mapApi = createMap({ svg, geojson, colorForState });
    transformAnimator = createTransformAnimator(mapApi.getSnapshotLayer(), {
      prefersReducedMotion,
    });
    fullViewBox = mapApi.fullViewBox;
    if (fullViewBox) viewbox.set(fullViewBox);
    renderSigilLayer();
    renderInfo(null);

    if (mapApi.preloadSnapshots && shouldPreloadSnapshots) {
      setLoading(true, "Preparing state views 0/0...");
      await mapApi.preloadSnapshots({ onProgress: updateLoadingProgress });
    }
    setLoading(false);

    const initialState = new URLSearchParams(window.location.search).get("state");
    if (initialState) {
      selectState(initialState, { pushState: false });
    }
  } catch (error) {
    console.error(error);
    renderInfo(null);
    setSplitLayout(true);
    setLoading(false);
    if (infoContent) {
      infoContent.innerHTML =
        '<h2 class="info-title">Error</h2><div class="info-body">Could not load map data.</div>';
    }
  }
};

svg?.addEventListener("click", (event) => {
  let node = event.target;
  while (node && node !== svg) {
    if (node.classList && node.classList.contains("cell")) {
      const stateId = node.dataset.state;
      if (stateId && stateId !== "0") {
        selectState(stateId);
      }
      return;
    }
    node = node.parentNode;
  }
});

backButton?.addEventListener("click", (event) => {
  event.preventDefault();
  clearSelection();
});

window.addEventListener("resize", () => {
  resizeThree();
  if (!activeStateId) return;
  const target = getTargetViewBoxForState(activeStateId);
  viewbox.set(target);
});

window.addEventListener("popstate", () => {
  const stateId = new URLSearchParams(window.location.search).get("state");
  if (stateId) {
    selectState(stateId, { pushState: false });
  } else {
    clearSelection({ pushState: false });
  }
});

init();
