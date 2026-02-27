/**
 * @module audio/hourglass/hourglass-audio
 * Reverse playback via Web Audio API.
 */

/**
 * Factory for reverse audio playback.
 * @param {HTMLAudioElement} audio - The audio element to reverse
 */
export const createReverseAudio = (audio) => {
  let audioCtx = null;
  let reversedBuffer = null;
  let reverseSource = null;
  let reverseStartCtxTime = 0;
  let reverseStartOffset = 0;
  let isPlayingReversed = false;

  const ensureContext = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  };

  /** Fetch + decode audio, then reverse the buffer data. */
  const prepare = async () => {
    if (reversedBuffer) return;
    const src = audio.currentSrc || audio.src;
    if (!src) return;
    try {
      const ctx = ensureContext();
      const resp = await fetch(src);
      const buf = await resp.arrayBuffer();
      const original = await ctx.decodeAudioData(buf);
      reversedBuffer = ctx.createBuffer(
        original.numberOfChannels,
        original.length,
        original.sampleRate,
      );
      for (let ch = 0; ch < original.numberOfChannels; ch++) {
        const fwd = original.getChannelData(ch);
        const rev = reversedBuffer.getChannelData(ch);
        for (let i = 0, len = fwd.length; i < len; i++) {
          rev[i] = fwd[len - 1 - i];
        }
      }
    } catch (_) {
      // Reverse audio unavailable — silent fallback
    }
  };

  const start = (forwardTime, speed) => {
    if (!reversedBuffer) return;
    stop();
    const ctx = ensureContext();
    const offset = Math.max(0, reversedBuffer.duration - forwardTime);
    reverseSource = ctx.createBufferSource();
    reverseSource.buffer = reversedBuffer;
    reverseSource.playbackRate.value = Math.min(4, Math.max(0.25, Math.abs(speed)));
    reverseSource.connect(ctx.destination);
    reverseSource.start(0, offset);
    reverseStartCtxTime = ctx.currentTime;
    reverseStartOffset = offset;
    isPlayingReversed = true;
  };

  const stop = () => {
    if (reverseSource) {
      try {
        reverseSource.stop();
      } catch (_) {}
      reverseSource.disconnect();
      reverseSource = null;
    }
    isPlayingReversed = false;
  };

  /** Map current position in reversed buffer back to forward time. */
  const getForwardTime = () => {
    if (!isPlayingReversed || !audioCtx || !reversedBuffer) return audio.currentTime || 0;
    const elapsed = audioCtx.currentTime - reverseStartCtxTime;
    const rate = reverseSource ? reverseSource.playbackRate.value : 1;
    const pos = reverseStartOffset + elapsed * rate;
    return Math.max(0, reversedBuffer.duration - pos);
  };

  const setSpeed = (speed) => {
    if (isPlayingReversed && reverseSource) {
      reverseSource.playbackRate.value = Math.min(4, Math.max(0.25, Math.abs(speed)));
    }
  };

  const dispose = () => {
    stop();
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    reversedBuffer = null;
  };

  return {
    prepare,
    start,
    stop,
    getForwardTime,
    setSpeed,
    dispose,
    get isReversed() {
      return isPlayingReversed;
    },
    get hasBuffer() {
      return !!reversedBuffer;
    },
  };
};
