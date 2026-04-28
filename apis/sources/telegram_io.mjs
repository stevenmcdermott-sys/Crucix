// Telegram IO Monitor — tracks information operations channels
// Public-only content via RSSHub. No Telegram API key required.

const RSS_BASE = process.env.TELEGRAM_RSS_BASE || 'https://rsshub.app';
const FETCH_TIMEOUT = 20000;

export const IO_CHANNELS = {
  russia: [
    { handle: 'rybar',          name: 'Rybar',                  tier: 'milblogger' },
    { handle: 'wargonzo',       name: 'WarGonzo',               tier: 'milblogger' },
    { handle: 'rusvesnasu',     name: 'Russian Spring',         tier: 'amplifier' },
    { handle: 'readovkanews',   name: 'Readovka',               tier: 'state_aligned' },
    { handle: 'tass_agency',    name: 'TASS',                   tier: 'state' },
    { handle: 'rian_ru',        name: 'RIA Novosti',            tier: 'state' },
    { handle: 'sputnikint',     name: 'Sputnik International',  tier: 'state' }
  ],
  china: [
    { handle: 'cgtnofficial',   name: 'CGTN',                   tier: 'state' },
    { handle: 'globaltimesnews',name: 'Global Times',           tier: 'state' },
    { handle: 'chinaxinhuanews',name: 'Xinhua',                 tier: 'state' }
  ],
  iran: [
    { handle: 'presstv',        name: 'PressTV',                tier: 'state' },
    { handle: 'irna_english',   name: 'IRNA English',           tier: 'state' },
    { handle: 'tasnimnews_en',  name: 'Tasnim News',            tier: 'state' }
  ]
};

async function fetchChannel(handle, actor, meta) {
  const url = `${RSS_BASE}/telegram/channel/${handle}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'User-Agent': 'DDN-IO-Monitor/1.0' }
    });
    if (!res.ok) return { handle, actor, error: `HTTP ${res.status}`, posts: [] };
    const xml = await res.text();
    const posts = parseRSS(xml).map(p => ({
      ...p, channel: handle, channel_name: meta.name, tier: meta.tier, actor
    }));
    return { handle, actor, error: null, posts };
  } catch (err) {
    return { handle, actor, error: err.message, posts: [] };
  }
}

export async function fetchAllIOChannels(opts = {}) {
  const actors = opts.actors || Object.keys(IO_CHANNELS);
  const concurrency = opts.concurrency || 4;
  const maxAgeMs = (opts.maxAgeHours || 6) * 3600 * 1000;
  const cutoff = Date.now() - maxAgeMs;

  const jobs = [];
  for (const actor of actors) {
    for (const meta of IO_CHANNELS[actor] || []) {
      jobs.push({ actor, meta });
    }
  }

  const channelResults = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(j => fetchChannel(j.meta.handle, j.actor, j.meta)));
    channelResults.push(...results);
  }

  const allPosts = [];
  const errors = [];
  for (const r of channelResults) {
    if (r.error) { errors.push({ channel: r.handle, actor: r.actor, error: r.error }); continue; }
    for (const p of r.posts) {
      const pubMs = new Date(p.published).getTime();
      if (isNaN(pubMs) || pubMs >= cutoff) allPosts.push(p);
    }
  }

  allPosts.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

  return {
    source: 'telegram_io',
    timestamp: new Date().toISOString(),
    channels_attempted: jobs.length,
    channels_succeeded: jobs.length - errors.length,
    posts_count: allPosts.length,
    errors,
    posts: allPosts,
    by_actor: groupPostsByActor(allPosts),
    by_tier: groupPostsByTier(allPosts)
  };
}

function parseRSS(xml) {
  const posts = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    posts.push({
      title:       extractTag(block, 'title'),
      link:        extractTag(block, 'link'),
      description: stripHtml(extractTag(block, 'description')),
      published:   extractTag(block, 'pubDate') || extractTag(block, 'dc:date'),
      guid:        extractTag(block, 'guid')
    });
  }
  if (posts.length === 0) {
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/g;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      posts.push({
        title:       extractTag(block, 'title'),
        link:        extractAttr(block, 'link', 'href') || extractTag(block, 'link'),
        description: stripHtml(extractTag(block, 'summary') || extractTag(block, 'content')),
        published:   extractTag(block, 'published') || extractTag(block, 'updated'),
        guid:        extractTag(block, 'id')
      });
    }
  }
  return posts;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function extractAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function groupPostsByActor(posts) {
  const groups = { russia: 0, china: 0, iran: 0 };
  for (const p of posts) if (groups[p.actor] != null) groups[p.actor]++;
  return groups;
}

function groupPostsByTier(posts) {
  const tiers = {};
  for (const p of posts) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
  return tiers;
}

// Crucix source convention
export async function briefing() {
  const result = await fetchAllIOChannels({ maxAgeHours: 6, concurrency: 4 });
  return {
    timestamp: result.timestamp,
    summary: {
      channels_attempted: result.channels_attempted,
      channels_succeeded: result.channels_succeeded,
      posts_count: result.posts_count
    },
    by_actor: result.by_actor,
    by_tier: result.by_tier,
    posts: result.posts.slice(0, 100),
    errors: result.errors
  };
}
