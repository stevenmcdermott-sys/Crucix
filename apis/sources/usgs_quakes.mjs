// USGS Earthquake Hazards Program — real-time earthquake feed
// No API key required. https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php

import { safeFetch } from '../utils/fetch.mjs';

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';

export async function briefing() {
  try {
    const data = await safeFetch(FEED_URL, { timeout: 15000 });
    if (data.error || !Array.isArray(data.features)) {
      return { source: 'USGS', timestamp: new Date().toISOString(), status: 'error', error: data.error || 'Malformed response' };
    }

    const quakes = data.features.map(f => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      updated: f.properties.updated,
      tsunami: f.properties.tsunami === 1,
      alert: f.properties.alert || null,
      sig: f.properties.sig || 0,
      url: f.properties.url,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depthKm: f.geometry.coordinates[2],
    })).filter(q => q.mag != null && q.lat != null && q.lon != null);

    quakes.sort((a, b) => b.mag - a.mag);

    const signals = [];
    const major = quakes.filter(q => q.mag >= 6);
    if (major.length) signals.push(`MAJOR SEISMIC ACTIVITY: ${major.length} quake(s) M6.0+ in the last week`);
    const tsunamiWatch = quakes.filter(q => q.tsunami);
    if (tsunamiWatch.length) signals.push(`TSUNAMI FLAG SET: ${tsunamiWatch.length} event(s)`);

    return {
      source: 'USGS',
      timestamp: new Date().toISOString(),
      status: 'active',
      total: quakes.length,
      quakes: quakes.slice(0, 200),
      signals,
    };
  } catch (e) {
    return { source: 'USGS', timestamp: new Date().toISOString(), status: 'error', error: e.message };
  }
}

if (process.argv[1]?.endsWith('usgs_quakes.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
