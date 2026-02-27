/**
 * Character Dancer Module
 * Creates tempo-synced character animations with multiple dance moves
 */

// Move configuration: defines looping behavior and kick responsiveness
// Note: idle has weight 0 so it's never selected in ambient rotation (constant motion)
const MOVE_CONFIG = {
  idle: { looping: true, kickResponsive: false, weight: 0 },
  armwave: { looping: false, kickResponsive: false, weight: 0.25 },
  turn: { looping: false, kickResponsive: true, weight: 0 },
  hipshake: { looping: true, kickResponsive: false, weight: 0.4 },
  jump: { looping: false, kickResponsive: true, weight: 0 },
  headbang: { looping: true, kickResponsive: false, weight: 0.35 },
  stomp: { looping: false, kickResponsive: true, weight: 0 },
};

// Fast timing for one-shot moves (ms per frame)
const ONE_SHOT_FRAME_DURATION = 120;

/**
 * Performs weighted random selection
 * @param {string[]} moves - Array of move names
 * @param {number[]} weights - Corresponding weights (must sum to ~1.0)
 * @returns {string} Selected move name
 */
const weightedRandom = (moves, weights) => {
  const random = Math.random();
  let sum = 0;
  for (let i = 0; i < moves.length; i++) {
    sum += weights[i];
    if (random < sum) return moves[i];
  }
  return moves[0]; // Fallback
};

/**
 * @module ui/character-dancer
 * Creates a character dancer that plays multiple animation moves
 * @param {HTMLElement} container - Parent element for the dancer
 * @param {Object} moveSet - Map of move names to frame path arrays
 * @param {number} bpm - Beats per minute for tempo sync
 * @returns {{start: Function, stop: Function, dispose: Function, playMove: Function, onKick: Function, setTempo: Function}}
 */
