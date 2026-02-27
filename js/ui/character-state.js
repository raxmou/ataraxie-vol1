/**
 * @module ui/character-state
 * State-view character: floating animation, drag interaction, context menu.
 */

import { getDragPhrases, t } from "../i18n/i18n.js";
import { CHARACTER_MOVE_MAP } from "./character-data.js";
import { PREFERS_REDUCED_MOTION } from "../core/constants.js";

const prefersReducedMotion = PREFERS_REDUCED_MOTION;
const DRAG_PHRASES = getDragPhrases();

export const createStateCharacterManager = ({
  app,
  getHourglassPlayer,
  getActiveAudio,
  getAboutModal,
}) => {
  let stateCharacter = null;
  let stateCharFrameIdx = 0;
  let stateCharInterval = null;
  let stateCharFloatRAF = null;
  let stateCharFloatStart = 0;
  let stateCharDragging = false;

  const startFloat = () => {
    if (prefersReducedMotion || !stateCharacter) return;
    stopFloat();
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

  const stopFloat = () => {
    if (stateCharFloatRAF) {
      cancelAnimationFrame(stateCharFloatRAF);
      stateCharFloatRAF = null;
    }
    if (stateCharacter) {
      stateCharacter.style.transform = "translate(0, 0)";
    }
  };

  const setupDrag = (img) => {
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
      if (bubble) {
        bubble.remove();
        bubble = null;
      }
    };

    const closeMenu = () => {
      if (menu) {
        menu.remove();
        menu = null;
      }
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
      if (menu) {
        closeMenu();
        return;
      }
      hideBubble();

      menu = document.createElement("div");
      menu.className = "state-character-menu";

      const hourglassPlayer = getHourglassPlayer();
      const activeAudio = getActiveAudio();
      const aboutModal = getAboutModal();

      const isPlaying = hourglassPlayer
        ? hourglassPlayer.playing
        : activeAudio && !activeAudio.paused;
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
        {
          label: playLabel,
          action: () => {
            if (hourglassPlayer) {
              hourglassPlayer.togglePlay();
            } else if (activeAudio) {
              activeAudio.paused ? activeAudio.play() : activeAudio.pause();
            }
          },
        },
        {
          label: t("menu.restart"),
          action: () => {
            if (hourglassPlayer) {
              hourglassPlayer.restart();
            } else if (activeAudio) {
              activeAudio.currentTime = 0;
              activeAudio.play().catch(() => {});
            }
          },
        },
        { label: t("menu.meaning"), action: askMeaning },
        { label: t("menu.gestures"), action: showGestureHelp },
        {
          label: t("menu.about"),
          action: () => {
            aboutModal?.setAttribute("aria-hidden", "false");
          },
        },
      ];

      for (const item of items) {
        const btn = document.createElement("button");
        btn.className = "state-character-menu-item";
        btn.textContent = item.label;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeMenu();
          item.action();
        });
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
      stopFloat();
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
      startFloat();
    };

    img.addEventListener("pointerdown", onPointerDown);
    img.addEventListener("pointermove", onPointerMove);
    img.addEventListener("pointerup", onPointerEnd);
    img.addEventListener("pointercancel", onPointerEnd);
  };

  const show = (selectedCharacter) => {
    hide();
    if (!selectedCharacter) return;
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

    setupDrag(img);
    startFloat();
  };

  const hide = () => {
    stopFloat();
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

  return {
    show,
    hide,
    get element() {
      return stateCharacter;
    },
  };
};
