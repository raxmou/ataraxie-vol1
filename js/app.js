import { loadGeoJSON, loadSigils, loadTracks } from "./data.js";
import { createMap, createStateColor } from "./map.js";
import { createViewBoxAnimator, createTransformAnimator } from "./viewbox.js";
import { createTextureCanvas } from "./texture-canvas.js";
import { createHourglassPlayer } from "./hourglass-player.js";
import {
  revealedStates,
  questionedStates,
  isStateRevealed,
  hasBeenQuestioned,
  markAsQuestioned,
  revealState,
  getNeighbors,
  buildStateNeighborMap,
} from "./fog.js";

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
const questionModal = document.getElementById("question-modal");
const questionText = document.getElementById("question-text");
const answerBtn1 = document.getElementById("answer-btn-1");
const answerBtn2 = document.getElementById("answer-btn-2");
const infoButton = document.getElementById("info-button");
const creditsModal = document.getElementById("credits-modal");
const creditsClose = document.getElementById("credits-close");
const stateCanvas = document.getElementById("state-3d-canvas");
const sigilCanvas = document.getElementById("sigil-3d-canvas");
const threeStack = document.getElementById("state-3d-stack");
const threeToggle = document.getElementById("three-toggle");
const threeToggleButtons = threeToggle?.querySelectorAll("[data-3d-target]");
const dataUrl = app?.dataset.geojson;
const sigilsUrl = app?.dataset.sigils;
const tracksUrl = app?.dataset.tracks;
const shouldPreloadSnapshots = app?.dataset.preloadSnapshots === "true";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const THREE_URL = "https://unpkg.com/three@0.164.1/build/three.module.js";
const SVG_LOADER_URL =
  "https://unpkg.com/three@0.164.1/examples/jsm/loaders/SVGLoader.js?module";

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
let threeModulePromise = null;
let svgLoaderPromise = null;
let threeApi = null;
let threeInitPromise = null;
let sigilThreeApi = null;
let sigilInitPromise = null;
let sigilLoadToken = 0;
let colorForState = null;
let textureCanvas = null;
let sigilsByState = new Map();
let sigilLayer = null;
let focusSigilLayer = null;
let hoverSigilImage = null;
let hoverSigilStateId = null;
let hoverSigilToken = 0;
let sigilSvgCache = new Map();
let sigilGeometryCache = new Map();
let audioContext = null;
let audioAnalyser = null;
let audioData = null;
let audioAnimationFrame = null;
let audioSource = null;
let audioElement = null;
let audioTime = 0;
let hourglassPlayer = null;
let isThreeDragging = false;
let activePointerId = null;
let lastPointerX = 0;
let lastPointerY = 0;
let isSigilDragging = false;
let sigilPointerId = null;
let sigilLastPointerX = 0;
let sigilLastPointerY = 0;
let stateInertiaX = 0;
let stateInertiaY = 0;
let sigilInertiaX = 0;
let sigilInertiaY = 0;
let activeThreeView = "state";
let questionTimeout = null;
let bgTextureCache = new Map();

const stateTextureFiles = [
  "assets/textures/VISUALWORKS1 6.png",
  "assets/textures/VISUALWORKS14 1.png",
  "assets/textures/VISUALWORKS33 1.png",
  "assets/textures/VISUALWORKS41 1.png",
  "assets/textures/VISUALWORKS54 1.png",
  "assets/textures/VISUALWORKS57 1.png",
];

const getTextureIndexForState = (stateId) =>
  Math.abs(Number(stateId)) % stateTextureFiles.length;

const formatTime = (value) => {
  if (!Number.isFinite(value)) return "--:--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const loadThreeModule = () => {
  if (!threeModulePromise) {
    threeModulePromise = import(THREE_URL);
  }
  return threeModulePromise;
};

const loadSvgLoader = () => {
  if (!svgLoaderPromise) {
    svgLoaderPromise = import(SVG_LOADER_URL);
  }
  return svgLoaderPromise;
};

const loadBgTexture = (stateId, THREE) => {
  const index = getTextureIndexForState(stateId);
  if (bgTextureCache.has(index)) return Promise.resolve(bgTextureCache.get(index));
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    const url = encodeURI(stateTextureFiles[index]);
    loader.load(
      url,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        bgTextureCache.set(index, texture);
        resolve(texture);
      },
      undefined,
      (err) => {
        console.warn("Failed to load texture:", url, err);
        resolve(null);
      }
    );
  });
};

const getSigilBaseSize = () => {
  const baseBox = mapApi?.fullViewBox;
  return baseBox ? clamp(Math.min(baseBox.width, baseBox.height) * 0.032, 10, 24) : 16;
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
  hoverSigilImage = null;
  hoverSigilStateId = null;
};

const clearFocusSigilLayer = () => {
  if (!focusSigilLayer) return;
  focusSigilLayer.remove();
  focusSigilLayer = null;
};

const hideHoverSigil = () => {
  if (!sigilLayer) return;
  sigilLayer.classList.remove("is-visible");
  sigilLayer.classList.remove("is-animating");
  hoverSigilStateId = null;
  hoverSigilToken += 1;
  delete sigilLayer.dataset.hoverToken;
};

const showHoverSigil = (stateId) => {
  if (!sigilLayer || !hoverSigilImage || !mapApi) return;
  if (!stateId || stateId === "0") {
    hideHoverSigil();
    return;
  }
  const href = sigilsByState.get(String(stateId));
  if (!href) {
    hideHoverSigil();
    return;
  }
  const bounds = mapApi.getStateBounds(stateId);
  if (!bounds) {
    hideHoverSigil();
    return;
  }
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    hideHoverSigil();
    return;
  }
  const size = getSigilBaseSize() * 1.1;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const resolvedHref = encodeURI(href);
  hoverSigilImage.setAttribute("href", resolvedHref);
  hoverSigilImage.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", resolvedHref);
  hoverSigilImage.setAttribute("x", (centerX - size / 2).toFixed(3));
  hoverSigilImage.setAttribute("y", (centerY - size / 2).toFixed(3));
  hoverSigilImage.setAttribute("width", size.toFixed(3));
  hoverSigilImage.setAttribute("height", size.toFixed(3));
  hoverSigilImage.dataset.state = String(stateId);
  const nextState = String(stateId);
  if (hoverSigilStateId !== nextState) {
    hoverSigilToken += 1;
    const token = hoverSigilToken;
    sigilLayer.dataset.hoverToken = String(token);
    sigilLayer.classList.remove("is-visible", "is-animating");
    sigilLayer.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (!sigilLayer || hoverSigilToken !== token) return;
      sigilLayer.classList.add("is-visible", "is-animating");
    });
  } else {
    sigilLayer.classList.add("is-visible");
  }
  hoverSigilStateId = nextState;
};

