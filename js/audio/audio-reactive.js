/**
 * @module audio/audio-reactive
 * Web Audio analyser, FFT-driven map/3D visuals, and ambient terrain breathing.
 */

import { fbmNoise2D, valueNoise2D } from "../core/utils.js";

const computeBreathingHeight = (cell, time, baseHeight, maxHeight) => {
  const breath = fbmNoise2D(cell.x * 0.8 + time * 0.12, cell.y * 0.8 + time * 0.09, 2);
  const ripple = fbmNoise2D(cell.x * 2.5 + time * 0.35, cell.y * 2.5 - time * 0.28, 2);
  const shimmer = valueNoise2D(cell.x * 6.0 + time * 0.8, cell.y * 6.0 + time * 0.6);
  const envelope = 0.5 + 0.5 * Math.sin(time * 0.4 + cell.breathePhase);
  const combined = breath * 0.6 + ripple * 0.25 + shimmer * 0.15;
  const breatheAmp = maxHeight * 0.3 * cell.weight;
  return baseHeight + combined * breatheAmp * (0.7 + envelope * 0.3);
};

const computeAudioResponse = (cell, data, maxBin) => {
  const centerBin = cell.freqCenter * maxBin;
  const sigma = cell.freqWidth * maxBin;
  const sigmaSq2 = 2 * sigma * sigma;
  const lo = Math.max(0, Math.floor(centerBin - sigma * 2));
  const hi = Math.min(maxBin, Math.ceil(centerBin + sigma * 2));
  let wSum = 0,
    wTotal = 0;
  for (let b = lo; b <= hi; b++) {
    const d = b - centerBin;
    const g = Math.exp(-(d * d) / sigmaSq2);
    wSum += (data[b] / 255) * g;
    wTotal += g;
  }
  const amp = wTotal > 0 ? wSum / wTotal : 0;
  return Math.pow(amp, 1.8) * cell.sensitivity;
};

export const createAudioReactive = ({ getSvg, getMapPane, getThreeApi }) => {
  let audioContext = null;
  let audioAnalyser = null;
  let audioData = null;
  let audioAnimationFrame = null;
  let audioSource = null;
  let audioElement = null;
  let audioTime = 0;
  let ambientAnimationFrame = null;
  let ambientTime = 0;

  const resetVisuals = () => {
    const svg = getSvg();
    if (!svg) return;
    svg.style.setProperty("--audio-stroke", "0.6px");
    svg.style.setProperty("--audio-opacity", "0.85");
    svg.style.setProperty("--audio-glow", "0px");
  };

  const resetMeshPulse = () => {
    const threeApi = getThreeApi();
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

  const startBreathing = () => {
    if (ambientAnimationFrame) return;
    const tick = () => {
      ambientTime += 0.016;
      const mapPane = getMapPane();
      const threeApi = getThreeApi();
      const is3d = mapPane?.classList.contains("is-3d");
      if (is3d && threeApi?.mesh) {
        const {
          terrainData,
          terrainTopZ,
          terrainBaseHeight,
          terrainMaxHeight,
          terrainHeights,
          terrainNeighbors,
        } = threeApi.mesh.userData || {};
        if (Array.isArray(terrainData) && terrainBaseHeight != null) {
          const rawHeights = new Float32Array(terrainData.length);
          terrainData.forEach((cell, index) => {
            rawHeights[index] = computeBreathingHeight(
              cell,
              ambientTime,
              terrainBaseHeight,
              terrainMaxHeight,
            );
          });
          terrainData.forEach((cell, index) => {
            const neighbors = terrainNeighbors ? terrainNeighbors[index] : null;
            let nSum = 0,
              nCount = 0;
            if (neighbors && neighbors.length) {
              neighbors.forEach((ni) => {
                nSum += rawHeights[ni];
                nCount++;
              });
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

  const stopBreathing = () => {
    if (ambientAnimationFrame) cancelAnimationFrame(ambientAnimationFrame);
    ambientAnimationFrame = null;
  };

  const connectAnalyser = (audio) => {
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

  const stopReactive = () => {
    if (audioAnimationFrame) cancelAnimationFrame(audioAnimationFrame);
    audioAnimationFrame = null;
    resetVisuals();
    startBreathing();
  };

  const startReactive = (audio) => {
    const svg = getSvg();
    if (!audio || !svg) return;
    connectAnalyser(audio);
    if (!audioAnalyser || !audioData) return;
    audioTime = 0;
    stopBreathing();

    const tick = () => {
      if (!audioAnalyser || !audioData) return;
      audioAnalyser.getByteFrequencyData(audioData);
      audioTime += 0.016;

      const totalBins = audioData.length;
      const lowEnd = Math.max(1, Math.floor(totalBins * 0.2));
      const highStart = Math.floor(totalBins * 0.7);
      let lowSum = 0,
        highSum = 0;
      for (let i = 0; i < lowEnd; i++) lowSum += audioData[i];
      for (let i = highStart; i < totalBins; i++) highSum += audioData[i];
      const low = lowSum / (lowEnd * 255);
      const high = highSum / ((totalBins - highStart) * 255);
      const intensity = Math.min(1, (low + high) / 2);
      const stroke = 0.6 + intensity * 1.8;
      const glow = intensity * 10;
      const opacity = 0.45 + intensity * 0.5;

      const mapPane = getMapPane();
      const threeApi = getThreeApi();
      const is3d = mapPane?.classList.contains("is-3d");
      if (is3d && threeApi?.mesh) {
        const {
          terrainData,
          terrainTopZ,
          terrainBaseHeight,
          terrainMaxHeight,
          terrainNeighbors,
          terrainHeights,
          terrainEnergy,
        } = threeApi.mesh.userData || {};

        if (Array.isArray(terrainData) && terrainBaseHeight != null && terrainMaxHeight != null) {
          const maxBin = audioData.length - 1;
          const rawHeights = new Float32Array(terrainData.length);

          terrainData.forEach((cell, index) => {
            const breathe = computeBreathingHeight(
              cell,
              audioTime,
              terrainBaseHeight,
              terrainMaxHeight,
            );
            const audioAmp = computeAudioResponse(cell, audioData, maxBin);
            rawHeights[index] = breathe + audioAmp * terrainMaxHeight * cell.weight * 0.7;
          });

          if (terrainEnergy) {
            terrainData.forEach((cell, index) => {
              const e = rawHeights[index] - terrainBaseHeight;
              terrainEnergy[index] = Math.max(terrainEnergy[index] * 0.85, e);
            });
            terrainData.forEach((cell, index) => {
              const neighbors = terrainNeighbors ? terrainNeighbors[index] : null;
              if (!neighbors || !neighbors.length) return;
              let ne = 0;
              neighbors.forEach((ni) => {
                ne += terrainEnergy[ni];
              });
              rawHeights[index] += (ne / neighbors.length) * 0.12;
            });
          }

          terrainData.forEach((cell, index) => {
            const neighbors = terrainNeighbors ? terrainNeighbors[index] : null;
            let nSum = 0,
              nCount = 0;
            if (neighbors && neighbors.length) {
              neighbors.forEach((ni) => {
                nSum += rawHeights[ni];
                nCount++;
              });
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

  return {
    connectAnalyser,
    startReactive,
    stopReactive,
    startBreathing,
    stopBreathing,
    resetVisuals,
    resetMeshPulse,
    get context() {
      return audioContext;
    },
    get analyser() {
      return audioAnalyser;
    },
  };
};
