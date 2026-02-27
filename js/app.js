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
import { createInfoPaneGesture } from "./info-pane-gesture.js";
import { createMapGestures } from "./map-gestures.js";
import { createThreeMorph } from "./three/three-morph.js";
import { CHARACTER_MOVE_MAP } from "./ui/character-data.js";
import { CHARACTER_STORAGE_KEY, PREFERS_REDUCED_MOTION } from "./core/constants.js";
import { createAudioReactive } from "./audio/audio-reactive.js";
import { resolveSigilMap, createSigilManager } from "./map/sigils.js";
import { createThreeInteraction } from "./three/three-interaction.js";
import { createCharacterSelect } from "./ui/character-select.js";
import { createMapCharacterManager } from "./ui/character-map.js";
import { createStateCharacterManager } from "./ui/character-state.js";
import { createInfoPanel } from "./ui/info-panel.js";
import { createQuestionModal } from "./ui/question-modal.js";
import {
  revealedStates,
  isStateRevealed,
  hasBeenQuestioned,
  buildStateNeighborMap,
  explorationTrails,
  explorationOrder,
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
let trackByState = new Map();
let trackById = new Map();
let colorForState = null;
let textureCanvas = null;
let sigilsByState = new Map();
let selectedCharacter = null;
let infoPaneGesture = null;
let mapGestures = null;

const audioReactive = createAudioReactive({
  getSvg: () => svg,
  getMapPane: () => mapPane,
  getThreeApi: () => threeMorph?.api,
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
  getThreeApi: () => threeMorph?.api,
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
  getHourglassPlayer: () => infoPanel?.hourglassPlayer,
  getActiveAudio: () => infoPanel?.activeAudio,
  getAboutModal: () => aboutModal,
});
const showStateCharacter = () => stateCharMgr.show(selectedCharacter);
const hideStateCharacter = () => stateCharMgr.hide();

// infoPanel and questionMgr use forward-referenced callbacks (clearSelection, etc.)
// — safe because callbacks are only invoked at runtime, after all declarations
const infoPanel = createInfoPanel({
  infoContent,
  app,
  getActiveStateId: () => activeStateId,
  getGeojsonData: () => geojsonData,
  getTrackByState: () => trackByState,
  getTrackById: () => trackById,
  getStateCharElement: () => stateCharMgr.element,
  onShowQuestionModal: (stateId) => questionMgr.showQuestionModal(stateId),
  startAudioReactive,
  stopAudioReactive,
});
const renderInfo = (stateId, opts) => infoPanel.renderInfo(stateId, opts);

const questionMgr = createQuestionModal({
  infoContent,
  questionModalEl: questionModal,
  getStateCounts: () => stateCounts,
  getTrackByState: () => trackByState,
  getTrackById: () => trackById,
  getMapApi: () => mapApi,
  getTextureCanvas: () => textureCanvas,
  onClearSelection: () => clearSelection(),
});
const hideQuestionModal = () => questionMgr.hideQuestionModal();

const viewbox = createViewBoxAnimator(svg, { prefersReducedMotion });

// threeMorph uses forward-referenced setSplitLayout/setAnimating (defined below)
// — safe because callbacks are only invoked at runtime, after all declarations
const threeMorph = createThreeMorph({
  stateCanvas,
  mapPane,
  threeStack,
  threeInteraction,
  getGeojsonData: () => geojsonData,
  getTrackByState: () => trackByState,
  getTrackById: () => trackById,
  getColorForState: () => colorForState,
  getHourglassPlayer: () => infoPanel?.hourglassPlayer,
  setSplitLayout: (v) => setSplitLayout(v),
  setAnimating: (v) => setAnimating(v),
  startAmbientBreathing,
  stopAmbientBreathing,
});
const { showState3D, morphTo3D, hideState3D } = threeMorph;
const resizeThree = () => threeMorph.resizeThree();

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
    skipQuestion ? questionMgr.getAnsweredQuestion(normalized) || null : null;

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


const hideAboutModal = () => {
  if (aboutModal) {
    aboutModal.setAttribute("aria-hidden", "true");
  }
};



const clearSelection = (options = {}) => {
  // Draw pending trail if exists (from answered question)
  const trail = questionMgr.consumePendingTrail();
  if (trail) {
    const { from, to } = trail;
    setTimeout(() => {
      drawTrailSegment(from, to);
      updateMapCharacterPosition(to, from, true);
    }, 300);
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
  if (event.key === " " && app.classList.contains("is-split") && infoPanel.activeAudio) {
    event.preventDefault();
    if (infoPanel.hourglassPlayer) {
      infoPanel.hourglassPlayer.togglePlay();
    } else {
      infoPanel.activeAudio.paused ? infoPanel.activeAudio.play() : infoPanel.activeAudio.pause();
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
