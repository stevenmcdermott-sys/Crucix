// NASA EONET v3 — Earth Observatory Natural Event Tracker
// No API key required. Tracks open wildfires, volcanic activity, and severe storms.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://eonet.gsfc.nasa.gov/api/v3/events';

const CATEGORIES = {
  wildfires: { days: 14, limit: 150 },
  volcanoes: { days: 30, limit: 60 },
  severeStorms: { days: 7, limit: 60 },
};

function latestPoint(event) {
  const geo = event.geometry;
  if (!Array.isArray(geo) || !geo.length) return null;
  const last = geo[geo.length - 1];
  const coords = last?.coordinates;
  if (!Array.isArray(coords)) return null;
  // Point geometries are [lon, lat]; polygon-ish EONET geometries are rare, skip those
  if (typeof coords[0] !== 'number' || typeof coords[1] !== 'number') return null;
  return { lon: coords[0], lat: coords[1], date: last.date };
}

async function fetchCategory(category, { days, limit }) {
  const url = `${BASE}?status=open&category=${category}&days=${days}&limit=${limit}`;
  const data = await safeFetch(url, { timeout: 20000 });
  if (data.error || !Array.isArray(data.events)) return { category, error: data.error || 'Malformed response', events: [] };

  const events = data.events.map(e => {
    const pos = latestPoint(e);
    if (!pos) return null;
    return {
      id: e.id,
      title: e.title,
      category,
      lat: pos.lat,
      lon: pos.lon,
      date: pos.date,
      link: e.sources?.[0]?.url || e.link,
    };
  }).filter(Boolean);

  return { category, events };
}

export async function briefing() {
  try {
    const results = await Promise.all(
      Object.entries(CATEGORIES).map(([cat, opts]) => fetchCategory(cat, opts))
    );

    const byCategory = Object.fromEntries(results.map(r => [r.category, r.events]));
    const errors = results.filter(r => r.error).map(r => ({ category: r.category, error: r.error }));
    const total = results.reduce((s, r) => s + r.events.length, 0);

    if (total === 0 && errors.length === results.length) {
      return { source: 'NASA EONET', timestamp: new Date().toISOString(), status: 'error', error: errors[0]?.error || 'All categories failed' };
    }

    const signals = [];
    if (byCategory.volcanoes?.length > 5) signals.push(`ELEVATED VOLCANIC ACTIVITY: ${byCategory.volcanoes.length} open events tracked`);
    if (byCategory.wildfires?.length > 80) signals.push(`WIDESPREAD WILDFIRE ACTIVITY: ${byCategory.wildfires.length} open events tracked`);

    return {
      source: 'NASA EONET',
      timestamp: new Date().toISOString(),
      status: 'active',
      total,
      wildfires: byCategory.wildfires || [],
      volcanoes: byCategory.volcanoes || [],
      severeStorms: byCategory.severeStorms || [],
      signals,
      ...(errors.length ? { partialErrors: errors } : {}),
    };
  } catch (e) {
    return { source: 'NASA EONET', timestamp: new Date().toISOString(), status: 'error', error: e.message };
  }
}

if (process.argv[1]?.endsWith('eonet.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
