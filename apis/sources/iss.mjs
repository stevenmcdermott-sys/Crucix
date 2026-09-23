// wheretheiss.at — live ISS position
// No API key required. https://wheretheiss.at/w/developer

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://api.wheretheiss.at/v1/satellites/25544';

export async function briefing() {
  try {
    const pos = await safeFetch(BASE, { timeout: 10000 });
    if (pos.error || pos.latitude == null) {
      return { source: 'ISS', timestamp: new Date().toISOString(), status: 'error', error: pos.error || 'Malformed response' };
    }

    return {
      source: 'ISS',
      timestamp: new Date().toISOString(),
      status: 'active',
      lat: pos.latitude,
      lon: pos.longitude,
      altitudeKm: pos.altitude,
      velocityKmh: pos.velocity,
      visibility: pos.visibility,
      solarLat: pos.solar_lat,
      solarLon: pos.solar_lon,
      observedAt: pos.timestamp ? pos.timestamp * 1000 : null,
    };
  } catch (e) {
    return { source: 'ISS', timestamp: new Date().toISOString(), status: 'error', error: e.message };
  }
}

if (process.argv[1]?.endsWith('iss.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