const renderSigilLayer = () => {
  clearSigilLayer();
  if (!svg || !mapApi || !sigilsByState.size) return;
  const layer = document.createElementNS(svgNS, "g");
  layer.setAttribute("id", sigilLayerId);
  layer.classList.add("sigil-layer", "sigil-layer--hover");
  layer.setAttribute("aria-hidden", "true");
  const image = document.createElementNS(svgNS, "image");
  image.classList.add("sigil");
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  layer.appendChild(image);
  const focusLayer = mapApi.getFocusLayer?.();
  if (focusLayer?.parentNode === svg) {
    svg.insertBefore(layer, focusLayer);
  } else {
    svg.appendChild(layer);
  }
  sigilLayer = layer;
  hoverSigilImage = image;
  sigilLayer.addEventListener("animationend", (event) => {
    if (event.animationName === "sigil-pop") {
      const token = Number(sigilLayer?.dataset?.hoverToken || 0);
      if (token !== hoverSigilToken) return;
      sigilLayer.classList.remove("is-animating");
    }
  });
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
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
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
        const smoothFactor = 0.45;
        terrainData.forEach((cell, index) => {
          const bin = Math.max(0, Math.min(maxBin, Math.floor(cell.xNorm * maxBin)));
          const amp = audioData[bin] / 255;
          const noise = 0.3 + 0.7 * (0.5 + 0.3 * Math.sin(cell.x * 2.2 + audioTime * 1.8) + 0.2 * Math.sin(cell.y * 1.7 + audioTime * 1.2));
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
          const smoothed = rawHeights[index] * 0.55 + neighborAvg * 0.45;
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

  // Dispose previous hourglass player if exists
  if (hourglassPlayer) {
    hourglassPlayer.dispose();
    hourglassPlayer = null;
  }

  // Create new hourglass player
  hourglassPlayer = createHourglassPlayer(container, audio);

  // Connect audio reactive events
  audio.addEventListener("play", () => startAudioReactive(audio));
  audio.addEventListener("pause", stopAudioReactive);
  audio.addEventListener("ended", stopAudioReactive);
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

const applyInertiaRotation = (mesh, inertiaX, inertiaY, clampX, damping = 0.92) => {
  if (!mesh) return { x: inertiaX, y: inertiaY };
  if (Math.abs(inertiaX) < 0.0001 && Math.abs(inertiaY) < 0.0001) {
    return { x: 0, y: 0 };
  }
  const nextX = mesh.rotation.x + inertiaX;
  mesh.rotation.x = Math.max(clampX.min, Math.min(clampX.max, nextX));
  mesh.rotation.y += inertiaY;
  let nextInertiaX = inertiaX * damping;
  let nextInertiaY = inertiaY * damping;
  if (Math.abs(nextInertiaX) < 0.0001) nextInertiaX = 0;
  if (Math.abs(nextInertiaY) < 0.0001) nextInertiaY = 0;
  return { x: nextInertiaX, y: nextInertiaY };
};

const resizeRenderer = (api, canvas) => {
  if (!api || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  api.renderer.setPixelRatio(window.devicePixelRatio || 1);
  api.renderer.setSize(rect.width, rect.height, false);
  api.camera.aspect = rect.width / rect.height;
  api.camera.updateProjectionMatrix();
};

const resizeThree = () => {
  resizeRenderer(threeApi, stateCanvas);
};

const resizeSigilThree = () => {
  resizeRenderer(sigilThreeApi, sigilCanvas);
};

const initThree = async () => {
  if (threeInitPromise) return threeInitPromise;
  threeInitPromise = (async () => {
    if (!stateCanvas) return null;
    const THREE = await loadThreeModule();
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

const initSigilThree = async () => {
  if (sigilInitPromise) return sigilInitPromise;
  sigilInitPromise = (async () => {
    if (!sigilCanvas) return null;
    const THREE = await loadThreeModule();
    const renderer = new THREE.WebGLRenderer({
      canvas: sigilCanvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    // Enable tone mapping for realistic PBR glossy materials
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0.18, 3.4);
    camera.lookAt(0, 0, 0);
    // Atmospheric hemisphere light for medieval ambiance
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1510, 0.6);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0x2a2015, 0.3);
    scene.add(ambient);
    // Main key light - warm torch-like illumination
    const dir = new THREE.DirectionalLight(0xffeedd, 1.4);
    dir.position.set(3, 2.4, 4.2);
    scene.add(dir);
    // Rim light for dramatic edge highlights (cool contrast)
    const rim = new THREE.DirectionalLight(0x8899aa, 0.6);
    rim.position.set(-3.6, -2.6, 2.4);
    scene.add(rim);
    // Point light for specular highlights on glossy surface
    const key = new THREE.PointLight(0xffffff, 1.0, 18);
    key.position.set(0, 1.2, 2.6);
    scene.add(key);
    // Secondary fill light for clearcoat reflections
    const fill = new THREE.PointLight(0xffd4a0, 0.5, 12);
    fill.position.set(-2, 0.5, 3);
    scene.add(fill);
    sigilThreeApi = { THREE, renderer, scene, camera, mesh: null, frameId: null };
    resizeSigilThree();
    return sigilThreeApi;
  })();
  return sigilInitPromise;
};

const loadSigilSvg = async (href) => {
  if (!href) return null;
  const cached = sigilSvgCache.get(href);
  if (cached) return cached;
  const response = await fetch(encodeURI(href));
  if (!response.ok) throw new Error(`Failed to load sigil: ${response.status}`);
  const text = await response.text();
  sigilSvgCache.set(href, text);
  return text;
};

const buildSigilGeometry = async (sigilHref, THREE) => {
  if (!sigilHref) return null;
  const cached = sigilGeometryCache.get(sigilHref);
  if (cached) return cached;
  const svgText = await loadSigilSvg(sigilHref);
  if (!svgText) return null;
  const { SVGLoader } = await loadSvgLoader();
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const shapes = [];
  const outlineCandidates = [];
  data.paths.forEach((path) => {
    const pathShapes = SVGLoader.createShapes(path);
    shapes.push(...pathShapes);
    const subPaths =
      Array.isArray(path.subPaths) && path.subPaths.length ? path.subPaths : [path];
    subPaths.forEach((subPath) => {
      const points = subPath.getPoints(240);
      if (points && points.length > 8) outlineCandidates.push(points);
    });
  });
  if (!shapes.length) return null;
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: 2.0,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.1,
    bevelSegments: 2,
  });
  geometry.scale(1, -1, 1);
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
    const maxSize = Math.max(sizeX, sizeY, sizeZ || 0.1);
    scale = maxSize > 0 ? 1.7 / maxSize : 1;
    geometry.scale(scale, scale, scale);
  }
  geometry.computeBoundingBox();
  const finalBox = geometry.boundingBox;
  const frontZ = finalBox ? finalBox.max.z : 0;
  let outlinePoints = null;
  let outlineLength = 0;
  if (outlineCandidates.length) {
    outlineCandidates.forEach((candidate) => {
      if (!candidate || candidate.length < 8) return;
      const mapped = candidate.map(
        (point) =>
          new THREE.Vector3(
            (point.x - centerX) * scale,
            (-point.y - centerY) * scale,
            frontZ + 0.006
          )
      );
      let length = 0;
      for (let i = 1; i < mapped.length; i += 1) {
        length += mapped[i].distanceTo(mapped[i - 1]);
      }
      if (length > outlineLength) {
        outlineLength = length;
        outlinePoints = mapped;
      }
    });
  }
  geometry.computeVertexNormals();
  const geometryData = { geometry, outlinePoints };
  sigilGeometryCache.set(sigilHref, geometryData);
  return geometryData;
};

const createSigilComet = (points, THREE) => {
  if (!points || points.length < 8) return null;
  const curve = new THREE.CatmullRomCurve3(points, true);
  const tailCount = 28;
  const tailPositions = new Float32Array(tailCount * 3);
  const tailColors = new Float32Array(tailCount * 3);
  const baseColor = new THREE.Color(0xbdff00);
  const dimColor = new THREE.Color(0x2b3b07);
  const start = curve.getPointAt(0);
  for (let i = 0; i < tailCount; i += 1) {
    const idx = i * 3;
    tailPositions[idx] = start.x;
    tailPositions[idx + 1] = start.y;
    tailPositions[idx + 2] = start.z;
    const fade = 1 - i / Math.max(1, tailCount - 1);
    const color = baseColor.clone().lerp(dimColor, 1 - fade);
    tailColors[idx] = color.r;
    tailColors[idx + 1] = color.g;
    tailColors[idx + 2] = color.b;
  }
  const tailGeometry = new THREE.BufferGeometry();
  tailGeometry.setAttribute("position", new THREE.BufferAttribute(tailPositions, 3));
  tailGeometry.setAttribute("color", new THREE.BufferAttribute(tailColors, 3));
  const tailMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
  });
  const tailLine = new THREE.Line(tailGeometry, tailMaterial);
  tailLine.frustumCulled = false;
  tailLine.renderOrder = 3;
  const headGeometry = new THREE.SphereGeometry(0.022, 10, 10);
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xbdff00 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.copy(start);
  head.renderOrder = 4;
  return {
    curve,
    tailLine,
    tailGeometry,
    tailPositions,
    head,
    tailCount,
    t: Math.random(),
    speed: 0.0012,
    phase: Math.random() * Math.PI * 2,
  };
};

const updateSigilComet = (comet) => {
  if (!comet) return;
  comet.t = (comet.t + comet.speed) % 1;
  const headPos = comet.curve.getPointAt(comet.t);
  const positions = comet.tailPositions;
  for (let i = comet.tailCount - 1; i > 0; i -= 1) {
    const idx = i * 3;
    const prev = (i - 1) * 3;
    positions[idx] = positions[prev];
    positions[idx + 1] = positions[prev + 1];
    positions[idx + 2] = positions[prev + 2];
  }
  positions[0] = headPos.x;
  positions[1] = headPos.y;
  positions[2] = headPos.z;
  comet.tailGeometry.attributes.position.needsUpdate = true;
  comet.head.position.copy(headPos);
  const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.004 + comet.phase);
  comet.head.scale.setScalar(pulse);
};

