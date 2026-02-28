/**
 * @module core/constants
 * Shared constants, magic numbers, CDN URLs, texture files, and configuration.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";

export const THREE_URL = "https://unpkg.com/three@0.164.1/build/three.module.js";
export const SVG_LOADER_URL =
  "https://unpkg.com/three@0.164.1/examples/jsm/loaders/SVGLoader.js?module";

export const TEXTURE_FILES = [
  "assets/textures/VISUALWORKS1 6.png",
  "assets/textures/VISUALWORKS14 1.png",
  "assets/textures/VISUALWORKS23.png",
  "assets/textures/VISUALWORKS25 2.png",
  "assets/textures/VISUALWORKS32 2.png",
  "assets/textures/VISUALWORKS33 1.png",
  "assets/textures/VISUALWORKS36 1.png",
  "assets/textures/VISUALWORKS41 1.png",
  "assets/textures/VISUALWORKS54 1.png",
  "assets/textures/VISUALWORKS57 1.png",
  "assets/textures/VISUALWORKS58 1.png",
];

export const getTextureIndexForState = (stateId) => Number(stateId) - 1;

export const PENULTIMATE_STATE = "10";
export const FINAL_STATE = "11";

export const CHARACTER_STORAGE_KEY = "ataraxie-character";

export const VERSO_IMAGES = [
  "5b1a4325b73c31889926ea89564b9e04.jpg",
  "northlandscapes-iceland-tidal-glitch-01.jpg",
  "1000_F_248110301_ON8MMUUAmDMyUSd4x2BblieSpquwdOXr.jpg",
  "Capture-d'écran-2017-02-23-à-08.53.06-1160x769.png",
  "image (4).jpg",
  "cc7f66c4172364926f5d0ccc3ba8f2e0.jpg",
  "image (3).jpg",
  "1699px-Montreal_-_QC_-_Habitat67_1024x1024.webp",
  "image (2).jpg",
  "3cb0f15caf4d1063bdb183058bcd63e4.jpg",
  "image (1).jpg",
  "7b5bd5915220765cab0fbb32c88079e7.jpg",
  "1450280498071oliver-astrologo-architectural-photography-giuseppe-perugini-ruins-casa-sperimentale-designboom-01.avif",
  "nglkicvkojb91.png",
  "KI-X4010.jpg",
  "images.jpg",
];

export const PREFERS_REDUCED_MOTION = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/** Dev mode: skip animation delays for faster exploration. Activate with ?dev in URL. */
export const DEV_MODE = new URLSearchParams(window.location.search).has("dev");
if (DEV_MODE) document.title = `[DEV] ${document.title}`;
