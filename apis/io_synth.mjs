// Crucix IO Synthesis Layer
// Takes the raw GDELT IO briefing output and enriches it with:
//   - Narrative clustering (deduplication across sources)
//   - Claude Haiku dominant narrative extraction

import { clusterNarratives } from './narrative_cluster.mjs';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export async function enrichIOBriefing(gdeltIOData, opts = {}) {
  if (!gdeltIOData) {
    return { error: 'No GDELT IO data', enriched: false };
  }

  const articles = gdeltIOData.articles || [];
  const narrativeClusters = clusterNarratives(articles);

  let topNarratives = [];
  if (opts.anthropicApiKey && narrativeClusters.length > 0) {
    topNarratives = await extractNarrativesWithHaiku(narrativeClusters, articles, opts.anthropicApiKey);
  }

  return {
    enriched: true,
    timestamp: new Date().toISOString(),
    source_data: {
      total_articles: articles.length,
      by_actor: gdeltIOData.by_actor,
    },
    articles,
    narrative_clusters: narrativeClusters,
    entity_ranking: {},
    top_narratives: topNarratives,
    top_targets: [],
    feed: gdeltIOData.feed,
    timeline: gdeltIOData.timeline
  };
}

async function extractNarrativesWithHaiku(clusters, articles, apiKey) {
  const clusterSummary = clusters.slice(0, 15).map((c, i) =>
    `Cluster ${i + 1} [${c.coordination_indicator}, size=${c.cluster_size}, actors=${c.actors.join(',') || 'unknown'}]: "${c.representative_title}"`
  ).join('\n');

  const sampleHeadlines = articles.slice(0, 30).map(a =>
    `[${a.actor || '?'}] ${a.title}`
  ).join('\n');

  const prompt = [
    'Identify the top 10 dominant narratives from this IO sweep data targeting the UK.',
    '',
    'CLUSTERS:',
    clusterSummary,
    '',
    'SAMPLE ARTICLES:',
    sampleHeadlines,
    '',
    'Return a JSON array only — no preamble, no markdown:',
    '[{"claim": "short sentence describing the narrative", "mentions": <integer>, "confidence": <0.00-1.00>, "sample_sources": []}]',
  ].join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        system: 'You are a UK-focused IO analyst. Extract dominant narratives from clustered state-media article data. Return ONLY valid JSON with no preamble.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`[Haiku Narratives] API error ${res.status}: ${await res.text().catch(() => '')}`);
      return [];
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    return [];
  } catch (err) {
    console.error('[Haiku Narratives] Extraction failed:', err.message);
    return [];
  }
}