const createArmorRoughnessMap = (THREE, seed = 0) => {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Base layer - light gray for glossy base (low roughness = light color)
  ctx.fillStyle = "#cccccc";
  ctx.fillRect(0, 0, size, size);

  const random = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  };

  // Large polished areas first - very light for mirror-like reflections
  const polishCount = 12 + Math.floor(random(seed * 5, seed) * 8);
  for (let i = 0; i < polishCount; i += 1) {
    const x = random(i * 19, seed * 6) * size;
    const y = random(seed * 7, i * 23) * size;
    const radius = 60 + random(i * 4, seed) * 100;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(240, 240, 240, 0.9)");
    gradient.addColorStop(0.4, "rgba(220, 220, 220, 0.6)");
    gradient.addColorStop(0.8, "rgba(200, 200, 200, 0.3)");
    gradient.addColorStop(1, "rgba(180, 180, 180, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine scratches - subtle, thin lines (less aggressive)
  const scratchCount = 20 + Math.floor(random(seed * 2, seed) * 15);
  for (let i = 0; i < scratchCount; i += 1) {
    const x1 = random(i * 13, seed * 2) * size;
    const y1 = random(seed * 3, i * 17) * size;
    const length = 20 + random(i * 5, seed) * 80;
    const angle = random(i, seed * 4) * Math.PI * 2;
    const x2 = x1 + Math.cos(angle) * length;
    const y2 = y1 + Math.sin(angle) * length;

    // Medium gray = moderate roughness (subtle scratches)
    ctx.strokeStyle = `rgba(80, 80, 80, ${0.3 + random(i, seed) * 0.4})`;
    ctx.lineWidth = 0.5 + random(i * 2, seed) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Small worn spots - moderate roughness patches
  const wornCount = 8 + Math.floor(random(seed, seed) * 6);
  for (let i = 0; i < wornCount; i += 1) {
    const x = random(i * 7, seed) * size;
    const y = random(seed, i * 11) * size;
    const radius = 8 + random(i, i) * 20;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(60, 60, 60, 0.6)");
    gradient.addColorStop(0.6, "rgba(100, 100, 100, 0.3)");
    gradient.addColorStop(1, "rgba(140, 140, 140, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

const applyBattleDamage = (geometry, seed = 0) => {
  const random = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  };
  
  const positionAttr = geometry.attributes.position;
  if (!positionAttr) return;
  
  const vertexCount = positionAttr.count;
  const dentCount = 8 + Math.floor(random(seed, seed) * 5);
  
  for (let d = 0; d < dentCount; d += 1) {
    const dentX = (random(d * 3, seed) - 0.5) * 1.5;
    const dentY = (random(seed, d * 5) - 0.5) * 1.5;
    const dentZ = random(d * 7, seed * 2) * 0.5;
    const dentRadius = 0.15 + random(d, d * 2) * 0.25;
    const dentDepth = 0.015 + random(d * 2, seed) * 0.025;
    
    for (let i = 0; i < vertexCount; i += 1) {
      const x = positionAttr.getX(i);
      const y = positionAttr.getY(i);
      const z = positionAttr.getZ(i);
      
      const dx = x - dentX;
      const dy = y - dentY;
      const dz = z - dentZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (dist < dentRadius) {
        const influence = 1 - (dist / dentRadius);
        const push = influence * influence * dentDepth;
        positionAttr.setZ(i, z - push);
      }
    }
  }
  
  positionAttr.needsUpdate = true;
  geometry.computeVertexNormals();
};

// Create procedural environment cube map for glossy reflections
const createMedievalEnvMap = (THREE) => {
  const size = 256;

  // Create 6 face textures for a cube map
  const createFaceTexture = (topColor, bottomColor, accentHue) => {
    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = size;
    faceCanvas.height = size;
    const faceCtx = faceCanvas.getContext("2d");

    // Gradient background - dark medieval atmosphere
    const gradient = faceCtx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, topColor);
    gradient.addColorStop(1, bottomColor);
    faceCtx.fillStyle = gradient;
    faceCtx.fillRect(0, 0, size, size);

    // Add subtle warm light spots (torch/candle reflections)
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 20 + Math.random() * 40;
      const spotGradient = faceCtx.createRadialGradient(x, y, 0, x, y, r);
      spotGradient.addColorStop(0, `hsla(${accentHue}, 60%, 70%, 0.3)`);
      spotGradient.addColorStop(0.5, `hsla(${accentHue}, 50%, 50%, 0.1)`);
      spotGradient.addColorStop(1, "transparent");
      faceCtx.fillStyle = spotGradient;
      faceCtx.fillRect(0, 0, size, size);
    }

    return faceCanvas;
  };

  // Create the 6 cube faces
  const faces = [
    createFaceTexture("#1a1612", "#0d0a08", 35),  // px (right) - warm
    createFaceTexture("#12151a", "#080a0d", 210), // nx (left) - cool
    createFaceTexture("#2a2218", "#1a1612", 45),  // py (top) - bright warm
    createFaceTexture("#080604", "#040302", 30),  // ny (bottom) - dark
    createFaceTexture("#1a1815", "#0d0c0a", 40),  // pz (front) - neutral warm
    createFaceTexture("#15161a", "#0a0b0d", 220), // nz (back) - cool
  ];

  const cubeTexture = new THREE.CubeTexture(faces);
  cubeTexture.needsUpdate = true;

  return cubeTexture;
};

// Create hammered metal normal map for medieval texture
const createHammeredNormalMap = (THREE, seed = 0) => {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Neutral normal (pointing up) as base
  ctx.fillStyle = "#8080ff";
  ctx.fillRect(0, 0, size, size);

  const random = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  };

  // Hammered dents - circular depressions with directional normals
  const dentCount = 60 + Math.floor(random(seed, seed * 2) * 40);
  for (let i = 0; i < dentCount; i++) {
    const cx = random(i * 13, seed) * size;
    const cy = random(seed * 3, i * 17) * size;
    const radius = 8 + random(i * 5, seed * 2) * 25;
    const depth = 0.3 + random(i, seed) * 0.5;

    // Draw radial gradient for dent normals
    for (let y = Math.max(0, cy - radius); y < Math.min(size, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x < Math.min(size, cx + radius); x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < radius) {
          const factor = 1 - (dist / radius);
          const influence = factor * factor * depth;

          // Normal map: R=X, G=Y, B=Z (tangent space)
          // Point normals inward toward dent center
          const nx = (dx / radius) * influence;
          const ny = (dy / radius) * influence;

          // Convert to 0-255 range (128 = neutral)
          const r = Math.floor(128 + nx * 127);
          const g = Math.floor(128 - ny * 127); // Flip Y for OpenGL convention
          const b = 255; // Z always pointing up

          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  // Add fine grain texture
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (random(i, seed) - 0.5) * 8;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
  }
  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

// Cached env map reference
let sigilEnvMap = null;

const buildSigilMesh = async (stateId, sigilHref, THREE, depthRatio) => {
  const geometryData = await buildSigilGeometry(sigilHref, THREE);
  if (!geometryData?.geometry) return null;
  const geometry = geometryData.geometry.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  let zScale = 1;
  if (box) {
    const sizeX = box.max.x - box.min.x;
    const sizeY = box.max.y - box.min.y;
    const sizeZ = box.max.z - box.min.z || 1;
    const ratio = Number.isFinite(depthRatio) ? Math.max(depthRatio, 0.08) : 0.08;
    const targetDepth = Math.max(sizeZ, Math.max(sizeX, sizeY) * ratio);
    zScale = targetDepth / sizeZ;
    geometry.scale(1, 1, zScale);
  }
  geometry.computeVertexNormals();
  
  // Apply physical battle damage to geometry
  const stateHash = parseInt(stateId, 10) || 1;
  applyBattleDamage(geometry, stateHash * 456.789);
  
  const baseColorValue = colorForState ? colorForState(stateId, false) : "#bdff00";
  const baseColor = new THREE.Color(baseColorValue);
  // Medieval plate armor: mix base color with gold/silver for luxurious metallic look
  const armorColor = baseColor.clone().lerp(new THREE.Color(0xd4af37), 0.25); // Gold tint
  armorColor.lerp(new THREE.Color(0xc0c0c0), 0.2); // Silver highlight
  const sideColor = armorColor.clone().multiplyScalar(0.7);

  // Create textures for glossy medieval look
  const roughnessMap = createArmorRoughnessMap(THREE, stateHash * 123.456);
  const normalMap = createHammeredNormalMap(THREE, stateHash * 789.012);

  // Create/cache environment map for reflections
  if (!sigilEnvMap && sigilThreeApi?.renderer) {
    sigilEnvMap = createMedievalEnvMap(THREE);
  }

  // MeshPhysicalMaterial for glossy lacquered armor effect
  const faceMaterial = new THREE.MeshPhysicalMaterial({
    color: armorColor,
    roughness: 0.15, // Low roughness for glossy surface
    metalness: 0.95, // High metalness for polished metal
    emissive: armorColor.clone().multiplyScalar(0.08),
    emissiveIntensity: 0.1,
    side: THREE.DoubleSide,
    envMap: sigilEnvMap,
    envMapIntensity: 1.8, // Strong reflections
    roughnessMap: roughnessMap,
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4), // Subtle hammered texture
    // Clearcoat for lacquered/varnished medieval armor look
    clearcoat: 0.8, // Strong clear lacquer layer
    clearcoatRoughness: 0.1, // Very smooth lacquer
    // Reflectivity and IOR for realistic glass-like clearcoat
    reflectivity: 0.9,
    ior: 1.5,
    // Subtle sheen for velvet-like edge glow (heraldic fabric influence)
    sheen: 0.3,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(baseColorValue).multiplyScalar(0.5),
  });

  const sideMaterial = new THREE.MeshPhysicalMaterial({
    color: sideColor,
    roughness: 0.25, // Slightly more rough on edges
    metalness: 0.92,
    emissive: sideColor.clone().multiplyScalar(0.06),
    emissiveIntensity: 0.1,
    side: THREE.DoubleSide,
    envMap: sigilEnvMap,
    envMapIntensity: 1.4,
    roughnessMap: roughnessMap,
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    clearcoat: 0.6, // Less clearcoat on edges (worn away)
    clearcoatRoughness: 0.2,
    reflectivity: 0.8,
    ior: 1.5,
    sheen: 0.2,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(baseColorValue).multiplyScalar(0.4),
  });
  const mesh = new THREE.Mesh(geometry, [faceMaterial, sideMaterial]);
  const edgeGeometry = new THREE.EdgesGeometry(geometry, 8);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: baseColor.clone().multiplyScalar(1.15),
    transparent: true,
    opacity: 0.65,
  });
  const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edgeLines.renderOrder = 2;
  mesh.add(edgeLines);
  let comet = null;
  if (geometryData.outlinePoints && geometryData.outlinePoints.length > 8) {
    const cometPoints = geometryData.outlinePoints.map(
      (point) => new THREE.Vector3(point.x, point.y, point.z * zScale)
    );
    comet = createSigilComet(cometPoints, THREE);
    if (comet) {
      mesh.add(comet.tailLine);
      mesh.add(comet.head);
    }
  }
  mesh.rotation.x = -0.75;
  mesh.rotation.y = 0.45;
  mesh.userData = { faceMaterial, sideMaterial, edgeMaterial, comet };
  return mesh;
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
  let depthRatio = null;
  if (scaledBounds) {
    const sizeX = scaledBounds.max.x - scaledBounds.min.x;
    const sizeY = scaledBounds.max.y - scaledBounds.min.y;
    const sizeZ = scaledBounds.max.z - scaledBounds.min.z;
    const denom = Math.max(sizeX, sizeY, 1e-6);
    depthRatio = sizeZ / denom;
    // Recompute UVs based on transformed geometry bounds for texture mapping
    const uvAttr = geometry.getAttribute("uv");
    const posAttr = geometry.getAttribute("position");
    if (uvAttr && posAttr) {
      const uvArray = uvAttr.array;
      const posArray = posAttr.array;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posArray[i * 3];
        const y = posArray[i * 3 + 1];
        // Map position to UV in [0,1] range based on bounding box
        const u = (x - scaledBounds.min.x) / sizeX;
        const v = (y - scaledBounds.min.y) / sizeY;
        uvArray[i * 2] = u;
        uvArray[i * 2 + 1] = v;
      }
      uvAttr.needsUpdate = true;
    }
  }
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
      opacity: 0.85,
      depthTest: false,
    });
    terrainGroup = new THREE.Group();
    terrainGroup.frustumCulled = false;
    terrainGroup.renderOrder = 2;
    const minX = scaledBounds.min.x;
    terrainRangeX = scaledBounds.max.x - scaledBounds.min.x || 1;
    terrainTopZ = scaledBounds.max.z + 0.08;
    terrainBaseHeight = 0.04;
    terrainMaxHeight = 0.7;
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
      const weight = 0.15 + hash2(x, y) * 0.85;
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
    depthRatio,
  };
  return mesh;
};

