// Narrative Deduplication & Clustering
//
// When 30 articles all push the same anti-UK claim, we want to count it as
// ONE narrative spreading across 30 sources — not 30 separate narratives.
//
// Strategy:
//   1. Normalise text: lowercase, strip punctuation, drop stopwords
//   2. Extract content keywords (stems for English)
//   3. Compute pairwise Jaccard similarity over keyword sets
//   4. Greedy clustering with high-value-term bonus
//   5. Compute coordination score per cluster

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with','by',
  'is','are','was','were','be','been','being','as','from','that','this','these',
  'those','it','its','he','she','they','their','them','his','her','i','we','you',
  'will','would','can','could','should','may','might','has','have','had','do','does',
  'shows','shown','said','says','say','also','more','most','than','then','so','if',
  'after','before','about','against','over','under','out','up','down','into','onto',
  'because','while','during','through','across','via','per','among','very','much'
]);

// UK-specific terms — sharing these strongly suggests same narrative
const HIGH_VALUE_TERMS = new Set([
  'nhs','gchq','starmer','whitehall','westminster','britain','british','britannia',
  'royal','parliament','downing','anglo','saxon','anglosaxon','anglo-saxon','uk',
  'mi5','mi6','five-eye','fiveeye'
]);

const DEFAULT_THRESHOLD = 0.30;
const HIGH_VALUE_TERM_BONUS = 0.20;

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function clusterNarratives(articles, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  if (!articles?.length) return [];

  const items = articles.map(a => ({
    article: a,
    keywords: extractKeywords(a.title || '')
  }));

  const clusters = [];
  for (const item of items) {
    if (item.keywords.size === 0) {
      clusters.push({ items: [item] });
      continue;
    }

    let bestCluster = null;
    let bestSim = 0;
    for (const cluster of clusters) {
      const sim = bestSimilarityToCluster(item, cluster);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestSim >= threshold) {
      bestCluster.items.push(item);
    } else {
      clusters.push({ items: [item] });
    }
  }

  return clusters
    .map(c => buildClusterSummary(c.items))
    .sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────
// Similarity
// ─────────────────────────────────────────────────────────────

function bestSimilarityToCluster(item, cluster) {
  let best = 0;
  for (const member of cluster.items) {
    const sim = enhancedJaccard(item.keywords, member.keywords);
    if (sim > best) best = sim;
  }
  return best;
}

function enhancedJaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  let highValueShared = 0;
  for (const w of setA) {
    if (setB.has(w)) {
      intersection++;
      if (HIGH_VALUE_TERMS.has(w)) highValueShared++;
    }
  }
  const union = setA.size + setB.size - intersection;
  const base = intersection / union;

  // High-value bonus only applies when:
  //   - Base Jaccard is meaningful (≥0.15 — above noise floor)
  //   - Multiple substantive terms are shared (intersection ≥ 2)
  // This prevents single-shared-keyword false positives like
  // "British weather" matching "British NHS collapse".
  const bonus = (base >= 0.15 && intersection >= 2)
    ? Math.min(highValueShared * HIGH_VALUE_TERM_BONUS, 0.4)
    : 0;

  return Math.min(base + bonus, 1.0);
}

// ─────────────────────────────────────────────────────────────
// Keyword extraction
// ─────────────────────────────────────────────────────────────

function extractKeywords(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');

  const out = new Set();
  for (const w of words) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

// Light Porter-style stemmer for English
function stem(w) {
  if (w.length < 5) return w;

  const longSuffixes = ['ization','ational','iveness','fulness','ousness','ations'];
  for (const s of longSuffixes) {
    if (w.endsWith(s) && w.length > s.length + 2) return w.slice(0, -s.length);
  }
  if (w.endsWith('ies') && w.length > 5) return w.slice(0, -3) + 'y';
  const medSuffixes = ['tion','ness','ment','able','ible','ous'];
  for (const s of medSuffixes) {
    if (w.endsWith(s) && w.length > s.length + 3) return w.slice(0, -s.length);
  }
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  const shortSuffixes = ['ed','er','al','ly'];
  for (const s of shortSuffixes) {
    if (w.endsWith(s) && w.length > s.length + 3) return w.slice(0, -s.length);
  }
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 4) return w.slice(0, -1);
  return w;
}

// ─────────────────────────────────────────────────────────────
// Cluster summary
// ─────────────────────────────────────────────────────────────

function buildClusterSummary(items) {
  const articles = items.map(i => i.article);
  const rep = articles
    .slice()
    .sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0))[0];

  const actors = new Set();
  const domains = new Set();
  for (const a of articles) {
    if (a.actor) actors.add(a.actor);
    if (a.domain) domains.add(a.domain);
  }

  const namedActors = [...actors].filter(a => a && a !== 'unknown');
  const score =
    Math.min(articles.length, 50)
    + namedActors.length * 5
    + Math.min(domains.size, 10);

  let coordination;
  if (namedActors.length >= 2) coordination = 'multi-actor';
  else if (articles.length >= 5) coordination = 'amplification';
  else coordination = 'single-source';

  return {
    representative_title: rep.title,
    representative_url: rep.url,
    cluster_size: articles.length,
    actors: namedActors,
    actor_count: namedActors.length,
    domains: [...domains],
    domain_count: domains.size,
    score,
    coordination_indicator: coordination,
    members: articles.map(m => ({
      title: m.title,
      url: m.url,
      domain: m.domain,
      actor: m.actor,
      tone: m.tone
    }))
  };
}
