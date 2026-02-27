/**
 * @module ui/layout
 * Layout state management: split view, collapse, loading screen, about modal.
 */

import { t } from "../i18n/i18n.js";
import { createInfoPaneGesture } from "./info-pane-gesture.js";

/**
 * @param {object} deps
 * @param {HTMLElement} deps.app
 * @param {SVGElement} deps.svg
 * @param {HTMLElement} deps.infoPane
 * @param {HTMLElement} deps.backButton
 * @param {HTMLElement} deps.loadingScreen
 * @param {HTMLElement} deps.loadingProgress
 * @param {HTMLElement} deps.aboutModal
 * @param {MediaQueryList} deps.mobileMediaQuery
 * @param {function} deps.hideHoverSigil
 * @param {function} deps.getInfoPaneGesture
 * @param {function} deps.setInfoPaneGesture
 */
export const createLayoutManager = ({
  app,
  svg,
  infoPane,
  backButton,
  loadingScreen,
  loadingProgress,
  aboutModal,
  mobileMediaQuery,
  hideHoverSigil,
  getInfoPaneGesture,
  setInfoPaneGesture,
}) => {
  const setSplitLayout = (isSplit) => {
    if (!app || !infoPane) return;
    if (isSplit) {
      app.classList.add("is-split");
      infoPane.removeAttribute("aria-hidden");
      backButton?.removeAttribute("hidden");
      hideHoverSigil();
      if (mobileMediaQuery.matches && !getInfoPaneGesture()) {
        const gesture = createInfoPaneGesture(infoPane, {
          onMinimize: () => app.classList.add("is-pane-minimized"),
          onMaximize: () => app.classList.remove("is-pane-minimized"),
        });
        gesture.init();
        setInfoPaneGesture(gesture);
      }
    } else {
      app.classList.remove("is-split", "is-pane-minimized");
      infoPane.setAttribute("aria-hidden", "true");
      backButton?.setAttribute("hidden", "");
      const gesture = getInfoPaneGesture();
      if (gesture) {
        gesture.dispose();
        setInfoPaneGesture(null);
      }
    }
  };

  const setCollapsed = (isCollapsed) => {
    if (!svg) return;
    svg.classList.toggle("is-collapsed", isCollapsed);
  };

  const setAnimating = (isAnimating) => {
    if (!svg) return;
    svg.classList.toggle("is-animating", isAnimating);
  };

  const setLoading = (isLoading, message) => {
    if (!loadingScreen) return;
    if (message && loadingProgress) {
      loadingProgress.textContent = message;
    }
    if (isLoading) {
      loadingScreen.classList.remove("is-hidden");
      loadingScreen.setAttribute("aria-hidden", "false");
      app?.setAttribute("aria-busy", "true");
    } else {
      loadingScreen.classList.add("is-hidden");
      loadingScreen.setAttribute("aria-hidden", "true");
      app?.removeAttribute("aria-busy");
    }
  };

  const updateLoadingProgress = (current, total) => {
    if (!loadingProgress) return;
    loadingProgress.textContent = t("loading.stateViews", { current, total });
  };

  const hideAboutModal = () => {
    if (aboutModal) {
      aboutModal.setAttribute("aria-hidden", "true");
    }
  };

  return {
    setSplitLayout,
    setCollapsed,
    setAnimating,
    setLoading,
    updateLoadingProgress,
    hideAboutModal,
  };
};