const startThreeRender = () => {
  if (!threeApi) return;
  const renderLoop = () => {
    if (!threeApi) return;
    if (threeApi.mesh && !isThreeDragging) {
      threeApi.mesh.rotation.z += 0.002;
      const inertia = applyInertiaRotation(
        threeApi.mesh,
        stateInertiaX,
        stateInertiaY,
        { min: -1.6, max: -0.2 }
      );
      stateInertiaX = inertia.x;
      stateInertiaY = inertia.y;
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

const startSigilRender = () => {
  if (!sigilThreeApi) return;
  const renderLoop = () => {
    if (!sigilThreeApi) return;
    const comet = sigilThreeApi.mesh?.userData?.comet;
    if (comet) updateSigilComet(comet);
    if (sigilThreeApi.mesh && !isSigilDragging) {
      sigilThreeApi.mesh.rotation.z += 0.002;
      const inertia = applyInertiaRotation(
        sigilThreeApi.mesh,
        sigilInertiaX,
        sigilInertiaY,
        { min: -1.6, max: -0.2 }
      );
      sigilInertiaX = inertia.x;
      sigilInertiaY = inertia.y;
    }
    sigilThreeApi.renderer.render(sigilThreeApi.scene, sigilThreeApi.camera);
    sigilThreeApi.frameId = requestAnimationFrame(renderLoop);
  };
  if (sigilThreeApi.frameId) cancelAnimationFrame(sigilThreeApi.frameId);
  sigilThreeApi.frameId = requestAnimationFrame(renderLoop);
};

const stopSigilRender = () => {
  if (!sigilThreeApi) return;
  if (sigilThreeApi.frameId) cancelAnimationFrame(sigilThreeApi.frameId);
  sigilThreeApi.frameId = null;
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
  // Reset inertia when loading new state
  stateInertiaX = 0;
  stateInertiaY = 0;
  const mesh = buildStateMesh(stateId, api.THREE);
  if (!mesh) return;
  api.scene.add(mesh);
  api.mesh = mesh;
  // Apply texture to the face material (top surface beneath grid)
  const bgTexture = await loadBgTexture(stateId, api.THREE);
  if (bgTexture && Array.isArray(mesh.material) && mesh.material[0]) {
    const faceMat = mesh.material[0];
    bgTexture.repeat.set(2, 2);
    faceMat.map = bgTexture;
    faceMat.color.setHex(0xffffff);
    faceMat.emissive.setHex(0x000000);
    faceMat.emissiveIntensity = 0;
    faceMat.needsUpdate = true;
  }
  mapPane.classList.add("is-3d");
  threeStack?.setAttribute("aria-hidden", "false");
  threeToggle?.setAttribute("aria-hidden", "false");
  stateCanvas?.setAttribute("aria-hidden", "false");
  resizeThree();
  setThreeView(activeThreeView);
};

const hideState3D = () => {
  if (!mapPane) return;
  mapPane.classList.remove("is-3d");
  mapPane.classList.remove("is-3d-state", "is-3d-sigil");
  threeStack?.setAttribute("aria-hidden", "true");
  threeToggle?.setAttribute("aria-hidden", "true");
  stateCanvas?.setAttribute("aria-hidden", "true");
  isThreeDragging = false;
  stateInertiaX = 0;
  stateInertiaY = 0;
  hideSigil3D();
  if (!threeApi) return;
  if (threeApi.mesh) {
    threeApi.scene.remove(threeApi.mesh);
    disposeThreeObject(threeApi.mesh);
    threeApi.mesh = null;
  }
  stopThreeRender();
};

const showSigil3D = async (stateId) => {
  if (!stateId || !mapPane || !sigilCanvas) return;
  const sigilHref = sigilsByState.get(String(stateId));
  if (!sigilHref) {
    const sigilButton = threeToggle?.querySelector("[data-3d-target='sigil']");
    sigilButton?.setAttribute("disabled", "");
    if (activeThreeView === "sigil") setThreeView("state");
    hideSigil3D();
    return;
  }
  const sigilButton = threeToggle?.querySelector("[data-3d-target='sigil']");
  sigilButton?.removeAttribute("disabled");
  sigilLoadToken += 1;
  const token = sigilLoadToken;
  const api = await initSigilThree();
  if (!api || token !== sigilLoadToken) return;
  if (api.mesh) {
    api.scene.remove(api.mesh);
    disposeThreeObject(api.mesh);
    api.mesh = null;
  }
  // Reset inertia when loading new sigil
  sigilInertiaX = 0;
  sigilInertiaY = 0;
  let mesh = null;
  const depthRatio = threeApi?.mesh?.userData?.depthRatio;
  try {
    mesh = await buildSigilMesh(stateId, sigilHref, api.THREE, depthRatio);
  } catch (error) {
    console.warn("Failed to build sigil mesh", error);
    return;
  }
  if (!mesh || token !== sigilLoadToken) return;
  api.scene.add(mesh);
  api.mesh = mesh;
  mapPane.classList.add("is-3d");
  threeStack?.setAttribute("aria-hidden", "false");
  threeToggle?.setAttribute("aria-hidden", "false");
  sigilCanvas?.setAttribute("aria-hidden", "false");
  resizeSigilThree();
  setThreeView(activeThreeView);
};

const hideSigil3D = () => {
  sigilLoadToken += 1;
  sigilCanvas?.setAttribute("aria-hidden", "true");
  isSigilDragging = false;
  sigilInertiaX = 0;
  sigilInertiaY = 0;
  if (!sigilThreeApi) return;
  if (sigilThreeApi.mesh) {
    sigilThreeApi.scene.remove(sigilThreeApi.mesh);
    disposeThreeObject(sigilThreeApi.mesh);
    sigilThreeApi.mesh = null;
  }
  stopSigilRender();
};

const handleThreePointerDown = (event) => {
  if (!stateCanvas || !mapPane?.classList.contains("is-3d")) return;
  if (activePointerId !== null) return;
  activePointerId = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  isThreeDragging = true;
  stateInertiaX = 0;
  stateInertiaY = 0;
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
  stateInertiaX = deltaY * speed;
  stateInertiaY = deltaX * speed;
};

const handleThreePointerUp = (event) => {
  if (activePointerId !== event.pointerId) return;
  activePointerId = null;
  isThreeDragging = false;
  stateCanvas?.releasePointerCapture?.(event.pointerId);
};

const handleSigilPointerDown = (event) => {
  if (!sigilCanvas || !mapPane?.classList.contains("is-3d")) return;
  if (sigilPointerId !== null) return;
  sigilPointerId = event.pointerId;
  sigilLastPointerX = event.clientX;
  sigilLastPointerY = event.clientY;
  isSigilDragging = true;
  sigilInertiaX = 0;
  sigilInertiaY = 0;
  sigilCanvas.setPointerCapture?.(event.pointerId);
};

const handleSigilPointerMove = (event) => {
  if (!sigilThreeApi?.mesh) return;
  if (sigilPointerId !== event.pointerId) return;
  const deltaX = event.clientX - sigilLastPointerX;
  const deltaY = event.clientY - sigilLastPointerY;
  sigilLastPointerX = event.clientX;
  sigilLastPointerY = event.clientY;
  const speed = 0.004;
  const nextX = sigilThreeApi.mesh.rotation.x + deltaY * speed;
  const nextY = sigilThreeApi.mesh.rotation.y + deltaX * speed;
  sigilThreeApi.mesh.rotation.x = Math.max(-1.6, Math.min(-0.2, nextX));
  sigilThreeApi.mesh.rotation.y = nextY;
  sigilInertiaX = deltaY * speed;
  sigilInertiaY = deltaX * speed;
};

const handleSigilPointerUp = (event) => {
  if (sigilPointerId !== event.pointerId) return;
  sigilPointerId = null;
  isSigilDragging = false;
  sigilCanvas?.releasePointerCapture?.(event.pointerId);
};

if (stateCanvas) {
  stateCanvas.addEventListener("pointerdown", handleThreePointerDown);
  stateCanvas.addEventListener("pointermove", handleThreePointerMove);
  stateCanvas.addEventListener("pointerup", handleThreePointerUp);
  stateCanvas.addEventListener("pointercancel", handleThreePointerUp);
  stateCanvas.addEventListener("pointerleave", handleThreePointerUp);
}

if (sigilCanvas) {
  sigilCanvas.addEventListener("pointerdown", handleSigilPointerDown);
  sigilCanvas.addEventListener("pointermove", handleSigilPointerMove);
  sigilCanvas.addEventListener("pointerup", handleSigilPointerUp);
  sigilCanvas.addEventListener("pointercancel", handleSigilPointerUp);
  sigilCanvas.addEventListener("pointerleave", handleSigilPointerUp);
}

threeToggleButtons?.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.getAttribute("data-3d-target");
    setThreeView(target);
  });
});

