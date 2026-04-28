// Crucix IO Synthesis Layer
// Takes the raw GDELT IO briefing output and enriches it with:
//   - GLiNER2 entity extraction (if backend configured)
//   - Narrative clustering (deduplication across sources)

import { batchExtract, aggregateEntities, checkHealth as glinerHealth, PROPAGANDA_LABELS } from './gliner_client.mjs';
import { clusterNarratives } from './narrative_cluster.mjs';

export async function enrichIOBriefing(gdeltIOData, opts = {}) {
  if (!gdeltIOData) {
    return { error: 'No GDELT IO data', enriched: false };
  }

  const useGLiNER = opts.useGLiNER ?? !!process.env.GLINER_API_URL;
  let articles = gdeltIOData.articles || [];
  let glinerStatus = 'disabled';
  let entityRanking = {};

  if (useGLiNER && articles.length > 0) {
    try {
      const health = await glinerHealth();
      if (!health.healthy) {
        glinerStatus = `unhealthy: ${health.reason}`;
      } else {
        articles = await batchExtract(articles, {
          labels: PROPAGANDA_LABELS,
          concurrency: 5,
          threshold: 0.5
        });
        entityRanking = aggregateEntities(articles);
        glinerStatus = `extracted from ${articles.length} articles`;
      }
    } catch (err) {
      glinerStatus = `error: ${err.message}`;
    }
  }

  const narrativeClusters = clusterNarratives(articles);

  return {
    enriched: true,
    timestamp: new Date().toISOString(),
    source_data: {
      total_articles: articles.length,
      by_actor: gdeltIOData.by_actor,
      gliner_status: glinerStatus
    },
    articles,
    narrative_clusters: narrativeClusters,
    entity_ranking: entityRanking,
    top_narratives: extractTopNarratives(entityRanking),
    top_targets: extractTopTargets(entityRanking),
    feed: gdeltIOData.feed,
    timeline: gdeltIOData.timeline
  };
}

function extractTopNarratives(ranking, limit = 10) {
  const claims = ranking.narrative_claim || [];
  return claims.slice(0, limit).map(c => ({
    claim: c.text,
    mentions: c.count,
    confidence: +(c.avg_score || 0).toFixed(2),
    sample_sources: c.articles
  }));
}

function extractTopTargets(ranking, limit = 10) {
  const targets = [
    ...(ranking.target_institution || []),
    ...(ranking.target_person || [])
  ];
  return targets
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(t => ({
      target: t.text,
      mentions: t.count,
      sources: t.articles?.length || 0
    }));
}
