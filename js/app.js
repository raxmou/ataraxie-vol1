import { getLang, setLang, t, getDragPhrases, getTracksUrl, applyStaticTranslations } from "./i18n.js";
import { loadGeoJSON, loadSigils, loadTracks } from "./data.js";
import { createMap, createStateColor } from "./map.js";
import { createViewBoxAnimator, createTransformAnimator } from "./viewbox.js";
import { createTextureCanvas } from "./texture-canvas.js";
import { createHourglassPlayer } from "./hourglass-player.js";
import { createCharacterDancer } from "./character-dancer.js";
import { createInfoPaneGesture } from "./info-pane-gesture.js";
import { createMapGestures } from "./map-gestures.js";
import {
  revealedStates,
  questionedStates,
  isStateRevealed,
  hasBeenQuestioned,
  markAsQuestioned,
  revealState,
  getNeighbors,
  buildStateNeighborMap,
  explorationTrails,
  explorationOrder,
  addTrail,
} from "./fog.js";

/* ── request fullscreen on first user gesture (mobile) ── */
if (/Mobi|Android/i.test(navigator.userAgent)) {
  const goFS = () => {
    const el = document.documentElement;
    const rfs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (rfs) rfs.call(el).catch(() => {});
  };
  document.addEventListener("pointerdown", goFS, { once: true });
}

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
const aboutModal = document.getElementById("about-modal");
const aboutClose = document.getElementById("about-close");
const characterSelect = document.getElementById("character-select");
const characterConfirm = document.getElementById("character-confirm");
const characterCards = document.querySelectorAll(".character-card[data-character]");
const aboutChangeCharacter = document.getElementById("about-change-character");
const stateCanvas = document.getElementById("state-3d-canvas");
const threeStack = document.getElementById("state-3d-stack");
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
let colorForState = null;
let textureCanvas = null;
let sigilsByState = new Map();
let sigilLayer = null;
let focusSigilLayer = null;
let hoverSigilImage = null;
let hoverSigilStateId = null;
let hoverSigilToken = 0;
let audioContext = null;
let audioAnalyser = null;
let audioData = null;
let audioAnimationFrame = null;
let audioSource = null;
let audioElement = null;
let audioTime = 0;
let ambientAnimationFrame = null;
let ambientTime = 0;
let hourglassPlayer = null;
let pendingTrail = null; // Stores {from, to} for deferred trail drawing
let answeredQuestions = new Map(); // Stores stateId -> {option1, option2, chosen}
let isThreeDragging = false;
let activePointerId = null;
let lastPointerX = 0;
let lastPointerY = 0;
let stateInertiaX = 0;
let stateInertiaY = 0;
let isMorphing = false;
let questionTimeout = null;
let bgTextureCache = new Map();
let selectedCharacter = null;
// Map view character (SVG image on trail layer)
let mapCharacter = null;
let mapCharacterFrameIdx = 0;
let mapCharacterInterval = null;
let mapCharacterStateId = null;
let mapCharacterBarkTimers = [];
let mapCharacterBark = null;
// State view character (HTML img in info pane)
let stateCharacter = null;
let stateCharFrameIdx = 0;
let stateCharInterval = null;
let stateCharFloatRAF = null;
let stateCharFloatStart = 0;
let stateCharDragging = false;
let infoPaneGesture = null;
let mapGestures = null;
const mobileMediaQuery = matchMedia("(max-width: 900px)");

const stateTextureFiles = [
  "assets/textures/VISUALWORKS1 6.png",
  "assets/textures/VISUALWORKS14 1.png",
  "assets/textures/VISUALWORKS23.png",
  "assets/textures/VISUALWORKS25 2.png",
  "assets/textures/VISUALWORKS32 2.png",
  "assets/textures/VISUALWORKS33 1.png",
  "assets/textures/VISUALWORKS36 1.png",
  "assets/textures/VISUALWORKS41 1.png",
  "assets/textures/VISUALWORKS54 1.png",
  "assets/textures/VISUALWORKS57 1.png",
  "assets/textures/VISUALWORKS58 1.png",
];

const getTextureIndexForState = (stateId) =>
  Number(stateId) - 1;

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
    terrainEnergy,
  } = threeApi.mesh.userData || {};
  if (edgeMaterial && edgeBaseColor) {
    edgeMaterial.color.copy(edgeBaseColor);
    edgeMaterial.opacity = 0.55;
  }
  if (edgeBasePositions && edgePositionAttr) {
    edgePositionAttr.array.set(edgeBasePositions);
    edgePositionAttr.needsUpdate = true;
  }
  if (Array.isArray(terrainData) && terrainBaseHeight != null && terrainTopZ != null) {
    terrainData.forEach((cell) => {
      (cell.meshes || []).forEach((mesh) => {
        mesh.position.z = terrainTopZ;
        mesh.scale.z = terrainBaseHeight;
      });
    });
    if (terrainHeights) terrainHeights.fill(terrainBaseHeight);
    if (terrainEnergy) terrainEnergy.fill(0);
  }
};

const stopAudioReactive = () => {
  if (audioAnimationFrame) cancelAnimationFrame(audioAnimationFrame);
  audioAnimationFrame = null;
  resetAudioVisuals();
  startAmbientBreathing();

};

const startAmbientBreathing = () => {
  if (ambientAnimationFrame) return;
  const tick = () => {
    ambientTime += 0.016;
    const is3d = mapPane?.classList.contains("is-3d");
    if (is3d && threeApi?.mesh) {
      const {
        terrainData, terrainTopZ, terrainBaseHeight,
        terrainMaxHeight, terrainHeights, terrainNeighbors,
      } = threeApi.mesh.userData || {};
      if (Array.isArray(terrainData) && terrainBaseHeight != null) {
        const rawHeights = new Float32Array(terrainData.length);
        terrainData.forEach((cell, index) => {
          rawHeights[index] = computeBreathingHeight(
            cell, ambientTime, terrainBaseHeight, terrainMaxHeight
          );
        });
        terrainData.forEach((cell, index) => {
          const neighbors = terrainNeighbors ? terrainNeighbors[index] : null;
          let nSum = 0, nCount = 0;
          if (neighbors && neighbors.length) {
            neighbors.forEach((ni) => { nSum += rawHeights[ni]; nCount++; });
          }
          const nAvg = nCount ? nSum / nCount : rawHeights[index];
          const smoothed = rawHeights[index] * 0.7 + nAvg * 0.3;
          const current = terrainHeights ? terrainHeights[index] : smoothed;
          const blended = current + (smoothed - current) * 0.08;
          if (terrainHeights) terrainHeights[index] = blended;
          (cell.meshes || []).forEach((m) => {
            m.position.z = terrainTopZ;
            m.scale.z = blended;
          });
        });
      }
    }
    ambientAnimationFrame = requestAnimationFrame(tick);
  };
  ambientAnimationFrame = requestAnimationFrame(tick);
};

