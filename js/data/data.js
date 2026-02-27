const loadJson = async (url, label) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${label}: ${response.status}`);
  }
  return response.json();
};

export const loadGeoJSON = (url) => loadJson(url, "geojson");

export const loadTracks = (url) => loadJson(url, "tracks");

export const loadSigils = (url) => loadJson(url, "sigils");
