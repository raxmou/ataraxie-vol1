/**
 * @module audio/hourglass/hourglass-3d
 * 3D hourglass overlay using Three.js LatheGeometry.
 */

import { loadThreeModule } from "../../three/three-loader.js";
import { HEIGHT, PARTICLE_COLOR } from "./hourglass-constants.js";

/**
 * Build a procedural 3D hourglass overlay.
 * @param {HTMLElement} wrapper - The .hourglass-container element
 * @returns {Promise<{ render: (dt: number) => void, dispose: () => void, canvas: HTMLCanvasElement } | null>}
 */
export const initHourglass3D = async (wrapper) => {
  const THREE = await loadThreeModule();

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
  const canvas3d = renderer.domElement;
  canvas3d.className = "hourglass-3d";

  // --- Scene & Camera ---
  const scene = new THREE.Scene();
  const fov = 20;
  const vFov = (fov * Math.PI) / 180;
  const camDist = HEIGHT / 2 / Math.tan(vFov / 2);
  const camera = new THREE.PerspectiveCamera(
    fov,
    wrapper.clientWidth / wrapper.clientHeight,
    1,
    camDist * 3,
  );
  camera.position.set(0, 0, camDist);
  camera.lookAt(0, 0, 0);

  // --- Lighting ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
  keyLight.position.set(30, 60, 80);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(
    (PARTICLE_COLOR.r << 16) | (PARTICLE_COLOR.g << 8) | PARTICLE_COLOR.b,
    0.35,
  );
  rimLight.position.set(-40, -20, 60);
  scene.add(rimLight);

  // --- Hourglass profile (LatheGeometry) ---
  const BASE_R = 40;
  const NECK_R = 4;
  const HALF_H = 70;
  const POINTS = 48;
  const profilePts = [];
  for (let i = 0; i <= POINTS; i++) {
    const u = (i / POINTS) * 2 - 1; // -1 (bottom) to +1 (top)
    const r = NECK_R + (BASE_R - NECK_R) * Math.pow(Math.abs(u), 1.3);
    const y = u * HALF_H;
    profilePts.push(new THREE.Vector2(r, y));
  }
  const hourglassGeo = new THREE.LatheGeometry(profilePts, 32);

  // --- Materials (all depthWrite: false for transparency layering) ---
  const colorHex = 0xbdff00;
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.2,
    metalness: 0.0,
    clearcoat: 0.3,
  });

  const wireMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    wireframe: true,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
  });

  const edgeMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.BackSide,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.15,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    metalness: 0.6,
    roughness: 0.3,
  });

  // --- Group ---
  const group = new THREE.Group();

  group.add(new THREE.Mesh(hourglassGeo, glassMat));
  group.add(new THREE.Mesh(hourglassGeo, wireMat));
  group.add(new THREE.Mesh(hourglassGeo, edgeMat));

  // Rims at top & bottom
  const rimGeo = new THREE.TorusGeometry(BASE_R, 1.2, 12, 32);
  const topRim = new THREE.Mesh(rimGeo, rimMat);
  topRim.position.y = HALF_H;
  topRim.rotation.x = Math.PI / 2;
  group.add(topRim);

  const bottomRim = new THREE.Mesh(rimGeo, rimMat);
  bottomRim.position.y = -HALF_H;
  bottomRim.rotation.x = Math.PI / 2;
  group.add(bottomRim);

  // Neck ring
  const neckGeo = new THREE.TorusGeometry(NECK_R, 0.6, 8, 32);
  const neckRing = new THREE.Mesh(neckGeo, rimMat);
  neckRing.rotation.x = Math.PI / 2;
  group.add(neckRing);

  scene.add(group);

  // --- Animation state ---
  let elapsed = 0;

  return {
    canvas: canvas3d,
    render(dt) {
      elapsed += dt;
      group.rotation.y = Math.sin(elapsed * 0.4) * 0.15;
      renderer.render(scene, camera);
    },
    dispose() {
      hourglassGeo.dispose();
      rimGeo.dispose();
      neckGeo.dispose();
      glassMat.dispose();
      wireMat.dispose();
      edgeMat.dispose();
      rimMat.dispose();
      renderer.dispose();
      if (canvas3d.parentNode) canvas3d.parentNode.removeChild(canvas3d);
    },
  };
};