const setSplitLayout = (isSplit) => {
  if (!app || !infoPane) return;
  if (isSplit) {
    app.classList.add("is-split");
    infoPane.removeAttribute("aria-hidden");
    backButton?.removeAttribute("hidden");
    hideHoverSigil();
  } else {
    app.classList.remove("is-split");
    infoPane.setAttribute("aria-hidden", "true");
    backButton?.setAttribute("hidden", "");
  }
};

const setThreeView = (mode) => {
  if (!mapPane) return;
  const nextMode = mode === "sigil" ? "sigil" : "state";
  activeThreeView = nextMode;
  mapPane.classList.toggle("is-3d-state", nextMode === "state");
  mapPane.classList.toggle("is-3d-sigil", nextMode === "sigil");
  threeToggleButtons?.forEach((button) => {
    const target = button.getAttribute("data-3d-target");
    button.setAttribute("aria-pressed", target === nextMode ? "true" : "false");
  });
  // Reset drag states when switching views to avoid stuck pointer captures
  if (activePointerId !== null && stateCanvas) {
    stateCanvas.releasePointerCapture?.(activePointerId);
  }
  if (sigilPointerId !== null && sigilCanvas) {
    sigilCanvas.releasePointerCapture?.(sigilPointerId);
  }
  isThreeDragging = false;
  isSigilDragging = false;
  activePointerId = null;
  sigilPointerId = null;
  if (nextMode === "state") {
    startThreeRender();
    stopSigilRender();
  } else {
    startSigilRender();
    stopThreeRender();
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
    if (hourglassPlayer) {
      hourglassPlayer.dispose();
      hourglassPlayer = null;
    }
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    stopAudioReactive();
    return;
  }
  if (!geojsonData) {
    infoContent.innerHTML = `<div class="info-body">Loading details...</div>`;
    return;
  }
  const count = stateCounts.get(String(stateId)) ?? 0;
  const trackId = trackByState.get(String(stateId));
  const track = trackId ? trackById.get(trackId) : null;
  const trackMarkup = track
    ? `<div class="track-card">
        <div class="track-label">Now playing</div>
        <div class="track-title">${track.title}</div>
        <div class="hourglass-player" data-track-player></div>
        <audio class="track-audio" preload="metadata" src="${encodeURI(track.file)}"></audio>
      </div>`
    : '<div class="track-card is-empty">No track assigned.</div>';
  infoContent.innerHTML = trackMarkup;
  const audio = infoContent.querySelector(".track-audio");
  if (audio instanceof HTMLAudioElement) {
    if (activeAudio && activeAudio !== audio) {
      activeAudio.pause();
    }
    activeAudio = audio;
    const player = infoContent.querySelector("[data-track-player]");
    setupTrackPlayer(player, audio);
  } else {
    if (hourglassPlayer) {
      hourglassPlayer.dispose();
      hourglassPlayer = null;
    }
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
  
  const skipQuestion = options.skipQuestion || hasBeenQuestioned(normalized);
  
  activeThreeView = "state";
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
  
  // Show question immediately if this is first visit
  if (!skipQuestion) {
    // Use requestAnimationFrame to ensure info is rendered first
    requestAnimationFrame(() => {
      showQuestionModal(normalized);
    });
  }
  
  setSplitLayout(true);
  showState3D(normalized);
  showSigil3D(normalized);
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

const showQuestionModal = (stateId) => {
  const neighbors = getNeighbors(stateId);
  let unrevealedNeighbors = neighbors.filter((n) => !isStateRevealed(n));
  
  // If no unrevealed neighbors, find any unrevealed state from all states
  if (unrevealedNeighbors.length === 0) {
    // Get all states from stateCounts
    const allStates = Array.from(stateCounts.keys());
    unrevealedNeighbors = allStates.filter((s) => s !== "0" && !isStateRevealed(s));
    
    // If all states are revealed, mark as questioned, celebrate, and return
    if (unrevealedNeighbors.length === 0) {
      markAsQuestioned(stateId);
      celebrateMapCompletion();
      return;
    }
  }
  
  // Pick up to 2 random unrevealed states
  const shuffled = unrevealedNeighbors.sort(() => Math.random() - 0.5);
  const option1 = shuffled[0];
  const option2 = shuffled[1] || shuffled[0]; // Duplicate if only 1 option
  
  // Append question to existing info panel content
  if (!infoContent) return;
  
  const questionMarkup = `
    <div class="question-container">
      <div class="question-prompt">
        <p class="question-text">Which direction do you explore?</p>
      </div>
      <div class="question-answers">
        <button class="answer-btn" data-answer="${option1}" type="button">Explore territory ${option1}</button>
        <button class="answer-btn" data-answer="${option2}" type="button">Explore territory ${option2}</button>
      </div>
    </div>
  `;
  
  infoContent.insertAdjacentHTML('beforeend', questionMarkup);
  
  // Add click handlers to answer buttons
  const answerButtons = infoContent.querySelectorAll(".answer-btn");
  answerButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const answer = btn.dataset.answer;
      if (answer) handleAnswer(answer, stateId);
    });
  });
};

