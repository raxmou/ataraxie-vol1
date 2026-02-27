import {
  getLang,
  setLang,
  t,
  getTracksUrl,
  applyStaticTranslations,
} from "./i18n.js";
import { loadGeoJSON, loadSigils, loadTracks } from "./data.js";
import { createMap, createStateColor } from "./map.js";
import { createViewBoxAnimator, createTransformAnimator } from "./viewbox.js";
import { createTextureCanvas } from "./texture-canvas.js";
import { createHourglassPlayer } from "./hourglass-player.js";
import { createInfoPaneGesture } from "./info-pane-gesture.js";
import { createMapGestures } from "./map-gestures.js";
import {
  initThree as initThreeScene,
  resizeRenderer,
  disposeThreeObject,
  applyInertiaRotation,
} from "./three/three-scene.js";
import { buildStateMesh, loadBgTexture } from "./three/three-mesh.js";
import { CHARACTER_MOVE_MAP } from "./ui/character-data.js";
import { FINAL_STATE, CHARACTER_STORAGE_KEY, PREFERS_REDUCED_MOTION } from "./core/constants.js";
import { easeInOutCubic } from "./core/utils.js";
import { createAudioReactive } from "./audio/audio-reactive.js";
import { resolveSigilMap, createSigilManager } from "./map/sigils.js";
import { createThreeInteraction } from "./three/three-interaction.js";
import { createCharacterSelect } from "./ui/character-select.js";
import { createMapCharacterManager } from "./ui/character-map.js";
import { createStateCharacterManager } from "./ui/character-state.js";
import {
  revealedStates,
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

import {
  app,
  svg,
  mapPane,
  infoPane,
  infoContent,
  backButton,
  loadingScreen,
  loadingProgress,
  questionModal,
  aboutModal,
  aboutClose,
  characterSelect,
  characterConfirm,
  characterCards,
  aboutChangeCharacter,
  stateCanvas,
  threeStack,
  dataUrl,
  sigilsUrl,
  tracksUrl,
  shouldPreloadSnapshots,
  mobileMediaQuery,
} from "./core/dom-refs.js";

const prefersReducedMotion = PREFERS_REDUCED_MOTION;

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
let textureCanvas = null;
let sigilsByState = new Map();
let hourglassPlayer = null;
let pendingTrail = null; // Stores {from, to} for deferred trail drawing
const answeredQuestions = new Map(); // Stores stateId -> {option1, option2, chosen}
let isMorphing = false;
let questionTimeout = null;
let selectedCharacter = null;
let infoPaneGesture = null;
let mapGestures = null;

const audioReactive = createAudioReactive({
  getSvg: () => svg,
  getMapPane: () => mapPane,
  getThreeApi: () => threeApi,
});
const startAudioReactive = (audio) => audioReactive.startReactive(audio);
const stopAudioReactive = () => audioReactive.stopReactive();
const startAmbientBreathing = () => audioReactive.startBreathing();
const stopAmbientBreathing = () => audioReactive.stopBreathing();

const sigils = createSigilManager({
  svg,
  getMapApi: () => mapApi,
  getSigilsByState: () => sigilsByState,
});
const { showHoverSigil, hideHoverSigil, renderFocusSigil, renderSigilLayer, clearFocusSigilLayer } =
  sigils;

const threeInteraction = createThreeInteraction({
  stateCanvas,
  getThreeApi: () => threeApi,
});
threeInteraction.init();

const mapCharMgr = createMapCharacterManager({
  svg,
  getMapApi: () => mapApi,
  getFullViewBox: () => fullViewBox,
  getSelectedCharacter: () => selectedCharacter,
  getExplorationTrails: () => explorationTrails,
  getExplorationOrder: () => explorationOrder,
  getMapPane: () => mapPane,
});
const {
  create: createMapCharacter,
  remove: removeMapCharacter,
  renderTrails,
  drawTrailSegment,
  updatePosition: updateMapCharacterPosition,
  showBark: showMapCharacterBark,
  hideBark: hideMapCharacterBark,
  getStateCenter,
  getMarkerRadius,
} = mapCharMgr;

const charSelect = createCharacterSelect({
  characterSelect,
  characterCards,
  characterConfirm,
  svg,
  getStateCenter,
  getMarkerRadius,
});

const stateCharMgr = createStateCharacterManager({
  app,
  getHourglassPlayer: () => hourglassPlayer,
  getActiveAudio: () => activeAudio,
  getAboutModal: () => aboutModal,
});
const showStateCharacter = () => stateCharMgr.show(selectedCharacter);
const hideStateCharacter = () => stateCharMgr.hide();

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

const resizeThree = () => {
  resizeRenderer(threeApi, stateCanvas);
};

const initThree = async () => {
  if (threeInitPromise) return threeInitPromise;
  threeInitPromise = (async () => {
    const api = await initThreeScene(stateCanvas);
    if (api) threeApi = api;
    return threeApi;
  })();
  return threeInitPromise;
};



const startThreeRender = () => {
  if (!threeApi) return;
  const renderLoop = () => {
    if (!threeApi) return;
    if (threeApi.mesh && !threeInteraction.isDragging && !isMorphing) {
      const speed = hourglassPlayer ? hourglassPlayer.speed : 1;
      threeApi.mesh.rotation.z += 0.002 * speed;
      const inertia = applyInertiaRotation(
        threeApi.mesh,
        threeInteraction.inertiaX,
        threeInteraction.inertiaY,
        { min: -1.6, max: -0.2 },
      );
      threeInteraction.setInertia(inertia.x, inertia.y);
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
  threeInteraction.resetInertia();
  const mesh = buildStateMesh(stateId, api.THREE, {
    geojsonData,
    trackByState,
    trackById,
    colorForState,
  });
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
  threeInteraction.resetInertia();
  if (!threeApi) return;
  if (threeApi.mesh) {
    threeApi.scene.remove(threeApi.mesh);
    disposeThreeObject(threeApi.mesh);
    threeApi.mesh = null;
  }
  stopThreeRender();
};

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
    finish,
  );
};

const renderInfo = (stateId, infoOptions = {}) => {
  if (!infoContent) return;
  const narrativeBackBtn = document.getElementById("narrative-back");
  if (narrativeBackBtn) narrativeBackBtn.hidden = true;
  if (!stateId) {
    infoContent.innerHTML = `<h2 class="info-title">${t("info.explore")}</h2><div class="info-body">${t("info.selectState")}</div>`;
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
  const linesMarkup = narrativeLines
    .map((line, i) => {
      const delay = (i + 1) * 1.2;
      return `<p class="narrative-line" style="animation-delay: ${delay}s">${line}</p>`;
    })
    .join("");
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
        const charEl = stateCharMgr.element;
        if (!charEl) return setTimeout(tryBark, 300);
        const bubble = document.createElement("div");
        bubble.className = "state-character-bubble";
        bubble.textContent = t("bark.finale");
        charEl.parentElement.appendChild(bubble);
        const positionBubble = () => {
          const rect = charEl.getBoundingClientRect();
          const parentRect = (charEl.offsetParent || app).getBoundingClientRect();
          bubble.style.left = `${rect.left - parentRect.left + rect.width / 2}px`;
          bubble.style.top = `${rect.top - parentRect.top - 12}px`;
        };
        positionBubble();
        const origSync = charEl._syncOverlays;
        charEl._syncOverlays = () => {
          if (origSync) origSync();
          if (bubble.parentElement) positionBubble();
        };
        setTimeout(() => {
          bubble.remove();
          charEl._syncOverlays = origSync;
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
  const linesMarkup = narrativeLines
    .map((line) => {
      return `<p class="narrative-line is-visible">${line}</p>`;
    })
    .join("");
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
  const pendingResult =
    skipQuestion && answeredQuestions.has(normalized) ? answeredQuestions.get(normalized) : null;

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
    infoContent.insertAdjacentHTML("beforeend", questionMarkup);
    const answerButtons = infoContent.querySelectorAll(".answer-btn");
    answerButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        answerButtons.forEach((b) => {
          b.disabled = true;
        });
        btn.classList.add("answer-btn--selected");
        answerButtons.forEach((b) => {
          if (b !== btn) b.classList.add("answer-btn--dismissed");
        });
        setTimeout(() => {
          handleAnswer(FINAL_STATE, stateId);
          const chosenLabel = btn.querySelector(".tarot-card-label")?.textContent || "";
          answeredQuestions.set(stateId, { option1, option2, chosen: FINAL_STATE, chosenLabel });
          pendingTrail = { from: stateId, to: FINAL_STATE };
          const container = infoContent?.querySelector(".question-container");
          if (container) {
            const continueBtn = document.createElement("button");
            continueBtn.className = "answer-btn answer-btn--continue";
            continueBtn.type = "button";
            continueBtn.textContent = t("continue.exploring");
            continueBtn.addEventListener("click", () => {
              clearSelection();
            });
            container.appendChild(continueBtn);
            setTimeout(() => {
              continueBtn.scrollIntoView({ behavior: "smooth", block: "end" });
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

  infoContent.insertAdjacentHTML("beforeend", questionMarkup);

  // Add click handlers to answer buttons
  const answerButtons = infoContent.querySelectorAll(".answer-btn");
  answerButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const answer = btn.dataset.answer;
      if (!answer) return;
      // Disable all buttons immediately
      answerButtons.forEach((b) => {
        b.disabled = true;
      });
      // Animate: keep selected, dismiss the other
      btn.classList.add("answer-btn--selected");
      answerButtons.forEach((b) => {
        if (b !== btn) b.classList.add("answer-btn--dismissed");
      });
      setTimeout(() => {
        handleAnswer(answer, stateId);
        // Store answer for revisit rendering (include chosenLabel for revisit display)
        const chosenLabel = btn.querySelector(".tarot-card-label")?.textContent || "";
        answeredQuestions.set(stateId, {
          option1,
          option2: option2 || option1,
          chosen: answer,
          chosenLabel,
        });
        // Store pending trail for deferred drawing (when user clicks back or continue)
        pendingTrail = { from: stateId, to: answer };
        const container = infoContent?.querySelector(".question-container");
        if (container) {
          const continueBtn = document.createElement("button");
          continueBtn.className = "answer-btn answer-btn--continue";
          continueBtn.type = "button";
          continueBtn.textContent = t("continue.exploring");
          continueBtn.addEventListener("click", () => {
            clearSelection();
          });
          container.appendChild(continueBtn);
          setTimeout(() => {
            continueBtn.scrollIntoView({ behavior: "smooth", block: "end" });
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
      document
        .getElementById("mobile-warning-dismiss")
        .addEventListener("click", resolve, { once: true });
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
    } else {
      await charSelect.waitForSelection((char) => {
        selectedCharacter = char;
      });
    }

    createMapCharacter(true);

    const initialState = new URLSearchParams(window.location.search).get("state");
    if (initialState) {
      selectState(initialState, { pushState: false });
    } else {
      mapCharMgr.barkTimers.push(
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
      infoContent.innerHTML = `<h2 class="info-title">${t("error.title")}</h2><div class="info-body">${t("error.body")}</div>`;
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
    if (hourglassPlayer) {
      hourglassPlayer.togglePlay();
    } else {
      activeAudio.paused ? activeAudio.play() : activeAudio.pause();
    }
  }
});

aboutChangeCharacter?.addEventListener("click", () => {
  hideAboutModal();
  removeMapCharacter();
  localStorage.removeItem(CHARACTER_STORAGE_KEY);
  selectedCharacter = null;
  charSelect.waitForSelection((char) => {
    selectedCharacter = char;
  }).then(() => createMapCharacter(true));
});

init();
