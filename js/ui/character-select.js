/**
 * @module ui/character-select
 * Character selection modal: show/hide, card interactions, fly animation.
 */

import { CHARACTER_MOVE_MAP, getCharacterFrame } from "./character-data.js";
import { CHARACTER_STORAGE_KEY, PREFERS_REDUCED_MOTION } from "../core/constants.js";
import { easeInOutCubic } from "../core/utils.js";

const prefersReducedMotion = PREFERS_REDUCED_MOTION;

export const createCharacterSelect = ({
  characterSelect,
  characterCards,
  characterConfirm,
  svg,
  getStateCenter,
  getMarkerRadius,
}) => {
  const show = () => {
    if (characterSelect) {
      const card = characterSelect.querySelector(".character-select-card");
      characterCards.forEach((c) => c.classList.remove("is-selected"));
      if (characterConfirm) characterConfirm.hidden = true;
      if (card) card.classList.remove("is-card-visible");
      characterSelect.classList.add("is-logo-intro");
      characterSelect.setAttribute("aria-hidden", "false");
      const delay = prefersReducedMotion ? 0 : 4800;
      setTimeout(() => {
        characterSelect.classList.remove("is-logo-intro");
        if (card) card.classList.add("is-card-visible");
      }, delay);
    }
  };

  const hide = () => {
    if (characterSelect) {
      characterSelect.style.transition = "none";
      characterSelect.setAttribute("aria-hidden", "true");
      characterSelect.classList.remove("is-flying-out", "is-bg-fading");
      requestAnimationFrame(() => {
        characterSelect.style.transition = "";
      });
    }
  };

  const flyToMap = (character) =>
    new Promise((resolve) => {
      const selectedCard = document.querySelector(".character-card.is-selected");
      const cardImg = selectedCard?.querySelector(".character-card-img");
      if (!cardImg || !characterSelect || !svg) {
        hide();
        return resolve();
      }

      const stateCenter = getStateCenter("1");
      const ctm = svg.getScreenCTM();
      if (!stateCenter || !ctm) {
        hide();
        return resolve();
      }

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
      const hipshakeInterval =
        frames.length > 0
          ? setInterval(() => {
              frameIdx = (frameIdx + 1) % frames.length;
              flyer.src = frames[frameIdx];
            }, 125)
          : null;

      characterSelect.classList.add("is-flying-out");
      setTimeout(() => characterSelect.classList.add("is-bg-fading"), 250);

      const flightDelay = 300;
      const flightDuration = 800;

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
            hide();
            setTimeout(() => {
              flyer.remove();
              resolve();
            }, 300);
          }
        };
        requestAnimationFrame(step);
      }, flightDelay);
    });

  const waitForSelection = (onSelect) =>
    new Promise((resolve) => {
      show();

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
        selectCard(e.currentTarget);
      };

      const handleConfirm = () => {
        const selected = document.querySelector(".character-card.is-selected");
        if (!selected) return;
        const character = selected.dataset.character;
        onSelect(character);
        localStorage.setItem(CHARACTER_STORAGE_KEY, character);
        cleanup();
        if (prefersReducedMotion) {
          hide();
          resolve(character);
        } else {
          const hipFrames = CHARACTER_MOVE_MAP[character]?.hipshake || [];
          Promise.all(
            hipFrames.map(
              (src) =>
                new Promise((r) => {
                  const i = new Image();
                  i.onload = i.onerror = r;
                  i.src = src;
                }),
            ),
          ).then(() => flyToMap(character).then(() => resolve(character)));
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

  return { show, hide, flyToMap, waitForSelection };
};
