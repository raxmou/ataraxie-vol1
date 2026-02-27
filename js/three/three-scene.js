/**
 * @module three/three-scene
 * Three.js scene initialization, render loop, resize, and disposal.
 */

import { loadThreeModule } from "./three-loader.js";

export const disposeThreeObject = (object) => {
  if (!object) return;
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
};

export const resizeRenderer = (api, canvas) => {
  if (!api || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  api.renderer.setPixelRatio(window.devicePixelRatio || 1);
  api.renderer.setSize(rect.width, rect.height, false);
  api.camera.aspect = rect.width / rect.height;
  api.camera.updateProjectionMatrix();
};

export const initThree = async (canvas) => {
  if (!canvas) return null;
  const THREE = await loadThreeModule();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 0, 4.5);
  camera.lookAt(0, 0, 0);
  const hemi = new THREE.HemisphereLight(0xe8ffb2, 0x0b0e07, 0.7);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x1b240f, 0.45);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(4, 3, 6);
  scene.add(dir);
  const rim = new THREE.DirectionalLight(0x6b7f2c, 0.65);
  rim.position.set(-4, -3, 2);
  scene.add(rim);
  const api = { THREE, renderer, scene, camera, mesh: null, frameId: null };
  resizeRenderer(api, canvas);
  return api;
};

export const applyInertiaRotation = (mesh, inertiaX, inertiaY, clampX, damping = 0.92) => {
  if (!mesh) return { x: inertiaX, y: inertiaY };
  if (Math.abs(inertiaX) < 0.0001 && Math.abs(inertiaY) < 0.0001) {
    return { x: 0, y: 0 };
  }
  const nextX = mesh.rotation.x + inertiaX;
  mesh.rotation.x = Math.max(clampX.min, Math.min(clampX.max, nextX));
  mesh.rotation.y += inertiaY;
  let nextInertiaX = inertiaX * damping;
  let nextInertiaY = inertiaY * damping;
  if (Math.abs(nextInertiaX) < 0.0001) nextInertiaX = 0;
  if (Math.abs(nextInertiaY) < 0.0001) nextInertiaY = 0;
  return { x: nextInertiaX, y: nextInertiaY };
};

export const startThreeRender = (api, { getMesh, getIsDragging, getIsMorphing, getSpeed, getInertia, setInertia }) => {
  if (!api) return;
  const renderLoop = () => {
    if (!api) return;
    const mesh = getMesh();
    if (mesh && !getIsDragging() && !getIsMorphing()) {
      const speed = getSpeed();
      mesh.rotation.z += 0.002 * speed;
      const [ix, iy] = getInertia();
      const inertia = applyInertiaRotation(mesh, ix, iy, { min: -1.6, max: -0.2 });
      setInertia(inertia.x, inertia.y);
    }
    api.renderer.render(api.scene, api.camera);
    api.frameId = requestAnimationFrame(renderLoop);
  };
  if (api.frameId) cancelAnimationFrame(api.frameId);
  api.frameId = requestAnimationFrame(renderLoop);
};

export const stopThreeRender = (api) => {
  if (!api) return;
  if (api.frameId) cancelAnimationFrame(api.frameId);
  api.frameId = null;
};
