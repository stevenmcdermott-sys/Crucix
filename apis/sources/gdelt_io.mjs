// Crucix Source: GDELT IO Monitor
// Multilingual narrative monitoring against UK targets

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

export const STATE_MEDIA = {
  russia: [
    'rt.com', 'sputniknews.com', 'sputnikglobe.com',
    'tass.com', 'ria.ru', 'gazeta.ru', 'rg.ru',
    'lifenews.ru', 'eadaily.com', 'southfront.org',
    'strategic-culture.org', 'globalresearch.ca'
  ],
  china: [
    'cgtn.com', 'xinhuanet.com', 'globaltimes.cn',
    'chinadaily.com.cn', 'people.cn', 'china.org.cn',
    'cctv.com'
  ],
  iran: [
    'presstv.ir', 'irna.ir', 'tasnimnews.com',
    'mehrnews.com', 'farsnews.ir', 'iribnews.ir'
  ]
};

const ALL_STATE_DOMAINS = Object.values(STATE_MEDIA).flat();

const UK_KEYWORDS = [
  'UK', 'Britain', '"United Kingdom"', '"British government"',
  'NHS', 'GCHQ', 'MI5', 'MI6', 'Whitehall', 'Westminster',
  'Starmer', '"British army"', '"Royal Navy"', '"British intelligence"'
];

export async function briefing() {
  const startedAt = Date.now();

  const [stateMediaR, hostileToneR, timelineR] = await Promise.allSettled([
    fetchStateMediaUKCoverage({ timespan: '6h', maxRecords: 150 }),
    fetchAntiUKNarratives({ timespan: '6h', maxRecords: 75 }),
    fetchVolumeTimeline({ timespan: '24h' })
  ]);

  const stateMedia  = stateMediaR.status  === 'fulfilled' ? stateMediaR.value  : null;
  const hostileTone = hostileToneR.status === 'fulfilled' ? hostileToneR.value : null;
  const timeline    = timelineR.status    === 'fulfilled' ? timelineR.value    : null;

  const articles = mergeAndDedupe([
    ...(stateMedia?.articles || []),
    ...(hostileTone?.articles || [])
  ]);

  const byActor = aggregateByActor(articles);

  return {
    timestamp: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAt,
    summary: {
      total_articles: articles.length,
      state_media_count: stateMedia?.article_count || 0,
      hostile_tone_count: hostileTone?.article_count || 0
    },
    by_actor: byActor,
    articles,
    timeline: timeline?.timeline || null,
    feed: {
      russia: articles.filter(a => a.actor === 'russia').slice(0, 10),
      china:  articles.filter(a => a.actor === 'china').slice(0, 10),
      iran:   articles.filter(a => a.actor === 'iran').slice(0, 10),
      other:  articles.filter(a => a.actor === 'unknown').slice(0, 10)
    }
  };
}

async function fetchStateMediaUKCoverage(opts = {}) {
  const timespan = opts.timespan || '1h';
  const maxRecords = Math.min(opts.maxRecords || 100, 250);

  const ukQuery = `(${UK_KEYWORDS.join(' OR ')})`;
  const domainQuery = ALL_STATE_DOMAINS.map(d => `domain:${d}`).join(' OR ');
  const fullQuery = `${ukQuery} AND (${domainQuery})`;

  const url = new URL(GDELT_BASE);
  url.searchParams.set('query', fullQuery);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', String(maxRecords));
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', timespan);
  url.searchParams.set('sort', 'datedesc');

  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'DDN-IO-Monitor/1.0' }
  });

  if (!res.ok) throw new Error(`GDELT API ${res.status}`);

  const data = await res.json();
  const articles = (data.articles || []).map(normalizeArticle);

  return {
    timestamp: new Date().toISOString(),
    article_count: articles.length,
    articles
  };
}

async function fetchAntiUKNarratives(opts = {}) {
  const timespan = opts.timespan || '1h';
  const maxRecords = Math.min(opts.maxRecords || 100, 250);

  const ukQuery = `(${UK_KEYWORDS.join(' OR ')})`;

  const url = new URL(GDELT_BASE);
  url.searchParams.set('query', `${ukQuery} tone<-3`);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', String(maxRecords));
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', timespan);
  url.searchParams.set('sort', 'tonedesc');

  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'DDN-IO-Monitor/1.0' }
  });

  if (!res.ok) throw new Error(`GDELT API ${res.status}`);

  const data = await res.json();
  return {
    timestamp: new Date().toISOString(),
    article_count: (data.articles || []).length,
    articles: (data.articles || []).map(normalizeArticle)
  };
}

async function fetchVolumeTimeline(opts = {}) {
  const timespan = opts.timespan || '24h';

  const ukQuery = `(${UK_KEYWORDS.join(' OR ')})`;
  const domainQuery = ALL_STATE_DOMAINS.map(d => `domain:${d}`).join(' OR ');

  const url = new URL(GDELT_BASE);
  url.searchParams.set('query', `${ukQuery} AND (${domainQuery})`);
  url.searchParams.set('mode', 'timelinevol');
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', timespan);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'DDN-IO-Monitor/1.0' }
  });

  if (!res.ok) throw new Error(`GDELT timeline ${res.status}`);
  return res.json();
}

function normalizeArticle(raw) {
  const domain = extractDomain(raw.url);
  return {
    title: raw.title || '(untitled)',
    url: raw.url,
    domain,
    actor: attributeFromDomain(domain),
    language: raw.language || 'unknown',
    sourcecountry: raw.sourcecountry || 'unknown',
    seendate: raw.seendate,
    tone: parseFloat(raw.tone) || 0,
    snippet: raw.title
  };
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function attributeFromDomain(domain) {
  for (const [actor, domains] of Object.entries(STATE_MEDIA)) {
    if (domains.some(d => domain === d || domain.endsWith('.' + d))) {
      return actor;
    }
  }
  return 'unknown';
}

function mergeAndDedupe(articles) {
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    const key = a.url || a.title;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function aggregateByActor(articles) {
  const result = {
    russia:  { count: 0, avg_tone: 0 },
    china:   { count: 0, avg_tone: 0 },
    iran:    { count: 0, avg_tone: 0 },
    unknown: { count: 0, avg_tone: 0 }
  };
  for (const a of articles) {
    const actor = a.actor || 'unknown';
    if (!result[actor]) result[actor] = { count: 0, avg_tone: 0 };
    result[actor].count++;
    result[actor].avg_tone += (a.tone || 0);
  }
  for (const actor of Object.keys(result)) {
    if (result[actor].count > 0) {
      result[actor].avg_tone = +(result[actor].avg_tone / result[actor].count).toFixed(2);
    }
  }
  return result;
}
