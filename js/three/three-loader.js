/**
 * @module three/three-loader
 * Lazy CDN import + cache for Three.js and SVGLoader.
 */

import { THREE_URL, SVG_LOADER_URL } from "../core/constants.js";

let threeModulePromise = null;
let svgLoaderPromise = null;

export const loadThreeModule = () => {
  if (!threeModulePromise) {
    threeModulePromise = import(THREE_URL);
  }
  return threeModulePromise;
};

export const loadSvgLoader = () => {
  if (!svgLoaderPromise) {
    svgLoaderPromise = import(SVG_LOADER_URL);
  }
  return svgLoaderPromise;
};
