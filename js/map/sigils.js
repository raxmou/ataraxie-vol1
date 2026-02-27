/**
 * @module map/sigils
 * Sigil hover and focus rendering on the SVG map overlay.
 */

import { SVG_NS } from "../core/constants.js";
import { clamp } from "../core/utils.js";

const SIGIL_LAYER_ID = "map-sigils";

export const resolveSigilMap = (payload) => {
  if (!payload || typeof payload !== "object") return new Map();
  const entries = payload.states && typeof payload.states === "object" ? payload.states : payload;
  return new Map(Object.entries(entries || {}).map(([stateId, href]) => [String(stateId), href]));
};

export const createSigilManager = ({ svg, getMapApi, getSigilsByState }) => {
  let sigilLayer = null;
  let focusSigilLayer = null;
  let hoverSigilImage = null;
  let hoverSigilStateId = null;
  let hoverSigilToken = 0;

  const getBaseSize = () => {
    const mapApi = getMapApi();
    const baseBox = mapApi?.fullViewBox;
    return baseBox ? clamp(Math.min(baseBox.width, baseBox.height) * 0.032, 10, 24) : 16;
  };

  const clearSigilLayer = () => {
    if (!sigilLayer) return;
    sigilLayer.remove();
    sigilLayer = null;
    hoverSigilImage = null;
    hoverSigilStateId = null;
  };

  const clearFocusSigilLayer = () => {
    if (!focusSigilLayer) return;
    focusSigilLayer.remove();
    focusSigilLayer = null;
  };

  const hideHoverSigil = () => {
    if (!sigilLayer) return;
    sigilLayer.classList.remove("is-visible");
    sigilLayer.classList.remove("is-animating");
    hoverSigilStateId = null;
    hoverSigilToken += 1;
    delete sigilLayer.dataset.hoverToken;
  };

  const showHoverSigil = (stateId) => {
    const mapApi = getMapApi();
    const sigilsByState = getSigilsByState();
    if (!sigilLayer || !hoverSigilImage || !mapApi) return;
    if (!stateId || stateId === "0") {
      hideHoverSigil();
      return;
    }
    const href = sigilsByState.get(String(stateId));
    if (!href) {
      hideHoverSigil();
      return;
    }
    const bounds = mapApi.getStateBounds(stateId);
    if (!bounds) {
      hideHoverSigil();
      return;
    }
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      hideHoverSigil();
      return;
    }
    const size = getBaseSize() * 1.1;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const resolvedHref = encodeURI(href);
    hoverSigilImage.setAttribute("href", resolvedHref);
    hoverSigilImage.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", resolvedHref);
    hoverSigilImage.setAttribute("x", (centerX - size / 2).toFixed(3));
    hoverSigilImage.setAttribute("y", (centerY - size / 2).toFixed(3));
    hoverSigilImage.setAttribute("width", size.toFixed(3));
    hoverSigilImage.setAttribute("height", size.toFixed(3));
    hoverSigilImage.dataset.state = String(stateId);
    const nextState = String(stateId);
    if (hoverSigilStateId !== nextState) {
      hoverSigilToken += 1;
      const token = hoverSigilToken;
      sigilLayer.dataset.hoverToken = String(token);
      sigilLayer.classList.remove("is-visible", "is-animating");
      sigilLayer.getBoundingClientRect();
      requestAnimationFrame(() => {
        if (!sigilLayer || hoverSigilToken !== token) return;
        sigilLayer.classList.add("is-visible", "is-animating");
      });
    } else {
      sigilLayer.classList.add("is-visible");
    }
    hoverSigilStateId = nextState;
  };

  const renderSigilLayer = () => {
    const mapApi = getMapApi();
    const sigilsByState = getSigilsByState();
    clearSigilLayer();
    if (!svg || !mapApi || !sigilsByState.size) return;
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("id", SIGIL_LAYER_ID);
    layer.classList.add("sigil-layer", "sigil-layer--hover");
    layer.setAttribute("aria-hidden", "true");
    const image = document.createElementNS(SVG_NS, "image");
    image.classList.add("sigil");
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    layer.appendChild(image);
    const focusLayer = mapApi.getFocusLayer?.();
    if (focusLayer?.parentNode === svg) {
      svg.insertBefore(layer, focusLayer);
    } else {
      svg.appendChild(layer);
    }
    sigilLayer = layer;
    hoverSigilImage = image;
    sigilLayer.addEventListener("animationend", (event) => {
      if (event.animationName === "sigil-pop") {
        const token = Number(sigilLayer?.dataset?.hoverToken || 0);
        if (token !== hoverSigilToken) return;
        sigilLayer.classList.remove("is-animating");
      }
    });
  };

  const renderFocusSigil = (stateId) => {
    const mapApi = getMapApi();
    const sigilsByState = getSigilsByState();
    clearFocusSigilLayer();
    if (!svg || !mapApi || !sigilsByState.size || !stateId) return;
    const href = sigilsByState.get(String(stateId));
    if (!href) return;
    const bounds = mapApi.getStateBounds(stateId);
    if (!bounds) return;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const size = getBaseSize();
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const layer = document.createElementNS(SVG_NS, "g");
    layer.classList.add("sigil-layer", "sigil-layer--focus");
    layer.setAttribute("aria-hidden", "true");
    const image = document.createElementNS(SVG_NS, "image");
    const resolvedHref = encodeURI(href);
    image.setAttribute("href", resolvedHref);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", resolvedHref);
    image.setAttribute("x", (centerX - size / 2).toFixed(3));
    image.setAttribute("y", (centerY - size / 2).toFixed(3));
    image.setAttribute("width", size.toFixed(3));
    image.setAttribute("height", size.toFixed(3));
    image.setAttribute("preserveAspectRatio", "xMidYMid meet");
    image.classList.add("sigil");
    image.dataset.state = String(stateId);
    layer.appendChild(image);
    const focusLayer = mapApi.getFocusLayer?.();
    if (focusLayer) {
      focusLayer.appendChild(layer);
    } else {
      svg.appendChild(layer);
    }
    focusSigilLayer = layer;
  };

  return {
    renderSigilLayer,
    renderFocusSigil,
    showHoverSigil,
    hideHoverSigil,
    clearSigilLayer,
    clearFocusSigilLayer,
  };
};
