// GLiNER2 Client — Calls Steven's existing multilingual NER backend
// Repo: gitlab.com/stevenmcdermott/gliner2-multilingual
// Architecture: GLiNER-MoE-MultiLingual + GLiNER2 with LoRA adapters
//
// Set GLINER_API_URL in Railway env vars (e.g. https://gliner.your-hetzner-host.de)

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_THRESHOLD = 0.5;

// Propaganda-specific entity labels — leverages your fine-tuned LoRA adapters
export const PROPAGANDA_LABELS = [
  'state_actor',           // GRU, MSS, IRGC, FSB, Wagner
  'named_operation',       // Doppelganger, Ghostwriter, Overload, Storm-1516
  'narrative_claim',       // specific factual assertion (true or false)
  'target_institution',    // NHS, BBC, GCHQ, Parliament, MI5
  'target_person',         // Starmer, Royal Family, ministers
  'amplifier_account',     // named accounts spreading content
  'hostile_country',       // RU, CN, IR, DPRK
  'allied_country',        // UK, US, FR, DE, NATO members
  'weapon_system',         // Storm Shadow, ATACMS, F-35
  'conflict_zone'          // Donbas, Taiwan Strait, Red Sea
];

// Generic multilingual entity labels for baseline extraction
export const STANDARD_LABELS = [
  'person', 'organisation', 'location', 'country',
  'event', 'date', 'money', 'percentage'
];

/**
 * Extract entities from a single text using your GLiNER2 backend.
 *
 * @param {string} text - Text to extract from (any language supported by GLiNER-MoE)
 * @param {Object} opts
 * @param {string[]} opts.labels - Entity labels to extract
 * @param {number} opts.threshold - Confidence threshold (0-1)
 * @param {string} opts.lang - ISO 639-1 language hint (optional, GLiNER auto-detects)
 * @returns {Promise<{entities: Array, lang: string, model: string}>}
 */
export async function extractEntities(text, opts = {}) {
  const apiUrl = process.env.GLINER_API_URL;
  if (!apiUrl) {
    throw new Error('GLINER_API_URL not configured');
  }

  const labels = opts.labels || PROPAGANDA_LABELS;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  const res = await fetch(`${apiUrl}/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.GLINER_API_KEY && {
        'Authorization': `Bearer ${process.env.GLINER_API_KEY}`
      })
    },
    body: JSON.stringify({
      text: text.slice(0, 8000), // safety: avoid massive payloads
      labels,
      threshold,
      ...(opts.lang && { lang: opts.lang })
    }),
    signal: AbortSignal.timeout(opts.timeout || DEFAULT_TIMEOUT_MS)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`GLiNER2 API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Batch extract entities from multiple articles in parallel.
 * Concurrency-limited to avoid overwhelming your backend.
 *
 * @param {Array<{title: string, snippet?: string, language?: string}>} articles
 * @param {Object} opts
 * @returns {Promise<Array>} Articles with `.entities` field added
 */
export async function batchExtract(articles, opts = {}) {
  const concurrency = opts.concurrency || 5;
  const labels = opts.labels || PROPAGANDA_LABELS;
  const results = [];

  for (let i = 0; i < articles.length; i += concurrency) {
    const batch = articles.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(async (article) => {
        const text = [article.title, article.snippet].filter(Boolean).join('. ');
        if (!text || text.length < 10) {
          return { ...article, entities: [], gliner_skipped: 'text_too_short' };
        }

        try {
          const result = await extractEntities(text, {
            labels,
            lang: article.language,
            threshold: opts.threshold
          });
          return {
            ...article,
            entities: result.entities || [],
            gliner_lang: result.lang,
            gliner_model: result.model
          };
        } catch (err) {
          return {
            ...article,
            entities: [],
            gliner_error: err.message
          };
        }
      })
    );

    for (const r of batchResults) {
      results.push(r.status === 'fulfilled' ? r.value : null);
    }
  }

  return results.filter(Boolean);
}

/**
 * Aggregate entity mentions across many articles.
 * Returns ranked frequency counts for dashboard visualisation.
 *
 * @param {Array} articlesWithEntities - Output of batchExtract()
 * @returns {Object} Ranked entity frequencies by label type
 */
export function aggregateEntities(articlesWithEntities) {
  const counts = {}; // { label: { entityText: { count, articles: [] } } }

  for (const article of articlesWithEntities) {
    const seenInArticle = new Set(); // dedupe within article

    for (const ent of article.entities || []) {
      const label = ent.label || ent.type;
      const text = (ent.text || ent.span || '').trim();
      if (!text || !label) continue;

      const key = `${label}::${text.toLowerCase()}`;
      if (seenInArticle.has(key)) continue;
      seenInArticle.add(key);

      if (!counts[label]) counts[label] = {};
      if (!counts[label][text]) {
        counts[label][text] = { count: 0, articles: [], score: 0 };
      }
      counts[label][text].count++;
      counts[label][text].score += (ent.score || 1);
      counts[label][text].articles.push({
        title: article.title,
        url: article.url,
        actor: article.actor
      });
    }
  }

  // Convert to sorted arrays
  const ranked = {};
  for (const [label, entities] of Object.entries(counts)) {
    ranked[label] = Object.entries(entities)
      .map(([text, data]) => ({
        text,
        count: data.count,
        avg_score: data.score / data.count,
        articles: data.articles.slice(0, 5) // top 5 sample articles
      }))
      .sort((a, b) => b.count - a.count);
  }

  return ranked;
}

/**
 * Health check — verifies GLiNER2 backend is reachable and responsive.
 */
export async function checkHealth() {
  const apiUrl = process.env.GLINER_API_URL;
  if (!apiUrl) return { healthy: false, reason: 'GLINER_API_URL not set' };

  try {
    const res = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      return { healthy: false, reason: `Health endpoint ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    return { healthy: true, ...data };
  } catch (err) {
    return { healthy: false, reason: err.message };
  }
}