const hideQuestionModal = () => {
  // Questions now render in info panel, so this just ensures modal stays hidden
  if (questionModal) {
    questionModal.setAttribute("aria-hidden", "true");
  }
};

const celebrateMapCompletion = () => {
  // Show confetti with themed colors
  if (typeof confetti === "function") {
    const colors = ["#bdff00", "#e8ffb2", "#b8d982"];

    // Fire multiple bursts for a more celebratory effect
    const fire = (particleRatio, opts) => {
      confetti({
        origin: { y: 0.7 },
        colors,
        ...opts,
        particleCount: Math.floor(200 * particleRatio),
      });
    };

    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });

    // Additional side bursts after a delay
    setTimeout(() => {
      confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });
    }, 250);
  }

  // Show the info button
  if (infoButton) {
    infoButton.classList.add("is-visible");
  }
};
window.celebrateMapCompletion = celebrateMapCompletion; // dev testing

const showCreditsModal = () => {
  if (creditsModal) {
    creditsModal.setAttribute("aria-hidden", "false");
  }
};

const hideCreditsModal = () => {
  if (creditsModal) {
    creditsModal.setAttribute("aria-hidden", "true");
  }
};

const handleAnswer = (revealedStateId, currentStateId) => {
  // Reveal the selected state
  revealState(revealedStateId);
  
  // Mark current state as questioned
  markAsQuestioned(currentStateId);
  
  // Update fog on map
  if (mapApi?.applyFog) {
    mapApi.applyFog(revealedStates);
  }
  // Update texture canvas
  if (textureCanvas) {
    textureCanvas.syncWithSvg();
  }

  // Remove question container without re-rendering (to keep audio playing)
  const questionContainer = infoContent?.querySelector('.question-container');
  if (questionContainer) {
    questionContainer.remove();
  }
};

