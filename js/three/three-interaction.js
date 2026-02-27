/**
 * @module three/three-interaction
 * Pointer drag/rotate and verso link raycast for the 3D state view.
 */

export const createThreeInteraction = ({ stateCanvas, getThreeApi }) => {
  let activePointerId = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let pointerTotalDisplacement = 0;
  let isThreeDragging = false;
  let inertiaX = 0;
  let inertiaY = 0;

  const raycastVersoLinks = (event) => {
    const threeApi = getThreeApi();
    if (!threeApi?.mesh?.userData?.backPlane || !threeApi.mesh.userData.versoLinks?.length)
      return null;
    const rect = stateCanvas.getBoundingClientRect();
    const mouse = new threeApi.THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new threeApi.THREE.Raycaster();
    raycaster.setFromCamera(mouse, threeApi.camera);
    const hits = raycaster.intersectObject(threeApi.mesh.userData.backPlane, false);
    if (!hits.length || !hits[0].uv) return null;
    const u = hits[0].uv.x;
    const v = hits[0].uv.y;
    for (const link of threeApi.mesh.userData.versoLinks) {
      if (u >= link.uMin && u <= link.uMax && v >= link.vMin && v <= link.vMax) {
        return link;
      }
    }
    return null;
  };

  const handlePointerDown = (event) => {
    const mapPane = stateCanvas?.closest(".map-pane");
    if (!stateCanvas || !mapPane?.classList.contains("is-3d")) return;
    if (activePointerId !== null) return;
    activePointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    pointerTotalDisplacement = 0;
    isThreeDragging = true;
    inertiaX = 0;
    inertiaY = 0;
    stateCanvas.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const threeApi = getThreeApi();
    if (!threeApi?.mesh) return;
    if (activePointerId === null && stateCanvas) {
      const link = raycastVersoLinks(event);
      stateCanvas.style.cursor = link ? "pointer" : "grab";
      return;
    }
    if (activePointerId !== event.pointerId) return;
    const deltaX = event.clientX - lastPointerX;
    const deltaY = event.clientY - lastPointerY;
    pointerTotalDisplacement += Math.abs(deltaX) + Math.abs(deltaY);
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    const speed = 0.004;
    const nextX = threeApi.mesh.rotation.x + deltaY * speed;
    const nextY = threeApi.mesh.rotation.y + deltaX * speed;
    threeApi.mesh.rotation.x = Math.max(-1.6, Math.min(-0.2, nextX));
    threeApi.mesh.rotation.y = nextY;
    inertiaX = deltaY * speed;
    inertiaY = deltaX * speed;
  };

  const handlePointerUp = (event) => {
    if (activePointerId !== event.pointerId) return;
    const wasClick = pointerTotalDisplacement < 5;
    activePointerId = null;
    isThreeDragging = false;
    stateCanvas?.releasePointerCapture?.(event.pointerId);
    if (wasClick) {
      const threeApi = getThreeApi();
      if (threeApi?.mesh) {
        const link = raycastVersoLinks(event);
        if (link) {
          window.open(link.url, "_blank", "noopener,noreferrer");
        }
      }
    }
  };

  const init = () => {
    if (!stateCanvas) return;
    stateCanvas.addEventListener("pointerdown", handlePointerDown);
    stateCanvas.addEventListener("pointermove", handlePointerMove);
    stateCanvas.addEventListener("pointerup", handlePointerUp);
    stateCanvas.addEventListener("pointercancel", handlePointerUp);
    stateCanvas.addEventListener("pointerleave", handlePointerUp);
  };

  const dispose = () => {
    if (!stateCanvas) return;
    stateCanvas.removeEventListener("pointerdown", handlePointerDown);
    stateCanvas.removeEventListener("pointermove", handlePointerMove);
    stateCanvas.removeEventListener("pointerup", handlePointerUp);
    stateCanvas.removeEventListener("pointercancel", handlePointerUp);
    stateCanvas.removeEventListener("pointerleave", handlePointerUp);
  };

  return {
    init,
    dispose,
    resetInertia() {
      inertiaX = 0;
      inertiaY = 0;
    },
    setInertia(x, y) {
      inertiaX = x;
      inertiaY = y;
    },
    get isDragging() {
      return isThreeDragging;
    },
    get inertiaX() {
      return inertiaX;
    },
    get inertiaY() {
      return inertiaY;
    },
  };
};
