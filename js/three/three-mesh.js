/**
 * @module three/three-mesh
 * Builds 3D state meshes from GeoJSON features with terrain grid and verso labels.
 */

import { TEXTURE_FILES, getTextureIndexForState, VERSO_IMAGES } from "../core/constants.js";
import { hash2 } from "../core/utils.js";

const bgTextureCache = new Map();

export const loadBgTexture = (stateId, THREE) => {
  const index = getTextureIndexForState(stateId);
  if (bgTextureCache.has(index)) return Promise.resolve(bgTextureCache.get(index));
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    const url = encodeURI(TEXTURE_FILES[index]);
    loader.load(
      url,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        bgTextureCache.set(index, texture);
        resolve(texture);
      },
      undefined,
      (err) => {
        console.warn("Failed to load texture:", url, err);
        resolve(null);
      },
    );
  });
};

const buildShapesFromGeometry = (geometry, THREE) => {
  const shapes = [];
  if (!geometry) return shapes;
  const ringToPath = (ring, PathCtor) => {
    const path = new PathCtor();
    ring.forEach((coord, index) => {
      const x = coord[0];
      const y = -coord[1];
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    return path;
  };
  const addPolygon = (coords) => {
    if (!coords.length) return;
    const shape = ringToPath(coords[0], THREE.Shape);
    for (let i = 1; i < coords.length; i += 1) {
      shape.holes.push(ringToPath(coords[i], THREE.Path));
    }
    shapes.push(shape);
  };
  if (geometry.type === "Polygon") {
    addPolygon(geometry.coordinates || []);
  } else if (geometry.type === "MultiPolygon") {
    (geometry.coordinates || []).forEach((polygon) => addPolygon(polygon));
  }
  return shapes;
};

const collectPolygonsFromGeometry = (geometry) => {
  const polygons = [];
  if (!geometry) return polygons;
  const ringToPoints = (ring) =>
    ring.map((coord) => ({
      x: coord[0],
      y: -coord[1],
    }));
  const addPolygon = (coords) => {
    if (!coords.length) return;
    const outer = ringToPoints(coords[0]);
    const holes = coords.slice(1).map(ringToPoints);
    polygons.push({ outer, holes });
  };
  if (geometry.type === "Polygon") {
    addPolygon(geometry.coordinates || []);
  } else if (geometry.type === "MultiPolygon") {
    (geometry.coordinates || []).forEach((polygon) => addPolygon(polygon));
  }
  return polygons;
};

const getRingCentroid = (ring) => {
  if (!ring || ring.length < 3) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const next = (i + 1) % ring.length;
    const x0 = ring[i][0];
    const y0 = -ring[i][1];
    const x1 = ring[next][0];
    const y1 = -ring[next][1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sumX = 0;
    let sumY = 0;
    ring.forEach((coord) => {
      sumX += coord[0];
      sumY += -coord[1];
    });
    const count = ring.length || 1;
    return { x: sumX / count, y: sumY / count, area: 0 };
  }
  return { x: cx / (6 * area), y: cy / (6 * area), area: Math.abs(area) };
};

const getGeometryCellInfo = (geometry) => {
  if (!geometry) return null;
  const addInfo = (ring) => {
    const centroid = getRingCentroid(ring);
    if (!centroid) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    ring.forEach((coord) => {
      const x = coord[0];
      const y = -coord[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    return {
      centroid,
      width: maxX - minX,
      height: maxY - minY,
      area: centroid.area,
    };
  };
  const collect = [];
  if (geometry.type === "Polygon") {
    const info = addInfo((geometry.coordinates || [])[0] || []);
    if (info) collect.push(info);
  } else if (geometry.type === "MultiPolygon") {
    (geometry.coordinates || []).forEach((polygon) => {
      const info = addInfo((polygon || [])[0] || []);
      if (info) collect.push(info);
    });
  }
  if (!collect.length) return null;
  const totalArea = collect.reduce((sum, item) => sum + (item.area || 0), 0) || 1;
  const weighted = collect.reduce(
    (acc, item) => {
      const weight = (item.area || 0) / totalArea;
      acc.x += item.centroid.x * weight;
      acc.y += item.centroid.y * weight;
      acc.width += item.width;
      acc.height += item.height;
      return acc;
    },
    { x: 0, y: 0, width: 0, height: 0 },
  );
  return {
    centroid: { x: weighted.x, y: weighted.y },
    width: weighted.width / collect.length,
    height: weighted.height / collect.length,
  };
};

/**
 * Build a 3D mesh for a state from GeoJSON features.
 * @param {string} stateId
 * @param {object} THREE - Three.js module
 * @param {object} deps - Dependencies
 * @param {object} deps.geojsonData - GeoJSON feature collection
 * @param {Map} deps.trackByState - stateId -> trackId map
 * @param {Map} deps.trackById - trackId -> track metadata map
 * @param {Function} deps.colorForState - stateId -> color string
 * @returns {THREE.Mesh|null}
 */
export const buildStateMesh = (stateId, THREE, { geojsonData, trackByState, trackById, colorForState }) => {
  if (!geojsonData) return null;
  const features = geojsonData.features.filter(
    (feature) => String((feature.properties || {}).state ?? "0") === String(stateId),
  );
  const shapes = [];
  const polygons = [];
  const cells = [];
  features.forEach((feature) => {
    shapes.push(...buildShapesFromGeometry(feature.geometry, THREE));
    polygons.push(...collectPolygonsFromGeometry(feature.geometry));
    const info = getGeometryCellInfo(feature.geometry);
    if (info) cells.push(info);
  });
  if (!shapes.length) return null;
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: 2.0,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.1,
    bevelSegments: 2,
  });
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  let centerX = 0;
  let centerY = 0;
  let scale = 1;
  if (box) {
    const sizeX = box.max.x - box.min.x;
    const sizeY = box.max.y - box.min.y;
    const sizeZ = box.max.z - box.min.z;
    centerX = (box.max.x + box.min.x) / 2;
    centerY = (box.max.y + box.min.y) / 2;
    const centerZ = (box.max.z + box.min.z) / 2;
    geometry.translate(-centerX, -centerY, -centerZ);
    const maxSize = Math.max(sizeX, sizeY, sizeZ || 0.25);
    scale = maxSize > 0 ? 2.4 / maxSize : 1;
    geometry.scale(scale, scale, scale);
  }
  geometry.computeBoundingBox();
  const scaledBounds = geometry.boundingBox;
  let depthRatio = null;
  if (scaledBounds) {
    const sizeX = scaledBounds.max.x - scaledBounds.min.x;
    const sizeY = scaledBounds.max.y - scaledBounds.min.y;
    const sizeZ = scaledBounds.max.z - scaledBounds.min.z;
    const denom = Math.max(sizeX, sizeY, 1e-6);
    depthRatio = sizeZ / denom;
    const uvAttr = geometry.getAttribute("uv");
    const posAttr = geometry.getAttribute("position");
    if (uvAttr && posAttr) {
      const uvArray = uvAttr.array;
      const posArray = posAttr.array;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posArray[i * 3];
        const y = posArray[i * 3 + 1];
        const u = (x - scaledBounds.min.x) / sizeX;
        const v = (y - scaledBounds.min.y) / sizeY;
        uvArray[i * 2] = u;
        uvArray[i * 2 + 1] = v;
      }
      uvAttr.needsUpdate = true;
    }
  }
  const baseColorValue = colorForState ? colorForState(stateId, false) : "#bdff00";
  const baseColor = new THREE.Color(baseColorValue);
  const sideColor = baseColor.clone().multiplyScalar(0.6);
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.35,
    metalness: 0.08,
    flatShading: false,
    emissive: baseColor.clone().multiplyScalar(0.2),
    emissiveIntensity: 0.2,
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: sideColor,
    roughness: 0.75,
    metalness: 0.1,
    emissive: sideColor.clone().multiplyScalar(0.2),
    emissiveIntensity: 0.2,
  });
  const mesh = new THREE.Mesh(geometry, [faceMaterial, sideMaterial]);

  let terrainGroup = null;
  const terrainData = [];
  let terrainBaseHeight = null;
  let terrainMaxHeight = null;
  let terrainTopZ = null;
  let terrainRangeX = null;
  let terrainRangeY = null;
  let terrainSize = null;
  let terrainNeighbors = null;
  let terrainHeights = null;
  let terrainEnergy = null;
  if (scaledBounds && cells.length) {
    const avgWidth = cells.reduce((sum, item) => sum + item.width, 0) / cells.length;
    const avgHeight = cells.reduce((sum, item) => sum + item.height, 0) / cells.length;
    terrainSize = Math.max(0.02, Math.min(avgWidth, avgHeight) * scale * 0.7);
    const terrainMat = new THREE.LineBasicMaterial({
      color: 0xbdff00,
      transparent: true,
      opacity: 0.85,
    });
    terrainGroup = new THREE.Group();
    terrainGroup.frustumCulled = false;
    terrainGroup.renderOrder = 2;
    const minX = scaledBounds.min.x;
    const minY = scaledBounds.min.y;
    terrainRangeX = scaledBounds.max.x - scaledBounds.min.x || 1;
    terrainRangeY = scaledBounds.max.y - scaledBounds.min.y || 1;
    terrainTopZ = scaledBounds.max.z + 0.08;
    terrainBaseHeight = 0.04;
    terrainMaxHeight = 0.7;
    const gridSize = terrainSize * 1.4;
    const grid = new Map();
    features.forEach((feature) => {
      const info = getGeometryCellInfo(feature.geometry);
      if (!info) return;
      const shapesForCell = buildShapesFromGeometry(feature.geometry, THREE);
      if (!shapesForCell.length) return;
      const x = (info.centroid.x - centerX) * scale;
      const y = (info.centroid.y - centerY) * scale;
      const xNorm = (x - minX) / terrainRangeX;
      const gridX = gridSize > 0 ? Math.round(x / gridSize) : 0;
      const gridY = gridSize > 0 ? Math.round(y / gridSize) : 0;
      const key = `${gridX},${gridY}`;
      if (!grid.has(key)) grid.set(key, []);
      const weight = 0.15 + hash2(x, y) * 0.85;
      const meshes = shapesForCell.map((shape) => {
        const cellGeometry = new THREE.ExtrudeGeometry([shape], {
          depth: 1,
          bevelEnabled: false,
        });
        cellGeometry.translate(-centerX, -centerY, 0);
        cellGeometry.scale(scale, scale, 1);
        const edgeGeometry = new THREE.EdgesGeometry(cellGeometry, 1);
        cellGeometry.dispose();
        const cellEdges = new THREE.LineSegments(edgeGeometry, terrainMat);
        cellEdges.position.z = terrainTopZ;
        cellEdges.scale.z = terrainBaseHeight;
        terrainGroup.add(cellEdges);
        return cellEdges;
      });
      const cellIndex = terrainData.length;
      grid.get(key).push(cellIndex);
      const freqCenter = xNorm * 0.93 + hash2(x * 3.1, y * 7.3) * 0.07;
      const freqWidth = 0.05 + hash2(x * 5.7, y * 2.3) * 0.06;
      const attackSpeed = 0.5 + hash2(x * 1.3, y * 4.7) * 0.4;
      const decaySpeed = 0.08 + hash2(x * 6.1, y * 1.9) * 0.17;
      const sensitivity = 0.8 + hash2(x * 8.3, y * 3.1) * 0.4;
      const breathePhase = hash2(x * 2.7, y * 9.1) * Math.PI * 2;
      terrainData.push({
        meshes,
        x,
        y,
        xNorm,
        weight,
        gridX,
        gridY,
        freqCenter,
        freqWidth,
        attackSpeed,
        decaySpeed,
        sensitivity,
        breathePhase,
      });
    });
    terrainNeighbors = terrainData.map(() => []);
    terrainData.forEach((cell, index) => {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          const key = `${cell.gridX + dx},${cell.gridY + dy}`;
          const indices = grid.get(key);
          if (!indices) continue;
          indices.forEach((neighborIndex) => {
            terrainNeighbors[index].push(neighborIndex);
          });
        }
      }
    });
    terrainHeights = new Float32Array(terrainData.length).fill(terrainBaseHeight);
    terrainEnergy = new Float32Array(terrainData.length);
    mesh.add(terrainGroup);
  }
  // Easter egg: track info on the back face
  const trackId = trackByState.get(String(stateId));
  const track = trackId ? trackById.get(trackId) : null;
  let versoBackPlane = null;
  let versoLinks = [];
  if (track && scaledBounds) {
    const parts = track.title.split(" - ");
    const artist = parts[0] || "";
    const title = parts.slice(1).join(" - ") || track.title;
    const cvs = document.createElement("canvas");
    cvs.width = 512;
    cvs.height = 256;
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8ffb2";
    ctx.font = '36px "Sinistre Regular", "Trebuchet MS", "Gill Sans", sans-serif';
    ctx.letterSpacing = "4px";
    ctx.fillText(title, cvs.width / 2, 110, cvs.width - 40);
    ctx.fillStyle = "rgba(189,255,0,0.55)";
    ctx.font = '24px "Sinistre Regular", "Trebuchet MS", "Gill Sans", sans-serif';
    ctx.letterSpacing = "6px";
    ctx.fillText(artist.toUpperCase(), cvs.width / 2, 160, cvs.width - 40);
    const iconSize = 32;
    const iconY = 200;
    const iconColor = "#e8ffb2";
    const iconLinks = [];
    const platforms = [];
    if (track.bandcamp) platforms.push("bandcamp");
    if (track.soundcloud) platforms.push("soundcloud");
    if (track.instagram) platforms.push("instagram");
    const iconGap = 48;
    const totalW = platforms.length * iconSize + (platforms.length - 1) * (iconGap - iconSize);
    const startX = cvs.width / 2 - totalW / 2;
    platforms.forEach((platform, i) => {
      const px = startX + i * iconGap;
      ctx.save();
      ctx.fillStyle = iconColor;
      ctx.strokeStyle = iconColor;
      if (platform === "bandcamp") {
        ctx.beginPath();
        ctx.moveTo(px, iconY);
        ctx.lineTo(px + iconSize * 0.6, iconY);
        ctx.lineTo(px + iconSize, iconY + iconSize);
        ctx.lineTo(px + iconSize * 0.4, iconY + iconSize);
        ctx.closePath();
        ctx.fill();
      } else if (platform === "soundcloud") {
        const cy = iconY + iconSize * 0.65;
        const barW = 3;
        const gap = 5;
        const heights = [0.25, 0.45, 0.7, 0.9, 0.7, 0.45];
        const barsW = heights.length * barW + (heights.length - 1) * (gap - barW);
        const bx = px + (iconSize - barsW) / 2;
        heights.forEach((h, j) => {
          const barH = iconSize * h;
          ctx.fillRect(bx + j * gap, cy - barH, barW, barH);
        });
      } else if (platform === "instagram") {
        const cx = px + iconSize / 2;
        const cy = iconY + iconSize / 2;
        const s = iconSize;
        const outerR = s * 0.32;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px + outerR, iconY);
        ctx.lineTo(px + s - outerR, iconY);
        ctx.arcTo(px + s, iconY, px + s, iconY + outerR, outerR);
        ctx.lineTo(px + s, iconY + s - outerR);
        ctx.arcTo(px + s, iconY + s, px + s - outerR, iconY + s, outerR);
        ctx.lineTo(px + outerR, iconY + s);
        ctx.arcTo(px, iconY + s, px, iconY + s - outerR, outerR);
        ctx.lineTo(px, iconY + outerR);
        ctx.arcTo(px, iconY, px + outerR, iconY, outerR);
        ctx.closePath();
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px + s * 0.76, iconY + s * 0.24, s * 0.065, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      iconLinks.push({
        uMin: px / cvs.width,
        uMax: (px + iconSize) / cvs.width,
        vMin: 1 - (iconY + iconSize) / cvs.height,
        vMax: 1 - iconY / cvs.height,
        url: track[platform],
      });
    });
    versoLinks = iconLinks;
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sX = scaledBounds.max.x - scaledBounds.min.x;
    const sY = scaledBounds.max.y - scaledBounds.min.y;
    const planeW = Math.min(sX, sY) * 0.7;
    const planeH = planeW * 0.5;
    const backPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide }),
    );
    backPlane.rotation.y = Math.PI;
    backPlane.position.z = scaledBounds.min.z - 0.02;
    mesh.add(backPlane);
    versoBackPlane = backPlane;

    const imgFile = VERSO_IMAGES[Math.floor(Math.random() * VERSO_IMAGES.length)];
    const imgLoader = new THREE.TextureLoader();
    imgLoader.load("assets/images/" + imgFile, (imgTex) => {
      imgTex.colorSpace = THREE.SRGBColorSpace;
      const imgW = Math.min(sX, sY) * 0.5;
      const aspect = imgTex.image.naturalHeight / imgTex.image.naturalWidth || 1;
      const imgH = imgW * aspect;
      const imgPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(imgW, imgH),
        new THREE.MeshBasicMaterial({ map: imgTex, transparent: true, side: THREE.FrontSide }),
      );
      imgPlane.rotation.y = Math.PI;
      const side = Math.random() < 0.5 ? -1 : 1;
      imgPlane.position.x = side * (sX * 0.5 + imgW * 0.4 + Math.random() * sX * 0.2);
      imgPlane.position.y = (Math.random() - 0.5) * sY * 0.8;
      imgPlane.position.z = scaledBounds.min.z - 0.04;
      mesh.add(imgPlane);
    });
  }

  mesh.rotation.x = -0.85;
  mesh.rotation.y = 0.55;
  const halfDepthZ = scaledBounds ? (scaledBounds.max.z - scaledBounds.min.z) / 2 : 0;
  mesh.userData = {
    terrainGroup,
    terrainData,
    terrainSize,
    terrainTopZ,
    terrainBaseHeight,
    terrainMaxHeight,
    terrainRangeX,
    terrainRangeY,
    terrainNeighbors,
    terrainHeights,
    terrainEnergy,
    faceMaterial,
    sideMaterial,
    baseScale: mesh.scale.clone(),
    depthRatio,
    halfDepthZ,
    backPlane: versoBackPlane,
    versoLinks,
  };
  return mesh;
};
