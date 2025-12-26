const app = document.getElementById("state-app");
const svg = document.getElementById("state-svg");
const infoPane = document.getElementById("state-info");
const content = document.getElementById("state-content");
const dataUrl = (new URL(document.baseURI)).pathname.endsWith("/") ? (document.getElementById('app')?.dataset?.geojson) : null;
// fallback to index main's data attribute path
const geojsonPath = "Mia%20Cells%202025-12-23.geojson";

const svgNS = "http://www.w3.org/2000/svg";

const params = new URLSearchParams(location.search);
const stateId = params.get("state");

const forEachCoordinate = (geometry, callback) => {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => {
      ring.forEach(([x, y]) => callback(x, y));
    });
    return;
  }
  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        ring.forEach(([x, y]) => callback(x, y));
      });
    });
  }
};

const ringToPath = (ring) => {
  if (!ring.length) return "";
  const [firstX, firstY] = ring[0];
  let d = `M ${firstX} ${firstY}`;
  for (let i = 1; i < ring.length; i += 1) {
    const [x, y] = ring[i];
    d += ` L ${x} ${y}`;
  }
  return `${d} Z`;
};

const geometryToPath = (geometry) => {
  if (!geometry) return "";
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map(ringToPath).join(" ");
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => polygon.map(ringToPath).join(" "))
      .join(" ");
  }
  return "";
};

const colorForState = (stateId) => {
  const goldenAngle = 137.508;
  const hue = (Number(stateId) * goldenAngle) % 360;
  return `hsl(${hue} 55% 58%)`;
};

const render = (geojson, stateId) => {
  if (!stateId) {
    content.innerHTML = `<h2 class="info-title">No state specified</h2><div class="info-body">Provide ?state=<id> in the URL.</div>`;
    infoPane.removeAttribute("aria-hidden");
    return;
  }

  const features = geojson.features.filter((f) => String((f.properties||{}).state ?? "0") === String(stateId));
  if (!features.length) {
    content.innerHTML = `<h2 class="info-title">State ${stateId}</h2><div class="info-body">No geometry found for this state.</div>`;
    infoPane.removeAttribute("aria-hidden");
    return;
  }

  // Clear svg
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
    svg.setAttribute("viewBox", `${selBounds.minX - padX} ${selBounds.minY - padY} ${width + padX * 2} ${height + padY * 2}`);
  }

  content.innerHTML = `<h2 class="info-title">State ${stateId}</h2><div class="info-body">Placeholder information about state ${stateId}.</div>`;
  infoPane.removeAttribute("aria-hidden");
};

const init = async () => {
  try {
    const res = await fetch(geojsonPath);
    if (!res.ok) throw new Error('failed to load geojson');
    const geojson = await res.json();
    render(geojson, stateId);
  } catch (err) {
    console.error(err);
    content.innerHTML = `<h2 class="info-title">Error</h2><div class="info-body">Could not load data.</div>`;
    infoPane.removeAttribute("aria-hidden");
  }
};

init();
