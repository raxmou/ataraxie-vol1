/**
 * @module core/dom-refs
 * Cached DOM element references used across the application.
 */

export const app = document.getElementById("app");
export const svg = document.getElementById("map-svg");
export const mapPane = document.querySelector("#app .map-pane");
export const infoPane = document.getElementById("info-pane");
export const infoContent = document.getElementById("state-content");
export const backButton = document.getElementById("state-back");
export const loadingScreen = document.getElementById("loading-screen");
export const loadingProgress = document.getElementById("loading-progress");
export const questionModal = document.getElementById("question-modal");
export const aboutModal = document.getElementById("about-modal");
export const aboutClose = document.getElementById("about-close");
export const characterSelect = document.getElementById("character-select");
export const characterConfirm = document.getElementById("character-confirm");
export const characterCards = document.querySelectorAll(".character-card[data-character]");
export const aboutChangeCharacter = document.getElementById("about-change-character");
export const finaleModal = document.getElementById("finale-modal");
export const finaleClose = document.getElementById("finale-close");
export const stateCanvas = document.getElementById("state-3d-canvas");
export const threeStack = document.getElementById("state-3d-stack");

export const dataUrl = app?.dataset.geojson;
export const sigilsUrl = app?.dataset.sigils;
export const tracksUrl = app?.dataset.tracks;
export const shouldPreloadSnapshots = app?.dataset.preloadSnapshots === "true";

export const mobileMediaQuery = matchMedia("(max-width: 900px)");
