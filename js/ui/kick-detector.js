/**
 * Kick Detector Module
 * Detects kick drum hits using spectral flux in low-frequency bins
 */

/**
 * @module ui/kick-detector
 * Creates a kick detector with configurable threshold and cooldown
 * @param {number} threshold - Energy delta threshold for kick detection (0.10-0.20)
 * @param {number} cooldown - Minimum time between kicks in ms (250-400)
 * @returns {{detectKick: Function, reset: Function, setThreshold: Function}}
 */
export const createKickDetector = (threshold = 0.15, cooldown = 300) => {
  let lastKickEnergy = 0;
  let lastKickTime = 0;

  /**
   * Detects kick drum from audio frequency data
   * @param {Uint8Array} audioData - FFT frequency data (0-255 per bin)
   * @returns {boolean} True if kick detected
   */
  const detectKick = (audioData) => {
    // Analyze low-frequency bins (0-9: ~60-700 Hz at 256 FFT size)
    const kickBins = 10;
    let kickSum = 0;
    for (let i = 0; i < kickBins; i++) {
      kickSum += audioData[i];
    }

    // Normalize to 0-1 range
    const kickEnergy = kickSum / (kickBins * 255);

    // Calculate spectral flux (energy delta between frames)
    const delta = kickEnergy - lastKickEnergy;

    // Check for kick onset with cooldown
    const now = performance.now();
    const timeSinceLastKick = now - lastKickTime;

    if (delta > threshold && timeSinceLastKick > cooldown) {
      lastKickTime = now;
      lastKickEnergy = kickEnergy;
      return true;
    }

    // Update energy for next frame
    lastKickEnergy = kickEnergy;
    return false;
  };

  /**
   * Resets detection state (call when switching tracks)
   */
  const reset = () => {
    lastKickEnergy = 0;
    lastKickTime = 0;
  };

  /**
   * Updates the detection threshold
   * @param {number} newThreshold - New threshold value (0.10-0.20)
   */
  const setThreshold = (newThreshold) => {
    threshold = newThreshold;
  };

  /**
   * Updates the cooldown period
   * @param {number} newCooldown - New cooldown in ms (250-400)
   */
  const setCooldown = (newCooldown) => {
    cooldown = newCooldown;
  };

  return {
    detectKick,
    reset,
    setThreshold,
    setCooldown,
  };
};
