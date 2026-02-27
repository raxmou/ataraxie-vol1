export const ringToPath = (ring) => {
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
    return geometry.coordinates.map((polygon) => polygon.map(ringToPath).join(" ")).join(" ");
  }
  return "";
};

const lineToPath = (line, transform) => {
  if (!line.length) return "";
  const [firstX, firstY] = transform ? transform(line[0][0], line[0][1]) : line[0];
  let d = `M ${firstX} ${firstY}`;
  for (let i = 1; i < line.length; i += 1) {
    const [x, y] = transform ? transform(line[i][0], line[i][1]) : line[i];
    d += ` L ${x} ${y}`;
  }
  return d;
};

export const geometryToLinePath = (geometry, transform) => {
  if (!geometry) return "";
  if (geometry.type === "LineString") {
    return lineToPath(geometry.coordinates, transform);
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.map((line) => lineToPath(line, transform)).join(" ");
  }
  return "";
};
