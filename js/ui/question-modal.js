/**
 * @module ui/question-modal
 * Tarot card question system: binary choices, answer handling, map completion celebration.
 */

import { t } from "../i18n.js";
import { FINAL_STATE } from "../core/constants.js";
import {
  revealedStates,
  isStateRevealed,
  markAsQuestioned,
  getNeighbors,
  revealState,
  addTrail,
} from "../fog.js";

export const createQuestionModal = ({
  infoContent,
  questionModalEl,
  getStateCounts,
  getTrackByState,
  getTrackById,
  getMapApi,
  getTextureCanvas,
  onClearSelection,
}) => {
  const answeredQuestions = new Map();
  let pendingTrail = null;

  const handleAnswer = (revealedStateId, currentStateId) => {
    // Reveal the selected state
    revealState(revealedStateId);

    // Mark current state as questioned
    markAsQuestioned(currentStateId);

    // Record exploration trail
    addTrail(currentStateId, revealedStateId);

    // Update fog on map
    const mapApi = getMapApi();
    if (mapApi?.applyFog) {
      mapApi.applyFog(revealedStates);
    }
    // Update texture canvas
    const textureCanvas = getTextureCanvas();
    if (textureCanvas) {
      textureCanvas.syncWithSvg();
    }

    // Trail drawing is deferred until "Continue exploring" click so user sees the animation
    // Dismissed tarot cards fade to opacity:0 via CSS animation — no DOM removal needed
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

  const attachAnswerHandlers = (answerButtons, stateId, option1, option2) => {
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
              onClearSelection();
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

  const showQuestionModal = (stateId) => {
    // Look up current state's track for hourglassText and choices
    const sourceTrackId = getTrackByState().get(String(stateId));
    const sourceTrack = sourceTrackId ? getTrackById().get(sourceTrackId) : null;
    const choices = sourceTrack?.choices || [];

    // Final state (zero crossing point) — no choices, celebrate
    if (String(stateId) === FINAL_STATE || choices.length === 0) {
      markAsQuestioned(stateId);
      celebrateMapCompletion();
      return;
    }

    // Gather all unrevealed states (excluding ocean)
    const stateCounts = getStateCounts();
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

    // Hourglass text from source track
    const hourglassQuestion = sourceTrack?.hourglassText
      ? sourceTrack.hourglassText.replace(/\n/g, "<br>")
      : t("fallback.direction");

    if (!infoContent) return;

    // If only state 11 remains, offer it as the sole destination
    if (nonFinal.length === 0) {
      const option1 = FINAL_STATE;
      const option2 = FINAL_STATE;
      const label1 = choices[0];
      const label2 = choices[1] || choices[0];
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
                onClearSelection();
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

    // Append question to existing info panel content
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
    attachAnswerHandlers(answerButtons, stateId, option1, option2);
  };

  const hideQuestionModal = () => {
    // Questions now render in info panel, so this just ensures modal stays hidden
    if (questionModalEl) {
      questionModalEl.setAttribute("aria-hidden", "true");
    }
  };

  return {
    showQuestionModal,
    hideQuestionModal,
    getAnsweredQuestion(stateId) {
      return answeredQuestions.get(stateId);
    },
    consumePendingTrail() {
      const trail = pendingTrail;
      pendingTrail = null;
      return trail;
    },
  };
};
