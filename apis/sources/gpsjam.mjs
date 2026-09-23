// GPSJam.org — GPS/GNSS interference map, derived from ADS-B Exchange aircraft nav-integrity data
// No API key required. Data is published as daily CSVs of H3 hex cells, not GeoJSON —
// https://gpsjam.org/data/manifest.csv lists available dates, https://gpsjam.org/data/merged/<date>-h3_4.csv
// holds per-cell good/bad aircraft counts. We resolve each H3 index to a centroid with h3-js.

import { cellToLatLng } from 'h3-js';

const MANIFEST_URL = 'https://gpsjam.org/data/manifest.csv';
const MIN_AIRCRAFT = 3;   // ignore cells with too few observations to be meaningful
const MIN_RATIO = 0.15;   // ignore cells with low jamming ratio (noise floor)

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Crucix/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h.trim()] = cols[i]?.trim(); });
    return row;
  });
}

function levelFor(ratio) {
  if (ratio >= 0.6) return 'high';
  if (ratio >= 0.3) return 'medium';
  return 'low';
}

export async function briefing() {
  try {
    const manifestText = await fetchText(MANIFEST_URL);
    const manifest = parseCsv(manifestText);
    const latest = manifest[manifest.length - 1];
    if (!latest?.date) {
      return { source: 'GPSJam', timestamp: new Date().toISOString(), status: 'error', error: 'Empty manifest' };
    }

    const csvText = await fetchText(`https://gpsjam.org/data/merged/${latest.date}-h3_4.csv`);
    const rows = parseCsv(csvText);

    const zones = [];
    for (const r of rows) {
      const good = parseInt(r.count_good_aircraft, 10) || 0;
      const bad = parseInt(r.count_bad_aircraft, 10) || 0;
      const total = good + bad;
      if (total < MIN_AIRCRAFT) continue;
      const ratio = bad / total;
      if (ratio < MIN_RATIO) continue;
      const [lat, lon] = cellToLatLng(r.hex);
      zones.push({ hex: r.hex, lat, lon, ratio: +ratio.toFixed(3), aircraft: total, level: levelFor(ratio) });
    }

    zones.sort((a, b) => b.ratio - a.ratio);

    const signals = [];
    const high = zones.filter(z => z.level === 'high');
    if (high.length > 5) signals.push(`ACTIVE GPS JAMMING: ${high.length} high-intensity zones detected (${latest.date})`);

    return {
      source: 'GPSJam',
      timestamp: new Date().toISOString(),
      status: 'active',
      date: latest.date,
      suspect: latest.suspect === 'true',
      total: zones.length,
      zones: zones.slice(0, 300),
      signals,
    };
  } catch (e) {
    return { source: 'GPSJam', timestamp: new Date().toISOString(), status: 'error', error: e.message };
  }
}

if (process.argv[1]?.endsWith('gpsjam.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
