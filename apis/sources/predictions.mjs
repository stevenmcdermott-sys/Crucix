// Polymarket — public prediction market data (Gamma API)
// No API key required. https://docs.polymarket.com/

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://gamma-api.polymarket.com/events';

// Geopolitics/macro tags worth surfacing on an intelligence map — Polymarket
// has thousands of markets (sports, pop culture, etc.) we don't want.
const RELEVANT_KEYWORDS = [
  'war', 'ukraine', 'russia', 'china', 'taiwan', 'iran', 'israel', 'gaza', 'nato',
  'election', 'president', 'sanction', 'nuclear', 'strike', 'invasion', 'ceasefire',
  'fed', 'inflation', 'recession', 'government', 'shutdown', 'tariff',
];

function isRelevant(title = '') {
  const lower = title.toLowerCase();
  return RELEVANT_KEYWORDS.some(k => lower.includes(k));
}

export async function briefing() {
  try {
    const url = `${BASE}?limit=100&active=true&closed=false&order=volume&ascending=false`;
    const data = await safeFetch(url, { timeout: 15000 });
    if (data.error || !Array.isArray(data)) {
      return { source: 'Polymarket', timestamp: new Date().toISOString(), status: 'error', error: data.error || 'Malformed response' };
    }

    const markets = data
      .filter(e => isRelevant(e.title))
      .slice(0, 30)
      .map(e => {
        const market = e.markets?.[0];
        let yesPrice = null;
        try {
          const prices = JSON.parse(market?.outcomePrices || '[]');
          yesPrice = prices?.[0] != null ? +prices[0] : null;
        } catch { /* leave null */ }
        return {
          id: e.id,
          slug: e.slug,
          title: e.title,
          url: `https://polymarket.com/event/${e.slug}`,
          volume: +e.volume || 0,
          liquidity: +e.liquidity || 0,
          endDate: market?.endDate || e.endDate || null,
          yesPrice,
          image: e.image || e.icon || null,
        };
      });

    markets.sort((a, b) => b.volume - a.volume);

    return {
      source: 'Polymarket',
      timestamp: new Date().toISOString(),
      status: 'active',
      total: markets.length,
      markets,
    };
  } catch (e) {
    return { source: 'Polymarket', timestamp: new Date().toISOString(), status: 'error', error: e.message };
  }
}

if (process.argv[1]?.endsWith('predictions.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
