// OpenSky Network — Real-time flight tracking
// Free for research. 4,000 API credits/day (no auth), 8,000 with account.
// Tracks all aircraft with ADS-B transponders including many military.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://opensky-network.org/api';

// Get all current flights (global state vector)
export async function getAllFlights() {
  return safeFetch(`${BASE}/states/all`, { timeout: 30000 });
}

// Get flights in a bounding box (lat/lon)
export async function getFlightsInArea(lamin, lomin, lamax, lomax) {
  const params = new URLSearchParams({
    lamin: String(lamin),
    lomin: String(lomin),
    lamax: String(lamax),
    lomax: String(lomax),
  });
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get flights by specific aircraft (ICAO24 hex codes)
export async function getFlightsByIcao(icao24List) {
  const icao = Array.isArray(icao24List) ? icao24List : [icao24List];
  const params = icao.map(i => `icao24=${i}`).join('&');
  return safeFetch(`${BASE}/states/all?${params}`, { timeout: 20000 });
}

// Get departures from an airport in a time range
export async function getDepartures(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/departure?${params}`);
}

// Get arrivals at an airport
export async function getArrivals(airportIcao, begin, end) {
  const params = new URLSearchParams({
    airport: airportIcao,
    begin: String(Math.floor(begin / 1000)),
    end: String(Math.floor(end / 1000)),
  });
  return safeFetch(`${BASE}/flights/arrival?${params}`);
}

// Key hotspot regions for monitoring — lat/lon centre included for globe rendering
const HOTSPOTS = {
  middleEast:       { lamin: 12, lomin: 30, lamax: 42, lomax: 65,  label: 'Middle East',      lat: 27, lon: 47 },
  taiwan:           { lamin: 20, lomin: 115, lamax: 28, lomax: 125, label: 'Taiwan Strait',    lat: 24, lon: 120 },
  ukraine:          { lamin: 44, lomin: 22, lamax: 53, lomax: 41,  label: 'Ukraine Region',    lat: 49, lon: 32 },
  baltics:          { lamin: 53, lomin: 19, lamax: 60, lomax: 29,  label: 'Baltic Region',     lat: 57, lon: 24 },
  southChinaSea:    { lamin: 5,  lomin: 105, lamax: 23, lomax: 122, label: 'South China Sea',  lat: 14, lon: 114 },
  koreanPeninsula:  { lamin: 33, lomin: 124, lamax: 43, lomax: 132, label: 'Korean Peninsula', lat: 37, lon: 127 },
  caribbean:        { lamin: 18, lomin: -90, lamax: 30, lomax: -72, label: 'Caribbean',        lat: 25, lon: -80 },
  gulfOfGuinea:     { lamin: -2, lomin: -5,  lamax: 8,  lomax: 10,  label: 'Gulf of Guinea',   lat:  4, lon:  2  },
  capeRoute:        { lamin: -38, lomin: 12, lamax: -28, lomax: 24, label: 'Cape Route',        lat: -34, lon: 18 },
  hornOfAfrica:     { lamin: 5,  lomin: 40,  lamax: 15,  lomax: 55,  label: 'Horn of Africa',   lat: 10, lon: 51 },
};

// Briefing — stagger requests to avoid anonymous rate-limiting (1 req/s safe limit)
export async function briefing() {
  const hotspotEntries = Object.entries(HOTSPOTS);
  const results = [];
  for (const [key, box] of hotspotEntries) {
    const data = await getFlightsInArea(box.lamin, box.lomin, box.lamax, box.lomax);
    const error = data?.error || null;
    const states = Array.isArray(data?.states) ? data.states : [];
    results.push({
      region: box.label,
      key,
      lat: box.lat,
      lon: box.lon,
      totalAircraft: states.length,
      byCountry: states.reduce((acc, s) => {
        const country = s[2] || 'Unknown';
        acc[country] = (acc[country] || 0) + 1;
        return acc;
      }, {}),
      noCallsign: states.filter(s => !s[1]?.trim()).length,
      highAltitude: states.filter(s => s[7] && s[7] > 12000).length,
      ...(error ? { error } : {}),
    });
    // Brief pause between requests to stay within anonymous rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  const hotspotErrors = results
    .filter(r => r.error)
    .map(r => ({ region: r.region, error: r.error }));

  return {
    source: 'OpenSky',
    timestamp: new Date().toISOString(),
    hotspots: results,
    ...(hotspotErrors.length ? {
      error: hotspotErrors.length === results.length
        ? `OpenSky unavailable across all hotspots: ${hotspotErrors[0].error}`
        : `OpenSky unavailable for ${hotspotErrors.length}/${results.length} hotspots`,
      hotspotErrors,
    } : {}),
  };
}

if (process.argv[1]?.endsWith('opensky.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