export const createCharacterDancer = (container, moveSet, bpm = 120) => {
  if (!container || !moveSet || typeof moveSet !== "object") {
    console.warn("Invalid dancer parameters");
    return {
      start: () => {},
      stop: () => {},
      dispose: () => {},
      playMove: () => {},
      onKick: () => {},
      setTempo: () => {},
    };
  }

  // Validate that idle move exists
  if (!moveSet.idle || !Array.isArray(moveSet.idle) || moveSet.idle.length === 0) {
    console.warn("Dancer moveSet must include 'idle' move with frames");
    return {
      start: () => {},
      stop: () => {},
      dispose: () => {},
      playMove: () => {},
      onKick: () => {},
      setTempo: () => {},
    };
  }

  // Create image element
  const img = document.createElement("img");
  img.className = "dancer-frame";
  img.alt = "Dancing character";

  // State
  let currentMove = "idle";
  let currentFrame = 0;
  let animationTimeout = null;
  let isDisposed = false;
  let isPlaying = false;
  let currentBpm = bpm;

  // Check for reduced motion preference
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Calculates frame duration for looping moves based on BPM
   * @param {number} frameCount - Number of frames in the move
   * @returns {number} Duration in ms
   */
  const getLoopingFrameDuration = (frameCount) => {
    return Math.round(60000 / currentBpm / frameCount);
  };

  /**
   * Plays a specific move
   * @param {string} moveType - Name of the move to play
   */
  const playMove = (moveType) => {
    if (isDisposed || !isPlaying) return;

    // Check if move exists
    if (!moveSet[moveType] || !Array.isArray(moveSet[moveType]) || moveSet[moveType].length === 0) {
      console.warn(`Move '${moveType}' not found in moveSet, falling back to idle`);
      moveType = "idle";
    }

    // Clear existing animation
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = null;
    }

    // Update state
    currentMove = moveType;
    currentFrame = 0;
    container.dataset.currentMove = moveType;

    const frames = moveSet[moveType];
    const config = MOVE_CONFIG[moveType] || { looping: true, kickResponsive: false };
    const isLooping = config.looping;
    const frameDuration = isLooping
      ? getLoopingFrameDuration(frames.length)
      : ONE_SHOT_FRAME_DURATION;

    /**
     * Cycles through animation frames
     */
    const cycleFrames = () => {
      if (isDisposed || !isPlaying) return;

      // Set frame
      img.src = frames[currentFrame];
      currentFrame++;

      // Check if move is complete
      if (currentFrame >= frames.length) {
        if (isLooping) {
          currentFrame = 0; // Loop back to start
          animationTimeout = setTimeout(cycleFrames, frameDuration);
        } else {
          // One-shot move complete, pick next ambient move
          onMoveComplete();
        }
      } else {
        // Continue to next frame
        animationTimeout = setTimeout(cycleFrames, frameDuration);
      }
    };

    // Start cycling
    cycleFrames();
  };

  /**
   * Called when a one-shot move completes
   * Selects next ambient move based on weighted probabilities
   */
  const onMoveComplete = () => {
    if (isDisposed || !isPlaying) return;

    // Get all ambient (non-kick-responsive) moves
    const ambientMoves = [];
    const ambientWeights = [];

    for (const [moveName, config] of Object.entries(MOVE_CONFIG)) {
      if (!config.kickResponsive && config.weight > 0 && moveSet[moveName]) {
        ambientMoves.push(moveName);
        ambientWeights.push(config.weight);
      }
    }

    if (ambientMoves.length === 0) {
      // Fallback to idle if no ambient moves available
      playMove("idle");
      return;
    }

    // Select next move using weighted random
    const nextMove = weightedRandom(ambientMoves, ambientWeights);
    playMove(nextMove);
  };

  /**
   * Handles kick drum detection
   * Triggers a random kick-responsive move
   */
  const onKick = () => {
    if (isDisposed || !isPlaying || prefersReducedMotion) return;

    // Get all kick-responsive moves
    const kickMoves = [];
    for (const [moveName, config] of Object.entries(MOVE_CONFIG)) {
      if (config.kickResponsive && moveSet[moveName]) {
        kickMoves.push(moveName);
      }
    }

    if (kickMoves.length === 0) {
      // No kick moves available, ignore
      return;
    }

    // Add kick flash effect
    container.classList.add("is-kicking");
    setTimeout(() => {
      container.classList.remove("is-kicking");
    }, 80);

    // Random kick move selection
    const kickMove = kickMoves[Math.floor(Math.random() * kickMoves.length)];
    playMove(kickMove);
  };

  /**
   * Starts the animation
   */
  const start = () => {
    if (isDisposed) return;

    // Add to container if not already present
    if (!img.parentElement) {
      container.appendChild(img);
    }

    // Fade in with scale
    requestAnimationFrame(() => {
      container.classList.add("is-dancing");
    });

    isPlaying = true;

    // Skip animation if reduced motion is preferred
    if (prefersReducedMotion) {
      img.src = moveSet.idle[0];
      return;
    }

    // Start with a random ambient move (not idle - constant motion)
    const ambientMoves = [];
    const ambientWeights = [];
    for (const [moveName, config] of Object.entries(MOVE_CONFIG)) {
      if (!config.kickResponsive && config.weight > 0 && moveSet[moveName]) {
        ambientMoves.push(moveName);
        ambientWeights.push(config.weight);
      }
    }

    const startMove =
      ambientMoves.length > 0 ? weightedRandom(ambientMoves, ambientWeights) : "idle"; // Fallback only if no ambient moves available

    playMove(startMove);
  };

  /**
   * Stops the animation and resets to idle frame 1
   */
  const stop = () => {
    if (isDisposed) return;

    isPlaying = false;

    // Clear timeout
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = null;
    }

    // Reset to idle frame 1
    currentMove = "idle";
    currentFrame = 0;
    img.src = moveSet.idle[0];
    delete container.dataset.currentMove;

    // Keep visible but stopped
  };

  /**
   * Updates the tempo (BPM) for looping moves
   * @param {number} newBpm - New beats per minute
   */
  const setTempo = (newBpm) => {
    if (typeof newBpm !== "number" || newBpm <= 0) return;
    currentBpm = newBpm;

    // If currently playing a looping move, restart with new timing
    const config = MOVE_CONFIG[currentMove];
    if (isPlaying && config && config.looping) {
      playMove(currentMove);
    }
  };

  /**
   * Cleans up and removes the dancer
   */
  const dispose = () => {
    if (isDisposed) return;
    isDisposed = true;
    isPlaying = false;

    // Stop animation
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = null;
    }

    // Fade out
    container.classList.remove("is-dancing");
    container.classList.remove("is-kicking");
    delete container.dataset.currentMove;

    // Remove after transition
    setTimeout(() => {
      if (img.parentElement) {
        img.parentElement.removeChild(img);
      }
    }, 400); // Match CSS transition duration
  };

  return {
    start,
    stop,
    dispose,
    playMove,
    onKick,
    setTempo,
  };
};
