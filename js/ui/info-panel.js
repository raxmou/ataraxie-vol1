/**
 * @module ui/info-panel
 * Info panel: narrative text, track shrine with hourglass player, audio lifecycle.
 */

import { t } from "../i18n/i18n.js";
import { createHourglassPlayer } from "../audio/hourglass/hourglass-player.js";
import { PREFERS_REDUCED_MOTION, DEV_MODE } from "../core/constants.js";

const prefersReducedMotion = PREFERS_REDUCED_MOTION;

export const createInfoPanel = ({
  infoContent,
  app,
  getActiveStateId,
  getGeojsonData,
  getTrackByState,
  getTrackById,
  getStateCharElement,
  onShowQuestionModal,
  startAudioReactive,
  stopAudioReactive,
}) => {
  let hourglassPlayer = null;
  let activeAudio = null;

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
      if (String(getActiveStateId()) === "11") {
        const tryBark = () => {
          const charEl = getStateCharElement();
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
      requestAnimationFrame(() => onShowQuestionModal(pendingQuestion));
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
    if (!getGeojsonData()) {
      infoContent.innerHTML = `<div class="info-body">${t("info.loading")}</div>`;
      return;
    }
    const trackId = getTrackByState().get(String(stateId));
    const track = trackId ? getTrackById().get(trackId) : null;

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
        const delay = DEV_MODE ? 0 : (i + 1) * 1.2;
        return `<p class="narrative-line" style="animation-delay: ${delay}s">${line}</p>`;
      })
      .join("");
    const playDelay = DEV_MODE ? 0 : (narrativeLines.length + 1) * 1.2;
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

  return {
    renderInfo,
    get hourglassPlayer() {
      return hourglassPlayer;
    },
    get activeAudio() {
      return activeAudio;
    },
  };
};
