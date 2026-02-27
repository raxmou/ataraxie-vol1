/**
 * @module map/navigation
 * ViewBox animation, viewport math, and URL state management.
 */

/**
 * @param {object} deps
 * @param {HTMLElement} deps.mapPane
 * @param {SVGElement} deps.svg
 * @param {object} deps.viewbox - ViewBox animator (parse/set)
 * @param {function} deps.getMapApi
 * @param {function} deps.getTransformAnimator
 * @param {function} deps.getFullViewBox
 * @param {boolean} deps.prefersReducedMotion
 * @param {function} deps.setAnimating
 */
export const createNavigation = ({
  mapPane,
  viewbox,
  prefersReducedMotion,
  getMapApi,
  getTransformAnimator,
  getFullViewBox,
  setAnimating,
}) => {
  let animationToken = 0;

  const getViewportScale = (box, viewport) =>
    Math.min(viewport.width / box.width, viewport.height / box.height);

  const getViewportOffset = (box, viewport, scale) => ({
    x: (viewport.width - box.width * scale) / 2,
    y: (viewport.height - box.height * scale) / 2,
  });

  const getTransformForViewBox = (fromBox, toBox, viewport) => {
    const fromScale = getViewportScale(fromBox, viewport);
    const toScale = getViewportScale(toBox, viewport);
    const scale = toScale / fromScale;
    const fromOffset = getViewportOffset(fromBox, viewport, fromScale);
    const toOffset = getViewportOffset(toBox, viewport, toScale);
    return {
      x: fromBox.x + (-toBox.x * toScale + toOffset.x - fromOffset.x) / fromScale,
      y: fromBox.y + (-toBox.y * toScale + toOffset.y - fromOffset.y) / fromScale,
      scale,
    };
  };

  const getMapPaneSize = () => {
    const rect = mapPane?.getBoundingClientRect();
    const width = rect?.width ?? window.innerWidth;
    const height = rect?.height ?? window.innerHeight;
    return { width, height };
  };

  const getTargetViewBoxForState = (stateId) => {
    const mapApi = getMapApi();
    const fullViewBox = getFullViewBox();
    const bounds = mapApi?.getStateBounds(stateId);
    if (!bounds || !fullViewBox) return fullViewBox;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const padding = 0.08;
    let targetWidth = width * (1 + padding * 2);
    let targetHeight = height * (1 + padding * 2);
    const centerX = bounds.minX + width / 2;
    const centerY = bounds.minY + height / 2;
    const pane = getMapPaneSize();
    const targetAspect = pane.width / pane.height;
    const boxAspect = targetWidth / targetHeight;
    if (boxAspect > targetAspect) {
      targetHeight = targetWidth / targetAspect;
    } else {
      targetWidth = targetHeight * targetAspect;
    }
    return {
      x: centerX - targetWidth / 2,
      y: centerY - targetHeight / 2,
      width: targetWidth,
      height: targetHeight,
    };
  };

  const animateToViewBox = (targetBox, duration, options = {}) => {
    const mapApi = getMapApi();
    const transformAnimator = getTransformAnimator();
    const fullViewBox = getFullViewBox();

    const finalize = () => {
      if (targetBox) viewbox.set(targetBox);
      transformAnimator?.set({ x: 0, y: 0, scale: 1 });
      if (options.useSnapshot) mapApi?.clearSnapshot();
      if (!options.onComplete) setAnimating(false);
      if (options.onComplete) options.onComplete();
    };

    if (!targetBox || !mapApi || !transformAnimator) {
      finalize();
      return;
    }
    const baseBox = viewbox.parse() || fullViewBox;
    if (!baseBox) {
      finalize();
      return;
    }
    const useSnapshot = options.useSnapshot && mapApi.createSnapshot(options.stateId);
    const layer = useSnapshot ? mapApi.getSnapshotLayer() : mapApi.getFocusLayer();
    transformAnimator.setElement(layer);
    transformAnimator.set({ x: 0, y: 0, scale: 1 });
    const viewport = getMapPaneSize();
    const transform = getTransformForViewBox(baseBox, targetBox, viewport);
    animationToken += 1;
    const token = animationToken;
    setAnimating(true);
    const finish = () => {
      if (token !== animationToken) return;
      finalize();
    };
    transformAnimator.animate(
      { x: 0, y: 0, scale: 1 },
      transform,
      prefersReducedMotion ? 0 : duration,
      finish,
    );
  };

  const updateUrlState = (stateId) => {
    const url = new URL(window.location.href);
    if (stateId) {
      url.searchParams.set("state", stateId);
    } else {
      url.searchParams.delete("state");
    }
    history.pushState({ stateId }, "", url);
  };

  return {
    getMapPaneSize,
    getTargetViewBoxForState,
    animateToViewBox,
    updateUrlState,
  };
};