const stopAmbientBreathing = () => {
  if (ambientAnimationFrame) cancelAnimationFrame(ambientAnimationFrame);
  ambientAnimationFrame = null;
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
  stopAmbientBreathing();

  // Initialize kick detector
  // TODO: Get threshold/cooldown from track metadata if available
  const tick = () => {
    if (!audioAnalyser || !audioData) return;
    audioAnalyser.getByteFrequencyData(audioData);
    audioTime += 0.016;

    const totalBins = audioData.length;
    const lowEnd = Math.max(1, Math.floor(totalBins * 0.2));
    const highStart = Math.floor(totalBins * 0.7);
    let lowSum = 0, highSum = 0;
    for (let i = 0; i < lowEnd; i++) lowSum += audioData[i];
    for (let i = highStart; i < totalBins; i++) highSum += audioData[i];
    const low = lowSum / (lowEnd * 255);
    const high = highSum / ((totalBins - highStart) * 255);
    const intensity = Math.min(1, (low + high) / 2);
    const stroke = 0.6 + intensity * 1.8;
    const glow = intensity * 10;
    const opacity = 0.45 + intensity * 0.5;

    const is3d = mapPane?.classList.contains("is-3d");
    if (is3d && threeApi?.mesh) {
      const {
        terrainData, terrainTopZ, terrainBaseHeight, terrainMaxHeight,
        terrainNeighbors, terrainHeights, terrainEnergy,
      } = threeApi.mesh.userData || {};

      if (Array.isArray(terrainData) && terrainBaseHeight != null && terrainMaxHeight != null) {
        const maxBin = audioData.length - 1;
        const rawHeights = new Float32Array(terrainData.length);

        // Pass 1: ambient breathing + Gaussian audio response per cell
        terrainData.forEach((cell, index) => {
          const breathe = computeBreathingHeight(
            cell, audioTime, terrainBaseHeight, terrainMaxHeight
          );
          const audioAmp = computeAudioResponse(cell, audioData, maxBin);
          rawHeights[index] = breathe + audioAmp * terrainMaxHeight * cell.weight * 0.7;
        });

        // Pass 2: wave propagation
        if (terrainEnergy) {
          terrainData.forEach((cell, index) => {
            const e = rawHeights[index] - terrainBaseHeight;
            terrainEnergy[index] = Math.max(terrainEnergy[index] * 0.85, e);
          });
          terrainData.forEach((cell, index) => {
            const neighbors = terrainNeighbors ? terrainNeighbors[index] : null;
            if (!neighbors || !neighbors.length) return;
            let ne = 0;
            neighbors.forEach((ni) => { ne += terrainEnergy[ni]; });
            rawHeights[index] += (ne / neighbors.length) * 0.12;
          });
        }

        // Pass 3: spatial smooth + per-cell attack/decay envelope
        terrainData.forEach((cell, index) => {
          const neighbors = terrainNeighbors ? terrainNeighbors[index] : null;
          let nSum = 0, nCount = 0;
          if (neighbors && neighbors.length) {
            neighbors.forEach((ni) => { nSum += rawHeights[ni]; nCount++; });
          }
          const nAvg = nCount ? nSum / nCount : rawHeights[index];
          const smoothed = rawHeights[index] * 0.6 + nAvg * 0.4;
          const current = terrainHeights ? terrainHeights[index] : smoothed;
          const blend = smoothed > current ? cell.attackSpeed : cell.decaySpeed;
          const blended = current + (smoothed - current) * blend;
          if (terrainHeights) terrainHeights[index] = blended;
          (cell.meshes || []).forEach((m) => {
            m.position.z = terrainTopZ;
            m.scale.z = blended;
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
    camera.position.set(0, 0, 4.5);
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

const valueNoise2D = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(ix, iy);
  const v10 = hash2(ix + 1, iy);
  const v01 = hash2(ix, iy + 1);
  const v11 = hash2(ix + 1, iy + 1);
  return (v00 + (v10 - v00) * sx) * (1 - sy)
       + (v01 + (v11 - v01) * sx) * sy;
};

const fbmNoise2D = (x, y, octaves = 3) => {
  let value = 0, amp = 0.5, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return value / max;
};

const computeBreathingHeight = (cell, time, baseHeight, maxHeight) => {
  const breath = fbmNoise2D(
    cell.x * 0.8 + time * 0.12,
    cell.y * 0.8 + time * 0.09,
    2
  );
  const ripple = fbmNoise2D(
    cell.x * 2.5 + time * 0.35,
    cell.y * 2.5 - time * 0.28,
    2
  );
  const shimmer = valueNoise2D(
    cell.x * 6.0 + time * 0.8,
    cell.y * 6.0 + time * 0.6
  );
  const envelope = 0.5 + 0.5 * Math.sin(time * 0.4 + cell.breathePhase);
  const combined = breath * 0.6 + ripple * 0.25 + shimmer * 0.15;
  const breatheAmp = maxHeight * 0.3 * cell.weight;
  return baseHeight + combined * breatheAmp * (0.7 + envelope * 0.3);
};

const computeAudioResponse = (cell, audioData, maxBin) => {
  const centerBin = cell.freqCenter * maxBin;
  const sigma = cell.freqWidth * maxBin;
  const sigmaSq2 = 2 * sigma * sigma;
  const lo = Math.max(0, Math.floor(centerBin - sigma * 2));
  const hi = Math.min(maxBin, Math.ceil(centerBin + sigma * 2));
  let wSum = 0, wTotal = 0;
  for (let b = lo; b <= hi; b++) {
    const d = b - centerBin;
    const g = Math.exp(-(d * d) / sigmaSq2);
    wSum += (audioData[b] / 255) * g;
    wTotal += g;
  }
  const amp = wTotal > 0 ? wSum / wTotal : 0;
  return Math.pow(amp, 1.8) * cell.sensitivity;
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
  let terrainRangeY = null;
  let terrainSize = null;
  let terrainNeighbors = null;
  let terrainHeights = null;
  let terrainEnergy = null;
  if (scaledBounds && cells.length) {
    const avgWidth = cells.reduce((sum, item) => sum + item.width, 0) / cells.length;
    const avgHeight = cells.reduce((sum, item) => sum + item.height, 0) / cells.length;
    terrainSize = Math.max(0.02, Math.min(avgWidth, avgHeight) * scale * 0.7);
    const terrainMat = new THREE.LineBasicMaterial({
      color: 0xbdff00,
      transparent: true,
      opacity: 0.85,
    });
    terrainGroup = new THREE.Group();
    terrainGroup.frustumCulled = false;
    terrainGroup.renderOrder = 2;
    const minX = scaledBounds.min.x;
    const minY = scaledBounds.min.y;
    terrainRangeX = scaledBounds.max.x - scaledBounds.min.x || 1;
    terrainRangeY = scaledBounds.max.y - scaledBounds.min.y || 1;
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
      const freqCenter = xNorm * 0.93 + hash2(x * 3.1, y * 7.3) * 0.07;
      const freqWidth = 0.05 + hash2(x * 5.7, y * 2.3) * 0.06;
      const attackSpeed = 0.5 + hash2(x * 1.3, y * 4.7) * 0.4;
      const decaySpeed = 0.08 + hash2(x * 6.1, y * 1.9) * 0.17;
      const sensitivity = 0.8 + hash2(x * 8.3, y * 3.1) * 0.4;
      const breathePhase = hash2(x * 2.7, y * 9.1) * Math.PI * 2;
      terrainData.push({
        meshes, x, y, xNorm, weight, gridX, gridY,
        freqCenter, freqWidth,
        attackSpeed, decaySpeed, sensitivity, breathePhase,
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
    terrainEnergy = new Float32Array(terrainData.length);
    mesh.add(terrainGroup);
  }
  // Easter egg: track info on the back face
  const trackId = trackByState.get(String(stateId));
  const track = trackId ? trackById.get(trackId) : null;
  let versoBackPlane = null;
  let versoLinks = [];
  if (track && scaledBounds) {
    const parts = track.title.split(" - ");
    const artist = parts[0] || "";
    const title = parts.slice(1).join(" - ") || track.title;
    const cvs = document.createElement("canvas");
    cvs.width = 512;
    cvs.height = 256;
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8ffb2";
    ctx.font = '36px "Sinistre Regular", "Trebuchet MS", "Gill Sans", sans-serif';
    ctx.letterSpacing = "4px";
    ctx.fillText(title, cvs.width / 2, 110, cvs.width - 40);
    ctx.fillStyle = "rgba(189,255,0,0.55)";
    ctx.font = '24px "Sinistre Regular", "Trebuchet MS", "Gill Sans", sans-serif';
    ctx.letterSpacing = "6px";
    ctx.fillText(artist.toUpperCase(), cvs.width / 2, 160, cvs.width - 40);
    // Draw Bandcamp & Instagram icons below artist text
    const iconSize = 32;
    const iconY = 200;
    const iconColor = "#e8ffb2";
    const iconLinks = [];
    if (track.bandcamp) {
      const bx = cvs.width / 2 - 56;
      ctx.save();
      ctx.fillStyle = iconColor;
      ctx.beginPath();
      // Bandcamp parallelogram icon
      ctx.moveTo(bx, iconY);
      ctx.lineTo(bx + iconSize * 0.6, iconY);
      ctx.lineTo(bx + iconSize, iconY + iconSize);
      ctx.lineTo(bx + iconSize * 0.4, iconY + iconSize);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      iconLinks.push({
        uMin: bx / cvs.width,
        uMax: (bx + iconSize) / cvs.width,
        vMin: 1 - (iconY + iconSize) / cvs.height,
        vMax: 1 - iconY / cvs.height,
        url: track.bandcamp,
      });
    }
    if (track.instagram) {
      const ix = cvs.width / 2 + 24;
      ctx.save();
      ctx.strokeStyle = iconColor;
      ctx.fillStyle = iconColor;
      const cx = ix + iconSize / 2;
      const cy = iconY + iconSize / 2;
      const s = iconSize;
      // Outer rounded rectangle — generous radius like the real logo (~35% of size)
      const outerR = s * 0.32;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(ix + outerR, iconY);
      ctx.lineTo(ix + s - outerR, iconY);
      ctx.arcTo(ix + s, iconY, ix + s, iconY + outerR, outerR);
      ctx.lineTo(ix + s, iconY + s - outerR);
      ctx.arcTo(ix + s, iconY + s, ix + s - outerR, iconY + s, outerR);
      ctx.lineTo(ix + outerR, iconY + s);
      ctx.arcTo(ix, iconY + s, ix, iconY + s - outerR, outerR);
      ctx.lineTo(ix, iconY + outerR);
      ctx.arcTo(ix, iconY, ix + outerR, iconY, outerR);
      ctx.closePath();
      ctx.stroke();
      // Lens circle — radius ~33% of icon
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      // Flash dot — top-right, small filled circle
      ctx.beginPath();
      ctx.arc(ix + s * 0.76, iconY + s * 0.24, s * 0.065, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      iconLinks.push({
        uMin: ix / cvs.width,
        uMax: (ix + iconSize) / cvs.width,
        vMin: 1 - (iconY + iconSize) / cvs.height,
        vMax: 1 - iconY / cvs.height,
        url: track.instagram,
      });
    }
    versoLinks = iconLinks;
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sX = scaledBounds.max.x - scaledBounds.min.x;
    const sY = scaledBounds.max.y - scaledBounds.min.y;
    const planeW = Math.min(sX, sY) * 0.7;
    const planeH = planeW * 0.5;
    const backPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide })
    );
    backPlane.rotation.y = Math.PI;
    backPlane.position.z = scaledBounds.min.z - 0.02;
    mesh.add(backPlane);
    versoBackPlane = backPlane;

    // Random image on a separate plane, offset away from the state shape
    const versoImages = [
      "5b1a4325b73c31889926ea89564b9e04.jpg",
      "northlandscapes-iceland-tidal-glitch-01.jpg",
      "1000_F_248110301_ON8MMUUAmDMyUSd4x2BblieSpquwdOXr.jpg",
      "Capture-d'écran-2017-02-23-à-08.53.06-1160x769.png",
      "image (4).jpg",
      "cc7f66c4172364926f5d0ccc3ba8f2e0.jpg",
      "image (3).jpg",
      "1699px-Montreal_-_QC_-_Habitat67_1024x1024.webp",
      "image (2).jpg",
      "3cb0f15caf4d1063bdb183058bcd63e4.jpg",
      "image (1).jpg",
      "7b5bd5915220765cab0fbb32c88079e7.jpg",
      "1450280498071oliver-astrologo-architectural-photography-giuseppe-perugini-ruins-casa-sperimentale-designboom-01.avif",
      "nglkicvkojb91.png",
      "KI-X4010.jpg",
      "images.jpg",
    ];
    const imgFile = versoImages[Math.floor(Math.random() * versoImages.length)];
    const imgLoader = new THREE.TextureLoader();
    imgLoader.load("assets/images/" + imgFile, (imgTex) => {
      imgTex.colorSpace = THREE.SRGBColorSpace;
      const imgW = Math.min(sX, sY) * 0.5;
      const aspect = imgTex.image.naturalHeight / imgTex.image.naturalWidth || 1;
      const imgH = imgW * aspect;
      const imgPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(imgW, imgH),
        new THREE.MeshBasicMaterial({ map: imgTex, transparent: true, side: THREE.FrontSide })
      );
      imgPlane.rotation.y = Math.PI;
      // Position well outside the state shape — offset to the side
      const side = Math.random() < 0.5 ? -1 : 1;
      imgPlane.position.x = side * (sX * 0.5 + imgW * 0.4 + Math.random() * sX * 0.2);
      imgPlane.position.y = (Math.random() - 0.5) * sY * 0.8;
      imgPlane.position.z = scaledBounds.min.z - 0.04;
      mesh.add(imgPlane);
    });
  }

  mesh.rotation.x = -0.85;
  mesh.rotation.y = 0.55;
  const halfDepthZ = scaledBounds ? (scaledBounds.max.z - scaledBounds.min.z) / 2 : 0;
  mesh.userData = {
    terrainGroup,
    terrainData,
    terrainSize,
    terrainTopZ,
    terrainBaseHeight,
    terrainMaxHeight,
    terrainRangeX,
    terrainRangeY,
    terrainNeighbors,
    terrainHeights,
    terrainEnergy,
    faceMaterial,
    sideMaterial,
    baseScale: mesh.scale.clone(),
    depthRatio,
    halfDepthZ,
    backPlane: versoBackPlane,
    versoLinks,
  };
  return mesh;
};

const startThreeRender = () => {
  if (!threeApi) return;
  const renderLoop = () => {
    if (!threeApi) return;
    if (threeApi.mesh && !isThreeDragging && !isMorphing) {
      const speed = hourglassPlayer ? hourglassPlayer.speed : 1;
      threeApi.mesh.rotation.z += 0.002 * speed;
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

  // Prepare flat & face-on for morph transition
  const halfDepthZ = mesh.userData.halfDepthZ || 0;
  mesh.scale.z = 0.01;
  mesh.position.z = halfDepthZ * 0.99;
  mesh.rotation.x = 0;
  mesh.rotation.y = 0;

  // Reset camera to overhead
  api.camera.position.set(0, 0, 4.5);
  api.camera.lookAt(0, 0, 0);

  api.scene.add(mesh);
  api.mesh = mesh;

  // Start render loop so the flat frame is in the buffer, but don't show yet
  resizeThree();
  startThreeRender();

  // Render one frame so the canvas has content for the crossfade
  api.renderer.render(api.scene, api.camera);

  // Load texture in background — don't block the morph
  loadBgTexture(stateId, api.THREE).then((bgTexture) => {
    if (bgTexture && api.mesh === mesh && Array.isArray(mesh.material) && mesh.material[0]) {
      const faceMat = mesh.material[0];
      bgTexture.repeat.set(2, 2);
      faceMat.map = bgTexture;
      faceMat.color.setHex(0xffffff);
      faceMat.emissive.setHex(0x000000);
      faceMat.emissiveIntensity = 0;
      faceMat.needsUpdate = true;
    }
  });
};

const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const morphTo3D = (duration = 500) => {
  return new Promise((resolve) => {
    if (!threeApi?.mesh || !mapPane) {
      resolve();
      return;
    }
    const mesh = threeApi.mesh;
    const halfDepthZ = mesh.userData.halfDepthZ || 0;
    const camera = threeApi.camera;

    mapPane.classList.add("is-3d");
    setThreeView();
    threeStack?.setAttribute("aria-hidden", "false");
    stateCanvas?.setAttribute("aria-hidden", "false");
    setSplitLayout(true);

    if (prefersReducedMotion) {
      mesh.scale.z = 1;
      mesh.position.z = 0;
      mesh.rotation.x = -0.85;
      mesh.rotation.y = 0.55;
      camera.position.set(0, 0.3, 4.2);
      camera.lookAt(0, 0, 0);
      isMorphing = false;
      startAmbientBreathing();
      setAnimating(false);
      resolve();
      return;
    }

    isMorphing = true;
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const raw = Math.min(elapsed / duration, 1);
      const t = easeInOutCubic(raw);

      mesh.scale.z = 0.01 + (1 - 0.01) * t;
      mesh.position.z = halfDepthZ * (1 - mesh.scale.z);
      mesh.rotation.x = -0.85 * t;
      mesh.rotation.y = 0.55 * t;
      camera.position.y = 0.3 * t;
      camera.position.z = 4.5 + (4.2 - 4.5) * t;
      camera.lookAt(0, 0, 0);

      if (raw < 1) {
        requestAnimationFrame(animate);
      } else {
        isMorphing = false;
        startAmbientBreathing();
        setAnimating(false);
        resolve();
      }
    };
    requestAnimationFrame(animate);
  });
};

const morphFrom3D = (duration = 400) => {
  return new Promise((resolve) => {
    if (!threeApi?.mesh || !mapPane) {
      mapPane?.classList.remove("is-3d", "is-3d-state");
      resolve();
      return;
    }
    const mesh = threeApi.mesh;
    const halfDepthZ = mesh.userData.halfDepthZ || 0;
    const camera = threeApi.camera;

    stopAmbientBreathing();

    if (prefersReducedMotion) {
      mapPane.classList.remove("is-3d", "is-3d-state");
      isMorphing = false;
      resolve();
      return;
    }

    isMorphing = true;
    const startRotX = mesh.rotation.x;
    const startRotY = mesh.rotation.y;
    const startScaleZ = mesh.scale.z;
    const startCamY = camera.position.y;
    const startCamZ = camera.position.z;
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const raw = Math.min(elapsed / duration, 1);
      const t = easeInOutCubic(raw);

      mesh.scale.z = startScaleZ + (0.01 - startScaleZ) * t;
      mesh.position.z = halfDepthZ * (1 - mesh.scale.z);
      mesh.rotation.x = startRotX * (1 - t);
      mesh.rotation.y = startRotY * (1 - t);
      camera.position.y = startCamY * (1 - t);
      camera.position.z = startCamZ + (4.5 - startCamZ) * t;
      camera.lookAt(0, 0, 0);

      if (raw < 1) {
        requestAnimationFrame(animate);
      } else {
        isMorphing = false;
        mapPane.classList.remove("is-3d", "is-3d-state");
        threeStack?.setAttribute("aria-hidden", "true");
        stateCanvas?.setAttribute("aria-hidden", "true");
        resolve();
      }
    };
    requestAnimationFrame(animate);
  });
};

const hideState3D = () => {
  if (!mapPane) return;
  stopAmbientBreathing();
  mapPane.classList.remove("is-3d");
  mapPane.classList.remove("is-3d-state");
  threeStack?.setAttribute("aria-hidden", "true");
  stateCanvas?.setAttribute("aria-hidden", "true");
  isThreeDragging = false;
  stateInertiaX = 0;
  stateInertiaY = 0;
  if (!threeApi) return;
  if (threeApi.mesh) {
    threeApi.scene.remove(threeApi.mesh);
    disposeThreeObject(threeApi.mesh);
    threeApi.mesh = null;
  }
  stopThreeRender();
};

let pointerStartX = 0;
let pointerStartY = 0;
let pointerTotalDisplacement = 0;

const raycastVersoLinks = (event) => {
  if (!threeApi?.mesh?.userData?.backPlane || !threeApi.mesh.userData.versoLinks?.length) return null;
  const rect = stateCanvas.getBoundingClientRect();
  const mouse = new threeApi.THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new threeApi.THREE.Raycaster();
  raycaster.setFromCamera(mouse, threeApi.camera);
  const hits = raycaster.intersectObject(threeApi.mesh.userData.backPlane, false);
  if (!hits.length || !hits[0].uv) return null;
  const u = hits[0].uv.x;
  const v = hits[0].uv.y;
  for (const link of threeApi.mesh.userData.versoLinks) {
    if (u >= link.uMin && u <= link.uMax && v >= link.vMin && v <= link.vMax) {
      return link;
    }
  }
  return null;
};

const handleThreePointerDown = (event) => {
  if (!stateCanvas || !mapPane?.classList.contains("is-3d")) return;
  if (activePointerId !== null) return;
  activePointerId = event.pointerId;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pointerTotalDisplacement = 0;
  isThreeDragging = true;
  stateInertiaX = 0;
  stateInertiaY = 0;
  stateCanvas.setPointerCapture?.(event.pointerId);
};

const handleThreePointerMove = (event) => {
  if (!threeApi?.mesh) return;
  // Cursor feedback when not dragging
  if (activePointerId === null && stateCanvas) {
    const link = raycastVersoLinks(event);
    stateCanvas.style.cursor = link ? "pointer" : "grab";
    return;
  }
  if (activePointerId !== event.pointerId) return;
  const deltaX = event.clientX - lastPointerX;
  const deltaY = event.clientY - lastPointerY;
  pointerTotalDisplacement += Math.abs(deltaX) + Math.abs(deltaY);
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
  const wasClick = pointerTotalDisplacement < 5;
  activePointerId = null;
  isThreeDragging = false;
  stateCanvas?.releasePointerCapture?.(event.pointerId);
  if (wasClick && threeApi?.mesh) {
    const link = raycastVersoLinks(event);
    if (link) {
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
  }
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
    hideHoverSigil();
    // Init swipe gesture on mobile
    if (mobileMediaQuery.matches && !infoPaneGesture) {
      infoPaneGesture = createInfoPaneGesture(infoPane, {
        onMinimize: () => app.classList.add("is-pane-minimized"),
        onMaximize: () => app.classList.remove("is-pane-minimized"),
      });
      infoPaneGesture.init();
    }
  } else {
    app.classList.remove("is-split", "is-pane-minimized");
    infoPane.setAttribute("aria-hidden", "true");
    backButton?.setAttribute("hidden", "");
    if (infoPaneGesture) {
      infoPaneGesture.dispose();
      infoPaneGesture = null;
    }
  }
};

const setThreeView = () => {
  if (!mapPane) return;
  mapPane.classList.add("is-3d-state");
  startThreeRender();
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
  loadingProgress.textContent = t("loading.stateViews", { current, total });
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
    if (!options.onComplete) setAnimating(false);
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

const renderInfo = (stateId, infoOptions = {}) => {
  if (!infoContent) return;
  const narrativeBackBtn = document.getElementById("narrative-back");
  if (narrativeBackBtn) narrativeBackBtn.hidden = true;
  if (!stateId) {
    infoContent.innerHTML =
      `<h2 class="info-title">${t("info.explore")}</h2><div class="info-body">${t("info.selectState")}</div>`;
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
    infoContent.innerHTML = `<div class="info-body">${t("info.loading")}</div>`;
    return;
  }
  const count = stateCounts.get(String(stateId)) ?? 0;
  const trackId = trackByState.get(String(stateId));
  const track = trackId ? trackById.get(trackId) : null;

  // Dispose previous player/audio before rendering new state
  if (hourglassPlayer) {
    hourglassPlayer.dispose();
    hourglassPlayer = null;
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  stopAudioReactive();

  if (!track) {
    infoContent.innerHTML = `<div class="track-shrine is-empty"><span class="shrine-artist">${t("info.noTrack")}</span></div>`;
    return;
  }

  const parts = track.title.split(" - ");
  const artist = parts[0] || "";
  const title = parts.slice(1).join(" - ") || track.title;
  const narrativeLines = track.narrative || [];

  // Revisit — skip narrative, go straight to hourglass with revealed tarot card
  if (infoOptions.pendingResult) {
    infoContent.innerHTML = `<audio class="track-audio" preload="metadata" src="${encodeURI(track.file)}"></audio>`;
    const audio = infoContent.querySelector(".track-audio");
    if (audio instanceof HTMLAudioElement) activeAudio = audio;
    showTrackShrine(title, artist, track, audio, infoOptions);
    return;
  }

  // Phase A — Narrative text
  const linesMarkup = narrativeLines.map((line, i) => {
    const delay = (i + 1) * 1.2;
    return `<p class="narrative-line" style="animation-delay: ${delay}s">${line}</p>`;
  }).join("");
  const playDelay = (narrativeLines.length + 1) * 1.2;
  const narrativeMarkup = `
    <div class="narrative-container">
      ${linesMarkup}
      <button class="narrative-play-btn" style="animation-delay: ${playDelay}s" type="button">${track.playLabel || "Play"}</button>
    </div>
    <audio class="track-audio" preload="metadata" src="${encodeURI(track.file)}"></audio>
  `;
  infoContent.innerHTML = narrativeMarkup;

  // Prepare audio element (don't play yet)
  const audio = infoContent.querySelector(".track-audio");
  if (audio instanceof HTMLAudioElement) {
    activeAudio = audio;
  }

  // Play button → transition to Phase B (hourglass)
  const playBtn = infoContent.querySelector(".narrative-play-btn");
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      // Start audio in user gesture context to satisfy autoplay policy
      if (audio instanceof HTMLAudioElement) {
        audio.play().catch(() => {});
      }
      const narrativeEl = infoContent.querySelector(".narrative-container");
      if (narrativeEl) {
        if (prefersReducedMotion) {
          narrativeEl.remove();
          showTrackShrine(title, artist, track, audio, infoOptions);
        } else {
          narrativeEl.classList.add("is-fading");
          const onFadeEnd = (e) => {
            if (e.animationName !== "narrative-fade-out") return;
            narrativeEl.removeEventListener("animationend", onFadeEnd);
            narrativeEl.remove();
            showTrackShrine(title, artist, track, audio, infoOptions);
          };
          narrativeEl.addEventListener("animationend", onFadeEnd);
        }
      } else {
        showTrackShrine(title, artist, track, audio, infoOptions);
      }
    });
  }
};

const showTrackShrine = (title, artist, track, audio, infoOptions = {}) => {
  if (!infoContent) return;
  // Remove any leftover narrative
  const oldNarrative = infoContent.querySelector(".narrative-container");
  if (oldNarrative) oldNarrative.remove();

  // Build question/result markup to show alongside hourglass
  let questionMarkup = "";
  const { pendingQuestion, pendingResult } = infoOptions;
  if (pendingResult) {
    const prev = pendingResult;
    const chosenLabel = prev.chosenLabel || t("fallback.explore", { id: prev.chosen });
    const hourglassQuestion = track.hourglassText
      ? track.hourglassText.replace(/\n/g, "<br>")
      : t("fallback.direction");
    questionMarkup = `
      <div class="question-container tarot-result">
        <div class="question-prompt tarot-reading">
          <p class="question-text">${hourglassQuestion}</p>
        </div>
        <div class="tarot-spread">
          <div class="tarot-card tarot-card--static answer-btn--selected">
            <div class="tarot-card-inner">
              <div class="tarot-card-back"><div class="tarot-card-back-pattern"></div></div>
              <div class="tarot-card-front">
                <div class="tarot-card-border">
                  <div class="tarot-card-content">
                    <span class="tarot-card-label">${chosenLabel}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const shrineMarkup = `<div class="track-shrine is-entering">
      <div class="shrine-glow"></div>
      <div class="shrine-stack">
        <div class="hourglass-player" data-track-player></div>
        <div class="shrine-meta">
          <div class="shrine-title">${title}</div>
          <div class="shrine-artist">${artist}</div>
        </div>
      </div>
      ${questionMarkup}
    </div>`;
  infoContent.insertAdjacentHTML("afterbegin", shrineMarkup);

  // Trigger enter animation
  requestAnimationFrame(() => {
    const shrine = infoContent.querySelector(".track-shrine");
    if (shrine) shrine.classList.remove("is-entering");
  });

  const player = infoContent.querySelector("[data-track-player]");
  if (audio instanceof HTMLAudioElement) {
    activeAudio = audio;
    setupTrackPlayer(player, audio);
    // If audio is already playing (started during narrative click),
    // the "play" event already fired before the listener was attached,
    // so kick off audio-reactive manually.
    if (!audio.paused) startAudioReactive(audio);
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        console.warn("[audio] Play failed:", err.message);
      });
    }
    if (String(activeStateId) === "11") {
      const tryBark = () => {
        if (!stateCharacter) return setTimeout(tryBark, 300);
        const bubble = document.createElement("div");
        bubble.className = "state-character-bubble";
        bubble.textContent = t("bark.finale");
        stateCharacter.parentElement.appendChild(bubble);
        const positionBubble = () => {
          const rect = stateCharacter.getBoundingClientRect();
          const parentRect = (stateCharacter.offsetParent || app).getBoundingClientRect();
          bubble.style.left = `${rect.left - parentRect.left + rect.width / 2}px`;
          bubble.style.top = `${rect.top - parentRect.top - 12}px`;
        };
        positionBubble();
        // Hook into the floating animation sync loop
        const origSync = stateCharacter._syncOverlays;
        stateCharacter._syncOverlays = () => {
          if (origSync) origSync();
          if (bubble.parentElement) positionBubble();
        };
        setTimeout(() => {
          bubble.remove();
          stateCharacter._syncOverlays = origSync;
        }, 8000);
      };
      setTimeout(tryBark, 1500);
    }
  }

  // Show question modal immediately if needed
  if (pendingQuestion) {
    requestAnimationFrame(() => showQuestionModal(pendingQuestion));
  }

  // Show back arrow in header
  const narrativeBackBtn = document.getElementById("narrative-back");
  if (narrativeBackBtn) {
    narrativeBackBtn.hidden = false;
    const handler = () => {
      narrativeBackBtn.removeEventListener("click", handler);
      narrativeBackBtn.hidden = true;
      // Pause audio and dispose player
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      }
      if (hourglassPlayer) {
        hourglassPlayer.dispose();
        hourglassPlayer = null;
      }
      activeAudio = null;
      stopAudioReactive();
      // Re-render narrative (skip animations on revisit)
      showNarrative(title, artist, track, infoOptions);
    };
    narrativeBackBtn.addEventListener("click", handler);
  }
};

const showNarrative = (title, artist, track, infoOptions) => {
  if (!infoContent) return;
  const narrativeLines = track.narrative || [];
  const linesMarkup = narrativeLines.map((line) => {
    return `<p class="narrative-line is-visible">${line}</p>`;
  }).join("");
  const narrativeMarkup = `
    <div class="narrative-container">
      ${linesMarkup}
      <button class="narrative-play-btn is-visible" type="button">${track.playLabel || "Play"}</button>
    </div>
    <audio class="track-audio" preload="metadata" src="${encodeURI(track.file)}"></audio>
  `;
  infoContent.innerHTML = narrativeMarkup;

  const audio = infoContent.querySelector(".track-audio");
  if (audio instanceof HTMLAudioElement) {
    activeAudio = audio;
  }

  const playBtn = infoContent.querySelector(".narrative-play-btn");
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      if (audio instanceof HTMLAudioElement) {
        audio.play().catch(() => {});
      }
      const narrativeEl = infoContent.querySelector(".narrative-container");
      if (narrativeEl) {
        if (prefersReducedMotion) {
          narrativeEl.remove();
          showTrackShrine(title, artist, track, audio, infoOptions);
        } else {
          narrativeEl.classList.add("is-fading");
          const onFadeEnd = (e) => {
            if (e.animationName !== "narrative-fade-out") return;
            narrativeEl.removeEventListener("animationend", onFadeEnd);
            narrativeEl.remove();
            showTrackShrine(title, artist, track, audio, infoOptions);
          };
          narrativeEl.addEventListener("animationend", onFadeEnd);
        }
      } else {
        showTrackShrine(title, artist, track, audio, infoOptions);
      }
    });
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

  mapGestures?.disable();
  hideMapCharacterBark();

  // Auto-maximize info pane if minimized
  if (infoPaneGesture?.isMinimized) infoPaneGesture.maximize();

  const skipQuestion = options.skipQuestion || hasBeenQuestioned(normalized);

  mapApi?.setActiveState(normalized);
  mapApi?.focusState(normalized);
  renderFocusSigil(normalized);
  setCollapsed(true);
  activeStateId = normalized;

  // Determine what to show after hourglass appears
  const pendingQuestion = !skipQuestion ? normalized : null;
  const pendingResult = skipQuestion && answeredQuestions.has(normalized)
    ? answeredQuestions.get(normalized)
    : null;

  renderInfo(normalized, { pendingQuestion, pendingResult });

  // Start 3D mesh prep in background (builds mesh flat, loads texture)
  // Start 3D mesh prep concurrently with zoom
  let meshIsReady = false;
  let zoomDone = false;
  const tryMorph = () => {
    if (!meshIsReady || !zoomDone) return;
    morphTo3D(500).then(() => showStateCharacter());
  };
  showState3D(normalized).then(() => {
    meshIsReady = true;
    tryMorph();
  });
  if (options.pushState !== false) updateUrlState(normalized);
  requestAnimationFrame(() => {
    const target = getTargetViewBoxForState(normalized);
    if (!target) {
      setAnimating(false);
      return;
    }
    lastSelectedViewBox = target;
    animateToViewBox(target, 200, {
      stateId: normalized,
      useSnapshot: true,
      onComplete: () => {
        zoomDone = true;
        tryMorph();
      },
    });
  });
};

const showQuestionModal = (stateId) => {
  // Look up current state's track for hourglassText and choices
  const sourceTrackId = trackByState.get(String(stateId));
  const sourceTrack = sourceTrackId ? trackById.get(sourceTrackId) : null;
  const choices = sourceTrack?.choices || [];

  // Final state (zero crossing point) — no choices, celebrate
  const FINAL_STATE = "11";
  if (String(stateId) === FINAL_STATE || choices.length === 0) {
    markAsQuestioned(stateId);
    celebrateMapCompletion();
    return;
  }

  // Gather all unrevealed states (excluding ocean)
  const allStates = Array.from(stateCounts.keys());
  const allUnrevealed = allStates.filter((s) => s !== "0" && !isStateRevealed(s));

  // If nothing left to reveal, celebrate
  if (allUnrevealed.length === 0) {
    markAsQuestioned(stateId);
    celebrateMapCompletion();
    return;
  }

  // State 11 (Zero Crossing Point) is always the last to be discovered
  const nonFinal = allUnrevealed.filter((s) => s !== FINAL_STATE);

  // If only state 11 remains, offer it as the sole destination
  if (nonFinal.length === 0) {
    // Final state is the only one left
    const option1 = FINAL_STATE;
    const option2 = FINAL_STATE;
    const label1 = choices[0];
    const label2 = choices[1] || choices[0];
    const hourglassQuestion = sourceTrack?.hourglassText
      ? sourceTrack.hourglassText.replace(/\n/g, "<br>")
      : t("fallback.direction");
    if (!infoContent) return;
    const cardMarkup = (answer, label) => `
          <button class="tarot-card answer-btn" data-answer="${answer}" type="button">
            <div class="tarot-card-inner">
              <div class="tarot-card-back"><div class="tarot-card-back-pattern"></div></div>
              <div class="tarot-card-front">
                <div class="tarot-card-border">
                  <div class="tarot-card-content">
                    <span class="tarot-card-label">${label}</span>
                  </div>
                </div>
              </div>
            </div>
          </button>`;
    const questionMarkup = `
      <div class="question-container">
        <div class="question-prompt tarot-reading">
          <p class="question-text">${hourglassQuestion}</p>
        </div>
        <div class="tarot-spread">
          ${cardMarkup(option1, label1)}
          ${label2 !== label1 ? cardMarkup(option2, label2) : ""}
        </div>
      </div>
    `;
    infoContent.insertAdjacentHTML('beforeend', questionMarkup);
    const answerButtons = infoContent.querySelectorAll(".answer-btn");
    answerButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        answerButtons.forEach((b) => { b.disabled = true; });
        btn.classList.add("answer-btn--selected");
        answerButtons.forEach((b) => {
          if (b !== btn) b.classList.add("answer-btn--dismissed");
        });
        setTimeout(() => {
          handleAnswer(FINAL_STATE, stateId);
          const chosenLabel = btn.querySelector(".tarot-card-label")?.textContent || "";
          answeredQuestions.set(stateId, { option1, option2, chosen: FINAL_STATE, chosenLabel });
          pendingTrail = { from: stateId, to: FINAL_STATE };
          const container = infoContent?.querySelector('.question-container');
          if (container) {
            const continueBtn = document.createElement('button');
            continueBtn.className = 'answer-btn answer-btn--continue';
            continueBtn.type = 'button';
            continueBtn.textContent = t("continue.exploring");
            continueBtn.addEventListener('click', () => { clearSelection(); });
            container.appendChild(continueBtn);
            setTimeout(() => {
              continueBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 650);
          }
        }, 1100);
      });
    });
    return;
  }

  // Prefer direct neighbors, but exclude state 11 — it's reserved for last
  const neighbors = getNeighbors(stateId);
  let candidates = neighbors.filter((n) => n !== FINAL_STATE && !isStateRevealed(n));

  // If no unrevealed non-final neighbors, use any non-final unrevealed state
  if (candidates.length === 0) {
    candidates = nonFinal;
  }

  // Always pick exactly 2 distinct unrevealed states
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  const option1 = shuffled[0];
  const option2 = shuffled[1] || option1;

  // Always 2 cards with distinct labels from track choices
  const label1 = choices[0];
  const label2 = choices[1];

  // Hourglass text from source track
  const hourglassQuestion = sourceTrack?.hourglassText
    ? sourceTrack.hourglassText.replace(/\n/g, "<br>")
    : t("fallback.direction");

  // Append question to existing info panel content
  if (!infoContent) return;

  const cardMarkup = (answer, label) => `
        <button class="tarot-card answer-btn" data-answer="${answer}" type="button">
          <div class="tarot-card-inner">
            <div class="tarot-card-back"><div class="tarot-card-back-pattern"></div></div>
            <div class="tarot-card-front">
              <div class="tarot-card-border">
                <div class="tarot-card-content">
                  <span class="tarot-card-label">${label}</span>
                </div>
              </div>
            </div>
          </div>
        </button>`;

  const questionMarkup = `
    <div class="question-container">
      <div class="question-prompt tarot-reading">
        <p class="question-text">${hourglassQuestion}</p>
      </div>
      <div class="tarot-spread">
        ${cardMarkup(option1, label1)}
        ${cardMarkup(option2, label2)}
      </div>
    </div>
  `;

  infoContent.insertAdjacentHTML('beforeend', questionMarkup);

  // Add click handlers to answer buttons
  const answerButtons = infoContent.querySelectorAll(".answer-btn");
  answerButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const answer = btn.dataset.answer;
      if (!answer) return;
      // Disable all buttons immediately
      answerButtons.forEach((b) => { b.disabled = true; });
      // Animate: keep selected, dismiss the other
      btn.classList.add("answer-btn--selected");
      answerButtons.forEach((b) => {
        if (b !== btn) b.classList.add("answer-btn--dismissed");
      });
      setTimeout(() => {
        handleAnswer(answer, stateId);
        // Store answer for revisit rendering (include chosenLabel for revisit display)
        const chosenLabel = btn.querySelector(".tarot-card-label")?.textContent || "";
        answeredQuestions.set(stateId, { option1, option2: option2 || option1, chosen: answer, chosenLabel });
        // Store pending trail for deferred drawing (when user clicks back or continue)
        pendingTrail = { from: stateId, to: answer };
        const container = infoContent?.querySelector('.question-container');
        if (container) {
          const continueBtn = document.createElement('button');
          continueBtn.className = 'answer-btn answer-btn--continue';
          continueBtn.type = 'button';
          continueBtn.textContent = t("continue.exploring");
          continueBtn.addEventListener('click', () => {
            clearSelection();
          });
          container.appendChild(continueBtn);
          setTimeout(() => {
            continueBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }, 650);
        }
      }, 1100);
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

};

const showAboutModal = () => {
  if (aboutModal) {
    aboutModal.setAttribute("aria-hidden", "false");
  }
};

const hideAboutModal = () => {
  if (aboutModal) {
    aboutModal.setAttribute("aria-hidden", "true");
  }
};

const CHARACTER_STORAGE_KEY = "ataraxie-character";

// Character move sets: maps character -> move type -> frame paths
const CHARACTER_MOVE_MAP = {
  demon: {
    idle: [
      "assets/characters/demon/idle/frame1.svg",
      "assets/characters/demon/idle/frame2.svg",
      "assets/characters/demon/idle/frame3.svg"
    ],
    stomp: [
      "assets/characters/demon/stomp/frame1.svg",
      "assets/characters/demon/stomp/frame2.svg",
      "assets/characters/demon/stomp/frame3.svg"
    ],
    armwave: [
      "assets/characters/demon/armwave/frame1.svg",
      "assets/characters/demon/armwave/frame2.svg",
      "assets/characters/demon/armwave/frame3.svg",
      "assets/characters/demon/armwave/frame4.svg",
      "assets/characters/demon/armwave/frame5.svg"
    ],
    turn: [
      "assets/characters/demon/turn/frame1.svg",
      "assets/characters/demon/turn/frame2.svg",
      "assets/characters/demon/turn/frame3.svg",
      "assets/characters/demon/turn/frame4.svg",
      "assets/characters/demon/turn/frame5.svg",
      "assets/characters/demon/turn/frame6.svg"
    ],
    hipshake: [
      "assets/characters/demon/hipshake/frame1.svg",
      "assets/characters/demon/hipshake/frame2.svg",
      "assets/characters/demon/hipshake/frame3.svg",
      "assets/characters/demon/hipshake/frame4.svg"
    ],
    jump: [
      "assets/characters/demon/jump/frame1.svg",
      "assets/characters/demon/jump/frame2.svg",
      "assets/characters/demon/jump/frame3.svg",
      "assets/characters/demon/jump/frame4.svg"
    ],
    headbang: [
      "assets/characters/demon/headbang/frame1.svg",
      "assets/characters/demon/headbang/frame2.svg",
      "assets/characters/demon/headbang/frame3.svg"
    ]
  },
  succube: {
    idle: [
      "assets/characters/succube/idle/frame1.svg",
      "assets/characters/succube/idle/frame2.svg",
      "assets/characters/succube/idle/frame3.svg"
    ],
    stomp: [
      "assets/characters/succube/stomp/frame1.svg",
      "assets/characters/succube/stomp/frame2.svg",
      "assets/characters/succube/stomp/frame3.svg"
    ],
    armwave: [
      "assets/characters/succube/armwave/frame1.svg",
      "assets/characters/succube/armwave/frame2.svg",
      "assets/characters/succube/armwave/frame3.svg",
      "assets/characters/succube/armwave/frame4.svg",
      "assets/characters/succube/armwave/frame5.svg"
    ],
    turn: [
      "assets/characters/succube/turn/frame1.svg",
      "assets/characters/succube/turn/frame2.svg",
      "assets/characters/succube/turn/frame3.svg",
      "assets/characters/succube/turn/frame4.svg",
      "assets/characters/succube/turn/frame5.svg",
      "assets/characters/succube/turn/frame6.svg"
    ],
    hipshake: [
      "assets/characters/succube/hipshake/frame1.svg",
      "assets/characters/succube/hipshake/frame2.svg",
      "assets/characters/succube/hipshake/frame3.svg",
      "assets/characters/succube/hipshake/frame4.svg"
    ],
    jump: [
      "assets/characters/succube/jump/frame1.svg",
      "assets/characters/succube/jump/frame2.svg",
      "assets/characters/succube/jump/frame3.svg",
      "assets/characters/succube/jump/frame4.svg"
    ],
    headbang: [
      "assets/characters/succube/headbang/frame1.svg",
      "assets/characters/succube/headbang/frame2.svg",
      "assets/characters/succube/headbang/frame3.svg"
    ]
  },
  gargoyle: {
    idle: [
      "assets/characters/gargoyle/idle/frame1.svg",
      "assets/characters/gargoyle/idle/frame2.svg",
      "assets/characters/gargoyle/idle/frame3.svg"
    ],
    stomp: [
      "assets/characters/gargoyle/stomp/frame1.svg",
      "assets/characters/gargoyle/stomp/frame2.svg",
      "assets/characters/gargoyle/stomp/frame3.svg"
    ],
    armwave: [
      "assets/characters/gargoyle/armwave/frame1.svg",
      "assets/characters/gargoyle/armwave/frame2.svg",
      "assets/characters/gargoyle/armwave/frame3.svg",
      "assets/characters/gargoyle/armwave/frame4.svg",
      "assets/characters/gargoyle/armwave/frame5.svg"
    ],
    turn: [
      "assets/characters/gargoyle/turn/frame1.svg",
      "assets/characters/gargoyle/turn/frame2.svg",
      "assets/characters/gargoyle/turn/frame3.svg",
      "assets/characters/gargoyle/turn/frame4.svg",
      "assets/characters/gargoyle/turn/frame5.svg",
      "assets/characters/gargoyle/turn/frame6.svg"
    ],
    hipshake: [
      "assets/characters/gargoyle/hipshake/frame1.svg",
      "assets/characters/gargoyle/hipshake/frame2.svg",
      "assets/characters/gargoyle/hipshake/frame3.svg",
      "assets/characters/gargoyle/hipshake/frame4.svg"
    ],
    jump: [
      "assets/characters/gargoyle/jump/frame1.svg",
      "assets/characters/gargoyle/jump/frame2.svg",
      "assets/characters/gargoyle/jump/frame3.svg",
      "assets/characters/gargoyle/jump/frame4.svg"
    ],
    headbang: [
      "assets/characters/gargoyle/headbang/frame1.svg",
      "assets/characters/gargoyle/headbang/frame2.svg",
      "assets/characters/gargoyle/headbang/frame3.svg"
    ]
  }
};

// Helper for backward compatibility (question dialogs, character select use frame 1)
const getCharacterFrame = (character, frameIndex = 0) => {
  const moveSet = CHARACTER_MOVE_MAP[character];
  if (!moveSet || !moveSet.idle) return "";
  return moveSet.idle[frameIndex] || moveSet.idle[0];
};

const showCharacterSelect = () => {
  if (characterSelect) {
    const card = characterSelect.querySelector(".character-select-card");
    characterCards.forEach((c) => c.classList.remove("is-selected"));
    if (characterConfirm) characterConfirm.hidden = true;
    if (card) card.classList.remove("is-card-visible");
    characterSelect.classList.add("is-logo-intro");
    characterSelect.setAttribute("aria-hidden", "false");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = prefersReducedMotion ? 0 : 4800;
    setTimeout(() => {
      characterSelect.classList.remove("is-logo-intro");
      if (card) card.classList.add("is-card-visible");
    }, delay);
  }
};

const hideCharacterSelect = () => {
  if (characterSelect) {
    characterSelect.style.transition = "none";
    characterSelect.setAttribute("aria-hidden", "true");
    characterSelect.classList.remove("is-flying-out", "is-bg-fading");
    // Re-enable transitions after the hide is painted
    requestAnimationFrame(() => { characterSelect.style.transition = ""; });
  }
};

const flyCharacterToMap = (character) => new Promise((resolve) => {
  const selectedCard = document.querySelector(".character-card.is-selected");
  const cardImg = selectedCard?.querySelector(".character-card-img");
  if (!cardImg || !characterSelect || !svg) { hideCharacterSelect(); return resolve(); }

  const stateCenter = getStateCenter("1");
  const ctm = svg.getScreenCTM();
  if (!stateCenter || !ctm) { hideCharacterSelect(); return resolve(); }

  const targetScreenX = stateCenter.x * ctm.a + ctm.e;
  const targetScreenY = stateCenter.y * ctm.d + ctm.f;
  const targetSize = Math.max(16, getMarkerRadius() * 8 * ctm.a);

  const srcRect = cardImg.getBoundingClientRect();
  const startX = srcRect.left;
  const startY = srcRect.top;
  const startW = srcRect.width;
  const startH = srcRect.height;

  const flyer = document.createElement("img");
  flyer.className = "character-flyer";
  flyer.src = cardImg.src;
  flyer.style.left = startX + "px";
  flyer.style.top = startY + "px";
  flyer.style.width = startW + "px";
  flyer.style.height = startH + "px";
  document.body.appendChild(flyer);

  const frames = CHARACTER_MOVE_MAP[character]?.hipshake || [];
  let frameIdx = 0;
  const hipshakeInterval = frames.length > 0
    ? setInterval(() => { frameIdx = (frameIdx + 1) % frames.length; flyer.src = frames[frameIdx]; }, 125)
    : null;

  characterSelect.classList.add("is-flying-out");

  setTimeout(() => characterSelect.classList.add("is-bg-fading"), 250);

  const flightDelay = 300;
  const flightDuration = 800;

  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const endX = targetScreenX - targetSize / 2;
  const endY = targetScreenY - targetSize / 2;

  const cpx = (startX + endX) / 2;
  const arcHeight = Math.abs(endX - startX) * 0.3;
  const cpy = Math.min(startY, endY) - arcHeight;

  setTimeout(() => {
    const t0 = performance.now();
    const step = (now) => {
      const elapsed = now - t0;
      const raw = Math.min(elapsed / flightDuration, 1);
      const t = easeInOutCubic(raw);
      const u = 1 - t;

      const bx = u * u * startX + 2 * u * t * cpx + t * t * endX;
      const by = u * u * startY + 2 * u * t * cpy + t * t * endY;
      const w = startW + (targetSize - startW) * t;
      const h = startH + (targetSize - startH) * t;
      const glowSize = 6 + 18 * t;
      const glowAlpha = 0.4 + 0.5 * t;

      flyer.style.left = bx + "px";
      flyer.style.top = by + "px";
      flyer.style.width = w + "px";
      flyer.style.height = h + "px";
      flyer.style.filter = `drop-shadow(0 0 ${glowSize}px rgba(189,255,0,${glowAlpha}))`;

      if (raw < 1) {
        requestAnimationFrame(step);
      } else {
        if (hipshakeInterval) clearInterval(hipshakeInterval);
        flyer.classList.add("character-flyer--landed");
        hideCharacterSelect();

        setTimeout(() => {
          flyer.remove();
          resolve();
        }, 300);
      }
    };
    requestAnimationFrame(step);
  }, flightDelay);
});

const updateCharacterAvatar = () => {};

const waitForCharacterSelection = () =>
  new Promise((resolve) => {
    showCharacterSelect();

    // Hipshake frame cycling on hover
    const hoverIntervals = new Map();
    const HIPSHAKE_FPS = 8;

    const startHipshake = (card) => {
      const character = card.dataset.character;
      const frames = CHARACTER_MOVE_MAP[character]?.hipshake;
      if (!frames || frames.length === 0) return;
      const img = card.querySelector(".character-card-img");
      if (!img) return;
      let frameIdx = 0;
      img.src = frames[0];
      const interval = setInterval(() => {
        frameIdx = (frameIdx + 1) % frames.length;
        img.src = frames[frameIdx];
      }, 1000 / HIPSHAKE_FPS);
      hoverIntervals.set(card, interval);
    };

    const stopHipshake = (card) => {
      const character = card.dataset.character;
      const interval = hoverIntervals.get(card);
      if (interval != null) {
        clearInterval(interval);
        hoverIntervals.delete(card);
      }
      const img = card.querySelector(".character-card-img");
      if (img) img.src = getCharacterFrame(character, 0);
    };

    const handleMouseEnter = (e) => startHipshake(e.currentTarget);
    const handleMouseLeave = (e) => stopHipshake(e.currentTarget);

    const selectCard = (card) => {
      characterCards.forEach((c) => c.classList.remove("is-selected"));
      card.classList.add("is-selected");
      if (characterConfirm) characterConfirm.hidden = false;
    };

    const handleCardClick = (e) => {
      const card = e.currentTarget;
      selectCard(card);
    };

    const handleConfirm = () => {
      const selected = document.querySelector(".character-card.is-selected");
      if (!selected) return;
      const character = selected.dataset.character;
      selectedCharacter = character;
      localStorage.setItem(CHARACTER_STORAGE_KEY, character);
      cleanup();
      updateCharacterAvatar();
      if (prefersReducedMotion) {
        hideCharacterSelect();
        resolve(character);
      } else {
        const hipFrames = CHARACTER_MOVE_MAP[character]?.hipshake || [];
        Promise.all(hipFrames.map(src => new Promise(r => {
          const i = new Image(); i.onload = i.onerror = r; i.src = src;
        }))).then(() => flyCharacterToMap(character).then(() => resolve(character)));
      }
    };

    const cleanup = () => {
      characterCards.forEach((c) => {
        c.removeEventListener("click", handleCardClick);
        c.removeEventListener("mouseenter", handleMouseEnter);
        c.removeEventListener("mouseleave", handleMouseLeave);
        stopHipshake(c);
      });
      characterConfirm?.removeEventListener("click", handleConfirm);
    };

    characterCards.forEach((card) => {
      card.addEventListener("click", handleCardClick);
      card.addEventListener("mouseenter", handleMouseEnter);
      card.addEventListener("mouseleave", handleMouseLeave);
    });
    characterConfirm?.addEventListener("click", handleConfirm);
  });

const getStateCenter = (stateId) => {
  const bounds = mapApi?.getStateBounds(stateId);
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
};

const getMarkerRadius = () => {
  if (!fullViewBox) return 3;
  return Math.min(fullViewBox.width, fullViewBox.height) * 0.005;
};

const renderTrails = () => {
  const layer = mapApi?.getTrailLayer();
  if (!layer) return;

  const hadCharacter = !!mapCharacter;

  while (layer.firstChild) layer.removeChild(layer.firstChild);
  if (hadCharacter) mapCharacter = null;

  const r = getMarkerRadius();

  // Draw all existing trail lines
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
      d = `M ${fromCenter.x} ${fromCenter.y} Q ${mx + -dy * offset / Math.sqrt(dx * dx + dy * dy)} ${my + dx * offset / Math.sqrt(dx * dx + dy * dy)} ${toCenter.x} ${toCenter.y}`;
    }

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.classList.add("trail-line");
    layer.appendChild(path);
  });

  // Draw markers for all discovered states
  explorationOrder.forEach((stateId, i) => {
    const center = getStateCenter(stateId);
    if (!center) return;

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", center.x);
    circle.setAttribute("cy", center.y);
    circle.setAttribute("r", r);
    circle.classList.add("trail-marker");
    if (i === 0) circle.classList.add("trail-marker--origin");
    layer.appendChild(circle);
  });

  if (hadCharacter && selectedCharacter) {
    createMapCharacter();
  }
};

const drawTrailSegment = (fromStateId, toStateId) => {
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

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", d);
  path.classList.add("trail-line");
  layer.appendChild(path);

  // Animate the line and marker appearing
  if (!prefersReducedMotion) {
    path.classList.add("trail-line--appear");

    setTimeout(() => {
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", toCenter.x);
      circle.setAttribute("cy", toCenter.y);
      circle.setAttribute("r", r);
      circle.classList.add("trail-marker", "trail-marker--appear");
      layer.appendChild(circle);
      if (mapCharacter) layer.appendChild(mapCharacter);
    }, 800);
  } else {
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", toCenter.x);
    circle.setAttribute("cy", toCenter.y);
    circle.setAttribute("r", r);
    circle.classList.add("trail-marker");
    layer.appendChild(circle);
  }

  if (mapCharacter) layer.appendChild(mapCharacter);
};

// --- Map View Character (SVG on trail layer) ---

const spawnPuffParticles = (cx, cy, size, layer) => {
  const svgNS = "http://www.w3.org/2000/svg";
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

    const el = document.createElementNS(svgNS, "ellipse");
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
      const anim = document.createElementNS(svgNS, "animate");
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
  setTimeout(() => wisps.forEach(w => w.remove()), 900);
};

const createMapCharacter = (arriving = false) => {
  removeMapCharacter();
  if (!selectedCharacter || !mapApi) return;
  const moveSet = CHARACTER_MOVE_MAP[selectedCharacter];
  if (!moveSet?.idle?.length) return;

  const layer = mapApi.getTrailLayer();
  if (!layer) return;

  const targetState = explorationOrder.length > 0
    ? explorationOrder[explorationOrder.length - 1]
    : "1";
  const center = getStateCenter(targetState);
  if (!center) return;

  const size = getMarkerRadius() * 8;
  const img = document.createElementNS(svgNS, "image");
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

const hideMapCharacterBark = () => {
  mapCharacterBarkTimers.forEach(t => clearTimeout(t));
  mapCharacterBarkTimers = [];
  if (mapCharacterBark) { mapCharacterBark.remove(); mapCharacterBark = null; }
};

const showMapCharacterBark = (text, duration = 4000) => {
  if (mapCharacterBark) { mapCharacterBark.remove(); mapCharacterBark = null; }
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
  mapCharacterBarkTimers.push(setTimeout(() => { if (mapCharacterBark === bubble) { bubble.remove(); mapCharacterBark = null; } }, duration));
};

const removeMapCharacter = () => {
  hideMapCharacterBark();
  if (mapCharacterInterval) {
    clearInterval(mapCharacterInterval);
    mapCharacterInterval = null;
  }
  if (mapCharacter) {
    const layer = mapCharacter.parentNode;
    if (layer) layer.querySelectorAll(".puff-wisp").forEach(w => w.remove());
    mapCharacter.remove();
    mapCharacter = null;
  }
  mapCharacterStateId = null;
  mapCharacterFrameIdx = 0;
};

const updateMapCharacterPosition = (toStateId, fromStateId, animate = true) => {
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

// --- State View Character (floating + draggable in info pane) ---

const startStateCharFloat = () => {
  if (prefersReducedMotion || !stateCharacter) return;
  stopStateCharFloat();
  stateCharFloatStart = performance.now();
  const loop = (now) => {
    if (!stateCharacter || stateCharDragging) return;
    const t = (now - stateCharFloatStart) / 1000;
    const offsetY = Math.sin(t * 0.7) * 12 + Math.sin(t * 1.3) * 6;
    const offsetX = Math.sin(t * 0.5) * 35 + Math.cos(t * 0.9) * 20;
    stateCharacter.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    if (stateCharacter._syncOverlays) stateCharacter._syncOverlays();
    stateCharFloatRAF = requestAnimationFrame(loop);
  };
  stateCharFloatRAF = requestAnimationFrame(loop);
};

const stopStateCharFloat = () => {
  if (stateCharFloatRAF) {
    cancelAnimationFrame(stateCharFloatRAF);
    stateCharFloatRAF = null;
  }
  if (stateCharacter) {
    stateCharacter.style.transform = "translate(0, 0)";
  }
};

const DRAG_PHRASES = getDragPhrases();

const setupStateCharDrag = (img) => {
  let grabOffsetX = 0;
  let grabOffsetY = 0;
  let dragTimer = null;
  let bubble = null;
  let menu = null;
  let startX = 0;
  let startY = 0;
  let pointerIsDown = false;
  let dragStarted = false;
  const DRAG_THRESHOLD = 5;

  const positionAboveChar = (el) => {
    const imgRect = img.getBoundingClientRect();
    const parentRect = (img.offsetParent || app).getBoundingClientRect();
    el.style.left = `${imgRect.left - parentRect.left + imgRect.width / 2}px`;
    el.style.top = `${imgRect.top - parentRect.top - 12}px`;
  };

  const syncOverlays = () => {
    if (bubble) positionAboveChar(bubble);
    if (menu) positionAboveChar(menu);
  };
  img._syncOverlays = syncOverlays;

  const showBubble = () => {
    if (bubble) return;
    bubble = document.createElement("div");
    bubble.className = "state-character-bubble";
    bubble.textContent = DRAG_PHRASES[Math.floor(Math.random() * DRAG_PHRASES.length)];
    img.parentElement.appendChild(bubble);
    positionAboveChar(bubble);
    bubble._updatePos = syncOverlays;
  };

  const hideBubble = () => {
    if (bubble) { bubble.remove(); bubble = null; }
  };

  const closeMenu = () => {
    if (menu) { menu.remove(); menu = null; }
    document.removeEventListener("pointerdown", onOutsideClick, true);
    document.removeEventListener("keydown", onEscapeKey);
  };

  const onOutsideClick = (e) => {
    if (menu && !menu.contains(e.target) && e.target !== img) closeMenu();
  };

  const onEscapeKey = (e) => {
    if (e.key === "Escape") closeMenu();
  };

  const showGestureHelp = () => {
    closeMenu();
    hideBubble();
    bubble = document.createElement("div");
    bubble.className = "state-character-bubble";
    bubble.style.whiteSpace = "pre-line";
    bubble.textContent = t("gesture.hints");
    img.parentElement.appendChild(bubble);
    positionAboveChar(bubble);
    setTimeout(hideBubble, 5000);
  };

  const toggleMenu = () => {
    if (menu) { closeMenu(); return; }
    hideBubble();

    menu = document.createElement("div");
    menu.className = "state-character-menu";

    const isPlaying = hourglassPlayer ? hourglassPlayer.playing : (activeAudio && !activeAudio.paused);
    const playLabel = isPlaying ? t("menu.pause") : t("menu.play");
    const askMeaning = () => {
      closeMenu();
      hideBubble();
      bubble = document.createElement("div");
      bubble.className = "state-character-bubble";
      bubble.textContent = DRAG_PHRASES[Math.floor(Math.random() * DRAG_PHRASES.length)];
      img.parentElement.appendChild(bubble);
      positionAboveChar(bubble);
      setTimeout(hideBubble, 5000);
    };

    const items = [
      { label: playLabel, action: () => { if (hourglassPlayer) { hourglassPlayer.togglePlay(); } else if (activeAudio) { activeAudio.paused ? activeAudio.play() : activeAudio.pause(); } }},
      { label: t("menu.restart"), action: () => { if (hourglassPlayer) { hourglassPlayer.restart(); } else if (activeAudio) { activeAudio.currentTime = 0; activeAudio.play().catch(() => {}); } }},
      { label: t("menu.meaning"), action: askMeaning },
      { label: t("menu.gestures"), action: showGestureHelp },
      { label: t("menu.about"), action: () => { aboutModal?.setAttribute("aria-hidden", "false"); }},
    ];

    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "state-character-menu-item";
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); item.action(); });
      menu.appendChild(btn);
    }

    img.parentElement.appendChild(menu);
    positionAboveChar(menu);

    setTimeout(() => {
      document.addEventListener("pointerdown", onOutsideClick, true);
      document.addEventListener("keydown", onEscapeKey);
    }, 0);
  };

  const onPointerDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    img.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    pointerIsDown = true;
    dragStarted = false;

    const rect = img.getBoundingClientRect();
    grabOffsetX = e.clientX - rect.left - rect.width / 2;
    grabOffsetY = e.clientY - rect.top - rect.height / 2;
  };

  const beginDrag = () => {
    dragStarted = true;
    stateCharDragging = true;
    img.classList.add("state-character--dragging");
    stopStateCharFloat();
    closeMenu();
    dragTimer = setTimeout(showBubble, 1000);
  };

  const onPointerMove = (e) => {
    if (!pointerIsDown) return;
    if (dragStarted) {
      e.preventDefault();
      const parent = img.offsetParent || app;
      const parentRect = parent.getBoundingClientRect();
      const x = e.clientX - parentRect.left - grabOffsetX - img.offsetWidth / 2;
      const y = e.clientY - parentRect.top - grabOffsetY - img.offsetHeight / 2;
      img.style.left = `${x}px`;
      img.style.top = `${y}px`;
      syncOverlays();
      return;
    }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) beginDrag();
  };

  const onPointerEnd = (e) => {
    img.releasePointerCapture(e.pointerId);
    if (!pointerIsDown) return;
    pointerIsDown = false;
    if (!dragStarted) {
      toggleMenu();
      return;
    }
    stateCharDragging = false;
    dragStarted = false;
    img.classList.remove("state-character--dragging");
    clearTimeout(dragTimer);
    dragTimer = null;
    hideBubble();
    startStateCharFloat();
  };

  img.addEventListener("pointerdown", onPointerDown);
  img.addEventListener("pointermove", onPointerMove);
  img.addEventListener("pointerup", onPointerEnd);
  img.addEventListener("pointercancel", onPointerEnd);
};

const showStateCharacter = () => {
  hideStateCharacter();
  if (!selectedCharacter || !infoPane) return;
  const moveSet = CHARACTER_MOVE_MAP[selectedCharacter];
  if (!moveSet?.idle?.length) return;

  const img = document.createElement("img");
  img.src = moveSet.idle[0];
  img.alt = selectedCharacter;
  img.className = "state-character";
  img.draggable = false;
  if (!prefersReducedMotion) img.classList.add("state-character--arriving");
  app.appendChild(img);

  stateCharacter = img;
  stateCharFrameIdx = 0;

  if (!prefersReducedMotion) {
    setTimeout(() => stateCharacter?.classList.remove("state-character--arriving"), 800);
  }

  stateCharInterval = setInterval(() => {
    stateCharFrameIdx = (stateCharFrameIdx + 1) % moveSet.idle.length;
    if (stateCharacter) {
      stateCharacter.src = moveSet.idle[stateCharFrameIdx];
    }
  }, 350);

  setupStateCharDrag(img);
  startStateCharFloat();
};

const hideStateCharacter = () => {
  stopStateCharFloat();
  stateCharDragging = false;
  if (stateCharInterval) {
    clearInterval(stateCharInterval);
    stateCharInterval = null;
  }
  if (stateCharacter) {
    stateCharacter.remove();
    stateCharacter = null;
  }
  stateCharFrameIdx = 0;
};

const handleAnswer = (revealedStateId, currentStateId) => {
  // Reveal the selected state
  revealState(revealedStateId);

  // Mark current state as questioned
  markAsQuestioned(currentStateId);

  // Record exploration trail
  addTrail(currentStateId, revealedStateId);

  // Update fog on map
  if (mapApi?.applyFog) {
    mapApi.applyFog(revealedStates);
  }
  // Update texture canvas
  if (textureCanvas) {
    textureCanvas.syncWithSvg();
  }

  // Trail drawing is deferred until "Continue exploring" click so user sees the animation
  // Dismissed tarot cards fade to opacity:0 via CSS animation — no DOM removal needed
};

const clearSelection = (options = {}) => {
  const stateId = activeStateId;
  const previousBox = lastSelectedViewBox;

  // Draw pending trail if exists (from answered question)
  if (pendingTrail) {
    const { from, to } = pendingTrail;
    setTimeout(() => {
      drawTrailSegment(from, to);
      updateMapCharacterPosition(to, from, true);
    }, 300);
    pendingTrail = null; // Clear after drawing
  }

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
  hideStateCharacter();
  hideState3D();
  activeStateId = null;
  renderInfo(null);
  if (options.pushState !== false) updateUrlState(null);
  lastSelectedViewBox = null;

  setSplitLayout(false);
  setCollapsed(false);
  const restoreBox = mapGestures?.getUserViewBox() || fullViewBox;
  if (restoreBox) viewbox.set(restoreBox);
  mapGestures?.enable();
  setAnimating(false);
};

const init = async () => {
  // i18n: wire language toggle and apply static translations
  const langToggle = document.getElementById("lang-toggle");
  if (langToggle) {
    const currentLang = getLang();
    langToggle.querySelectorAll("[data-lang]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.lang === currentLang ? "true" : "false");
      btn.addEventListener("click", () => {
        if (btn.dataset.lang !== currentLang) setLang(btn.dataset.lang);
      });
    });
  }
  applyStaticTranslations();

  // Rotate overlay: block portrait on mobile until user rotates to landscape
  const rotateOverlay = document.getElementById("rotate-overlay");
  const isMobile = window.matchMedia("(pointer: coarse)").matches;
  const isPortrait = () => window.innerHeight > window.innerWidth;
  if (rotateOverlay && isMobile && isPortrait()) {
    rotateOverlay.setAttribute("aria-hidden", "false");
    await new Promise((resolve) => {
      const check = () => {
        if (!isPortrait()) {
          rotateOverlay.setAttribute("aria-hidden", "true");
          window.removeEventListener("resize", check);
          resolve();
        }
      };
      window.addEventListener("resize", check);
    });
  }

  // Mobile warning: show once per session on small screens
  const mobileWarning = document.getElementById("mobile-warning");
  if (
    mobileWarning &&
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(screen.width, screen.height) <= 480 &&
    !sessionStorage.getItem("ataraxie-mobile-warned")
  ) {
    mobileWarning.setAttribute("aria-hidden", "false");
    await new Promise((resolve) => {
      document.getElementById("mobile-warning-dismiss").addEventListener("click", resolve, { once: true });
    });
    sessionStorage.setItem("ataraxie-mobile-warned", "1");
    mobileWarning.setAttribute("aria-hidden", "true");
  }

  if (!dataUrl || !svg) return;
  try {
    setLoading(true, t("loading.mapData"));
    const resolvedTracksUrl = getTracksUrl(tracksUrl);
    const [geojson, tracks, sigils] = await Promise.all([
      loadGeoJSON(dataUrl),
      resolvedTracksUrl ? loadTracks(resolvedTracksUrl) : Promise.resolve(null),
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

    // Initialize map gestures on touch devices
    if (isMobile && fullViewBox && svg) {
      mapGestures = createMapGestures(svg, {
        getFullViewBox: () => fullViewBox,
        getViewBox: () => viewbox.parse(),
        setViewBox: (box) => viewbox.set(box),
      });
      // Start zoomed in to ~40% width, centered
      const rect = svg.getBoundingClientRect();
      const aspect = rect.height / rect.width;
      const initW = fullViewBox.width * 0.4;
      const initH = initW * aspect;
      const initBox = {
        x: fullViewBox.x + (fullViewBox.width - initW) / 2,
        y: fullViewBox.y + (fullViewBox.height - initH) / 2,
        width: initW,
        height: initH,
      };
      viewbox.set(initBox);
      mapGestures.enable();
    }

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
    
    renderTrails();
    renderSigilLayer();
    renderInfo(null);

    if (mapApi.preloadSnapshots && shouldPreloadSnapshots) {
      setLoading(true, t("loading.stateViews", { current: 0, total: 0 }));
      await mapApi.preloadSnapshots({ onProgress: updateLoadingProgress });
    }
    setLoading(false);

    // Character selection: check localStorage or prompt user
    const storedCharacter = localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (storedCharacter && CHARACTER_MOVE_MAP[storedCharacter]) {
      selectedCharacter = storedCharacter;
      updateCharacterAvatar();
    } else {
      await waitForCharacterSelection();
    }

    createMapCharacter(true);

    const initialState = new URLSearchParams(window.location.search).get("state");
    if (initialState) {
      selectState(initialState, { pushState: false });
    } else {
      mapCharacterBarkTimers.push(
        setTimeout(() => showMapCharacterBark(t("bark.where")), 2000),
        setTimeout(() => showMapCharacterBark(t("bark.discover")), 10000),
      );
    }
  } catch (error) {
    console.error(error);
    renderInfo(null);
    setSplitLayout(true);
    setLoading(false);
    if (infoContent) {
      infoContent.innerHTML =
        `<h2 class="info-title">${t("error.title")}</h2><div class="info-body">${t("error.body")}</div>`;
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
  // Reset info pane gesture on orientation change
  if (infoPaneGesture?.isMinimized) infoPaneGesture.maximize();
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

// About modal event listeners
aboutClose?.addEventListener("click", () => {
  hideAboutModal();
});

aboutModal?.addEventListener("click", (event) => {
  // Close on backdrop click
  if (event.target === aboutModal) {
    hideAboutModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && aboutModal?.getAttribute("aria-hidden") === "false") {
    hideAboutModal();
  }
  if (event.key === " " && app.classList.contains("is-split") && activeAudio) {
    event.preventDefault();
    if (hourglassPlayer) { hourglassPlayer.togglePlay(); } else { activeAudio.paused ? activeAudio.play() : activeAudio.pause(); }
  }
});

aboutChangeCharacter?.addEventListener("click", () => {
  hideAboutModal();
  removeMapCharacter();
  localStorage.removeItem(CHARACTER_STORAGE_KEY);
  selectedCharacter = null;
  waitForCharacterSelection().then(() => createMapCharacter(true));
});

init();
