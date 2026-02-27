/**
 * @module state
 * Standalone state page viewer for ?state=<id> URLs.
 */

import { getLang, setLang, t, applyStaticTranslations } from "./i18n/i18n.js";
import { forEachCoordinate, geometryToPath } from "./map/geometry.js";

const svg = document.getElementById("state-svg");
const infoPane = document.getElementById("state-info");
const content = document.getElementById("state-content");
const geojsonPath = "Mia%20Cells%202025-12-23.geojson";

const svgNS = "http://www.w3.org/2000/svg";

const params = new URLSearchParams(location.search);
const stateId = params.get("state");

const colorForState = (stateId) => {
  const goldenAngle = 137.508;
  const hue = (Number(stateId) * goldenAngle) % 360;
  return `hsl(${hue} 55% 58%)`;
};

const render = (geojson, stateId) => {
  if (!stateId) {
    content.innerHTML = `<h2 class="info-title">${t("state.noState")}</h2><div class="info-body">${t("state.noStateBody")}</div>`;
    infoPane.removeAttribute("aria-hidden");
    return;
  }

  const features = geojson.features.filter(
    (f) => String((f.properties || {}).state ?? "0") === String(stateId),
  );
  if (!features.length) {
    content.innerHTML = `<div class="info-body">${t("state.noGeometry")}</div>`;
    infoPane.removeAttribute("aria-hidden");
    return;
  }

  // If a rehydrated overlay exists and was created for this state, adopt its geometry
  // into the page SVG to produce a seamless handoff.
  const sharedSvgHtml = sessionStorage.getItem("sharedOverlay");
  const sharedMetaStr = sessionStorage.getItem("sharedOverlayMeta");
  let usedOverlay = false;
  let sharedMeta = null;
  if (sharedSvgHtml && sharedMetaStr) {
    try {
      sharedMeta = JSON.parse(sharedMetaStr);
    } catch (_) {
      sharedMeta = null;
    }
  }

  if (sharedSvgHtml && sharedMeta && String(sharedMeta.stateId) === String(stateId)) {
    // Clear svg
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // set viewBox to the shared one so coordinates match
    if (sharedMeta.viewBox) svg.setAttribute("viewBox", sharedMeta.viewBox);
    try {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = sharedSvgHtml;
      const over = wrapper.firstElementChild;
      if (over) {
        // move children of overlay's root group into the page svg
        const grp = over.querySelector("g");
        if (grp) {
          while (grp.firstChild) {
            const node = grp.firstChild;
            svg.appendChild(node);
          }
          usedOverlay = true;
          // clear session storage so it doesn't persist
          sessionStorage.removeItem("sharedOverlay");
          sessionStorage.removeItem("sharedOverlayMeta");
        }
      }
    } catch (err) {
      console.warn("Failed to adopt shared overlay into svg", err);
    }
  }

  if (!usedOverlay) {
    // Clear svg and build from geojson as fallback
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const fragment = document.createDocumentFragment();
    const selBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const updateSelBounds = (x, y) => {
      if (x < selBounds.minX) selBounds.minX = x;
      if (y < selBounds.minY) selBounds.minY = y;
      if (x > selBounds.maxX) selBounds.maxX = x;
      if (y > selBounds.maxY) selBounds.maxY = y;
    };
    features.forEach((feature) => {
      const geometry = feature.geometry;
      forEachCoordinate(geometry, updateSelBounds);
      const pathData = geometryToPath(geometry);
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", colorForState(stateId));
      path.classList.add("cell");
      path.dataset.state = String(stateId);
      fragment.appendChild(path);
    });
    svg.appendChild(fragment);
    if (Number.isFinite(selBounds.minX)) {
      const width = selBounds.maxX - selBounds.minX || 1;
      const height = selBounds.maxY - selBounds.minY || 1;
      const padX = width * 0.08;
      const padY = height * 0.08;
      svg.setAttribute(
        "viewBox",
        `${selBounds.minX - padX} ${selBounds.minY - padY} ${width + padX * 2} ${height + padY * 2}`,
      );
    }
  }

  content.innerHTML = ``;
  infoPane.removeAttribute("aria-hidden");
};

const init = async () => {
  // i18n: wire language toggle and apply static translations
  const langToggle = document.getElementById("lang-toggle");
  if (langToggle) {
    const currentLang = getLang();
    langToggle.querySelectorAll("[data-lang]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.lang === currentLang ? "true" : "false");
      btn.addEventListener("click", () => {
        if (btn.dataset.lang !== currentLang) setLang(btn.dataset.lang);
      });
    });
  }
  applyStaticTranslations();

  try {
    // The `render` function will adopt any shared overlay from sessionStorage
    // directly into the page SVG for seamless page transitions.
    const res = await fetch(geojsonPath);
    if (!res.ok) throw new Error("failed to load geojson");
    const geojson = await res.json();
    render(geojson, stateId);

    // Note: when a shared overlay is present for this state, `render` adopts it
    // into the page SVG and clears sessionStorage. No additional fading is needed
    // here so the component appears continuous between pages.
  } catch (err) {
    console.error(err);
    content.innerHTML = `<h2 class="info-title">${t("error.title")}</h2><div class="info-body">${t("error.body")}</div>`;
    infoPane.removeAttribute("aria-hidden");
  }
};

init();
