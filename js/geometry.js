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

export const forEachCoordinate = (geometry, callback) => {
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

export const geometryToPath = (geometry) => {
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