const clearSelection = (options = {}) => {
  const stateId = activeStateId;
  const previousBox = lastSelectedViewBox;
  
  // Clear question timeout and hide modal
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }
  hideQuestionModal();
  
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

    // Initialize texture canvas for patchwork effect
    const stateOutlines = mapApi.getStateOutlines();
    if (stateOutlines && mapPane && svg) {
      textureCanvas = createTextureCanvas({
        container: mapPane,
        svg,
        stateOutlines,
      });
      await textureCanvas.loadTextures();

      // Sync canvas on viewBox changes
      const viewBoxObserver = new MutationObserver(() => {
        textureCanvas?.syncWithSvg();
      });
      viewBoxObserver.observe(svg, { attributes: true, attributeFilter: ["viewBox"] });
    }

    // Initialize fog of war system
    buildStateNeighborMap(geojson);
    if (mapApi?.applyFog) {
      mapApi.applyFog(revealedStates);
    }
    // Initial texture canvas render
    if (textureCanvas && fullViewBox) {
      textureCanvas.render(revealedStates, fullViewBox);
    }
    
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
        // Check if state is revealed before allowing selection
        if (isStateRevealed(stateId)) {
          const skipQuestion = hasBeenQuestioned(stateId);
          selectState(stateId, { skipQuestion });
        }
      }
      return;
    }
    node = node.parentNode;
  }
});

