// DeepStateMap.live — community-maintained Ukraine frontline geometry
// No API key required. https://deepstatemap.live/api/history/last

import { safeFetch } from '../utils/fetch.mjs';

const URL = 'https://deepstatemap.live/api/history/last';
const MAX_POLYGONS = 200;
const MAX_MARKERS = 300;

// Strip HTML tags/entities DeepStateMap embeds in its marker descriptions —
// enough to make them safe for a plain-text popup, not a full sanitizer.
function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
}

// DeepStateMap's polygons are correctly RFC 7946 (counter-clockwise exterior
// rings). But d3-geo and three-globe's polygon layer both predate the RFC and
// use the opposite convention — feed them RFC-correct winding and every ring
// inverts, filling the complement (the whole rest of the sphere) instead of
// the small intended area. Since every ring here is uniformly CCW, every
// polygon inverts identically — which is exactly what "one solid red globe"
// looks like. Reverse each ring so it renders as the small area it should be.
function reverseRingWinding(geometry) {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(ring => ring.slice().reverse()) };
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(poly => poly.map(ring => ring.slice().reverse())) };
  }
  return geometry;
}

export async function briefing() {
  try {
    const data = await safeFetch(URL, { timeout: 20000 });
    const features = data?.map?.features;
    if (data.error || !Array.isArray(features)) {
      return { source: 'DeepStateMap.live', timestamp: new Date().toISOString(), status: 'error', error: data.error || 'Malformed response' };
    }

    // The feed mixes two very different things in one array: Polygon features
    // are occupied/contested territory shapes, Point features are individually
    // labeled events (equipment losses, named strategic locations). Keep both,
    // but split them — a polygon-only renderer (e.g. Globe.gl's polygons layer)
    // silently drops Point geometry, and lumping them together also means the
    // marker features never get rendered as what they actually are: events.
    const polygons = features.filter(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
    const points = features.filter(f => f.geometry?.type === 'Point');

    // Trim heavy geometry (some polygons carry hundreds of vertices) so the
    // sweep stays light — good enough for map rendering at world/region zoom.
    const trimmedPolygons = polygons.slice(0, MAX_POLYGONS).map(f => ({
      type: 'Feature',
      geometry: reverseRingWinding(f.geometry),
      properties: {
        name: f.properties?.name || null,
        description: f.properties?.description || null,
        fill: f.properties?.fill || null,
        stroke: f.properties?.stroke || null,
      },
    }));

    const markers = points.slice(0, MAX_MARKERS).map(f => ({
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      name: f.properties?.name || 'Marked location',
      description: stripHtml(f.properties?.description),
    })).filter(m => m.lat != null && m.lon != null);

    return {
      source: 'DeepStateMap.live',
      timestamp: new Date().toISOString(),
      status: 'active',
      mapId: data.id || null,
      total: features.length,
      geojson: { type: 'FeatureCollection', features: trimmedPolygons },
      markers,
    };
  } catch (e) {
    return { source: 'DeepStateMap.live', timestamp: new Date().toISOString(), status: 'error', error: e.message };
  }
}

if (process.argv[1]?.endsWith('frontlines.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
