/**
 * @module three/three-morph
 * 3D state mesh lifecycle: show, morph in/out, hide.
 */

import { easeInOutCubic } from "../core/utils.js";
import { PREFERS_REDUCED_MOTION } from "../core/constants.js";
import { initThree as initThreeScene, resizeRenderer, disposeThreeObject } from "./three-scene.js";
import { buildStateMesh, loadBgTexture } from "./three-mesh.js";
import { applyInertiaRotation } from "./three-scene.js";

const prefersReducedMotion = PREFERS_REDUCED_MOTION;

export const createThreeMorph = ({
  stateCanvas,
  mapPane,
  threeStack,
  threeInteraction,
  getGeojsonData,
  getTrackByState,
  getTrackById,
  getColorForState,
  getHourglassPlayer,
  setSplitLayout,
  setAnimating,
  startAmbientBreathing,
  stopAmbientBreathing,
}) => {
  let threeApi = null;
  let threeInitPromise = null;
  let isMorphing = false;

  const resizeThree = () => {
    resizeRenderer(threeApi, stateCanvas);
  };

  const initThree = async () => {
    if (threeInitPromise) return threeInitPromise;
    threeInitPromise = (async () => {
      const api = await initThreeScene(stateCanvas);
      if (api) threeApi = api;
      return threeApi;
    })();
    return threeInitPromise;
  };

  const startThreeRender = () => {
    if (!threeApi) return;
    const renderLoop = () => {
      if (!threeApi) return;
      if (threeApi.mesh && !threeInteraction.isDragging && !isMorphing) {
        const hp = getHourglassPlayer();
        const speed = hp ? hp.speed : 1;
        threeApi.mesh.rotation.z += 0.002 * speed;
        const inertia = applyInertiaRotation(
          threeApi.mesh,
          threeInteraction.inertiaX,
          threeInteraction.inertiaY,
          { min: -1.6, max: -0.2 },
        );
        threeInteraction.setInertia(inertia.x, inertia.y);
      }
      threeApi.renderer.render(threeApi.scene, threeApi.camera);
      threeApi.frameId = requestAnimationFrame(renderLoop);
    };
    if (threeApi.frameId) cancelAnimationFrame(threeApi.frameId);
    threeApi.frameId = requestAnimationFrame(renderLoop);
  };

  const stopThreeRender = () => {
    if (!threeApi) return;
    if (threeApi.frameId) cancelAnimationFrame(threeApi.frameId);
    threeApi.frameId = null;
  };

  const setThreeView = () => {
    if (!mapPane) return;
    mapPane.classList.add("is-3d-state");
    startThreeRender();
  };

  const showState3D = async (stateId) => {
    if (!stateId || !mapPane) return;
    const api = await initThree();
    if (!api) return;
    if (api.mesh) {
      api.scene.remove(api.mesh);
      disposeThreeObject(api.mesh);
      api.mesh = null;
    }
    threeInteraction.resetInertia();
    const mesh = buildStateMesh(stateId, api.THREE, {
      geojsonData: getGeojsonData(),
      trackByState: getTrackByState(),
      trackById: getTrackById(),
      colorForState: getColorForState(),
    });
    if (!mesh) return;

    const halfDepthZ = mesh.userData.halfDepthZ || 0;
    mesh.scale.z = 0.01;
    mesh.position.z = halfDepthZ * 0.99;
    mesh.rotation.x = 0;
    mesh.rotation.y = 0;

    api.camera.position.set(0, 0, 4.5);
    api.camera.lookAt(0, 0, 0);

    api.scene.add(mesh);
    api.mesh = mesh;

    resizeThree();
    startThreeRender();

    api.renderer.render(api.scene, api.camera);

    loadBgTexture(stateId, api.THREE).then((bgTexture) => {
      if (bgTexture && api.mesh === mesh && Array.isArray(mesh.material) && mesh.material[0]) {
        const faceMat = mesh.material[0];
        bgTexture.repeat.set(2, 2);
        faceMat.map = bgTexture;
        faceMat.color.setHex(0xffffff);
        faceMat.emissive.setHex(0x000000);
        faceMat.emissiveIntensity = 0;
        faceMat.needsUpdate = true;
      }
    });
  };

  const morphTo3D = (duration = 500) => {
    return new Promise((resolve) => {
      if (!threeApi?.mesh || !mapPane) {
        resolve();
        return;
      }
      const mesh = threeApi.mesh;
      const halfDepthZ = mesh.userData.halfDepthZ || 0;
      const camera = threeApi.camera;

      mapPane.classList.add("is-3d");
      setThreeView();
      threeStack?.setAttribute("aria-hidden", "false");
      stateCanvas?.setAttribute("aria-hidden", "false");
      setSplitLayout(true);

      if (prefersReducedMotion) {
        mesh.scale.z = 1;
        mesh.position.z = 0;
        mesh.rotation.x = -0.85;
        mesh.rotation.y = 0.55;
        camera.position.set(0, 0.3, 4.2);
        camera.lookAt(0, 0, 0);
        isMorphing = false;
        startAmbientBreathing();
        setAnimating(false);
        resolve();
        return;
      }

      isMorphing = true;
      const startTime = performance.now();

      const animate = (now) => {
        const elapsed = now - startTime;
        const raw = Math.min(elapsed / duration, 1);
        const t = easeInOutCubic(raw);

        mesh.scale.z = 0.01 + (1 - 0.01) * t;
        mesh.position.z = halfDepthZ * (1 - mesh.scale.z);
        mesh.rotation.x = -0.85 * t;
        mesh.rotation.y = 0.55 * t;
        camera.position.y = 0.3 * t;
        camera.position.z = 4.5 + (4.2 - 4.5) * t;
        camera.lookAt(0, 0, 0);

        if (raw < 1) {
          requestAnimationFrame(animate);
        } else {
          isMorphing = false;
          startAmbientBreathing();
          setAnimating(false);
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  };

  const morphFrom3D = (duration = 400) => {
    return new Promise((resolve) => {
      if (!threeApi?.mesh || !mapPane) {
        mapPane?.classList.remove("is-3d", "is-3d-state");
        resolve();
        return;
      }
      const mesh = threeApi.mesh;
      const halfDepthZ = mesh.userData.halfDepthZ || 0;
      const camera = threeApi.camera;

      stopAmbientBreathing();

      if (prefersReducedMotion) {
        mapPane.classList.remove("is-3d", "is-3d-state");
        isMorphing = false;
        resolve();
        return;
      }

      isMorphing = true;
      const startRotX = mesh.rotation.x;
      const startRotY = mesh.rotation.y;
      const startScaleZ = mesh.scale.z;
      const startCamY = camera.position.y;
      const startCamZ = camera.position.z;
      const startTime = performance.now();

      const animate = (now) => {
        const elapsed = now - startTime;
        const raw = Math.min(elapsed / duration, 1);
        const t = easeInOutCubic(raw);

        mesh.scale.z = startScaleZ + (0.01 - startScaleZ) * t;
        mesh.position.z = halfDepthZ * (1 - mesh.scale.z);
        mesh.rotation.x = startRotX * (1 - t);
        mesh.rotation.y = startRotY * (1 - t);
        camera.position.y = startCamY * (1 - t);
        camera.position.z = startCamZ + (4.5 - startCamZ) * t;
        camera.lookAt(0, 0, 0);

        if (raw < 1) {
          requestAnimationFrame(animate);
        } else {
          isMorphing = false;
          mapPane.classList.remove("is-3d", "is-3d-state");
          threeStack?.setAttribute("aria-hidden", "true");
          stateCanvas?.setAttribute("aria-hidden", "true");
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  };

  const hideState3D = () => {
    if (!mapPane) return;
    stopAmbientBreathing();
    mapPane.classList.remove("is-3d");
    mapPane.classList.remove("is-3d-state");
    threeStack?.setAttribute("aria-hidden", "true");
    stateCanvas?.setAttribute("aria-hidden", "true");
    threeInteraction.resetInertia();
    if (!threeApi) return;
    if (threeApi.mesh) {
      threeApi.scene.remove(threeApi.mesh);
      disposeThreeObject(threeApi.mesh);
      threeApi.mesh = null;
    }
    stopThreeRender();
  };

  return {
    showState3D,
    morphTo3D,
    morphFrom3D,
    hideState3D,
    resizeThree,
    get api() {
      return threeApi;
    },
    get isMorphing() {
      return isMorphing;
    },
  };
};