svg?.addEventListener("pointerdown", (event) => {
  if (app?.classList.contains("is-split")) return;
  let node = event.target;
  while (node && node !== svg) {
    if (node.classList && node.classList.contains("cell")) {
      const stateId = node.dataset.state;
      showHoverSigil(stateId);
      return;
    }
    node = node.parentNode;
  }
});

svg?.addEventListener("pointermove", (event) => {
  if (app?.classList.contains("is-split")) return;
  if (svg?.classList.contains("is-collapsed")) return;
  let node = event.target;
  while (node && node !== svg) {
    if (node.classList && node.classList.contains("cell")) {
      const stateId = node.dataset.state;
      showHoverSigil(stateId);
      textureCanvas?.setHoveredState(stateId);
      return;
    }
    node = node.parentNode;
  }
  hideHoverSigil();
  textureCanvas?.setHoveredState(null);
});

svg?.addEventListener("pointerleave", () => {
  hideHoverSigil();
  textureCanvas?.setHoveredState(null);
});

backButton?.addEventListener("click", (event) => {
  event.preventDefault();
  clearSelection();
});

window.addEventListener("resize", () => {
  resizeThree();
  resizeSigilThree();
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

// Info button and credits modal event listeners
infoButton?.addEventListener("click", () => {
  showCreditsModal();
});

creditsClose?.addEventListener("click", () => {
  hideCreditsModal();
});

creditsModal?.addEventListener("click", (event) => {
  // Close on backdrop click
  if (event.target === creditsModal) {
    hideCreditsModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && creditsModal?.getAttribute("aria-hidden") === "false") {
    hideCreditsModal();
  }
});

init();
