// DeepStateMap.live — community-maintained Ukraine frontline geometry
// No API key required. https://deepstatemap.live/api/history/last

import { safeFetch } from '../utils/fetch.mjs';

const URL = 'https://deepstatemap.live/api/history/last';
const MAX_FEATURES = 400;

export async function briefing() {
  try {
    const data = await safeFetch(URL, { timeout: 20000 });
    const features = data?.map?.features;
    if (data.error || !Array.isArray(features)) {
      return { source: 'DeepStateMap.live', timestamp: new Date().toISOString(), status: 'error', error: data.error || 'Malformed response' };
    }

    // Trim heavy geometry (some polygons carry hundreds of vertices) so the
    // sweep stays light — good enough for map rendering at world/region zoom.
    const trimmed = features.slice(0, MAX_FEATURES).map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        name: f.properties?.name || null,
        description: f.properties?.description || null,
        fill: f.properties?.fill || null,
        stroke: f.properties?.stroke || null,
      },
    }));

    return {
      source: 'DeepStateMap.live',
      timestamp: new Date().toISOString(),
      status: 'active',
      mapId: data.id || null,
      total: features.length,
      geojson: { type: 'FeatureCollection', features: trimmed },
    };
  } catch (e) {
    return { source: 'DeepStateMap.live', timestamp: new Date().toISOString(), status: 'error', error: e.message };
  }
}

if (process.argv[1]?.endsWith('frontlines.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
