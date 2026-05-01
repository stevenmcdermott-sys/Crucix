#!/usr/bin/env node
// DDN Intelligence Platform — Dev Server
// Serves the Jarvis dashboard, runs sweep cycle, pushes live updates via SSE

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import config from './crucix.config.mjs';
import { getLocale, currentLanguage, getSupportedLocales } from './lib/i18n.mjs';
import { fullBriefing } from './apis/briefing.mjs';
import { synthesize, generateIdeas } from './dashboard/inject.mjs';
import { MemoryManager } from './lib/delta/index.mjs';
import { createLLMProvider } from './lib/llm/index.mjs';
import { generateLLMIdeas } from './lib/llm/ideas.mjs';
import { TelegramAlerter } from './lib/alerts/telegram.mjs';
import { DiscordAlerter } from './lib/alerts/discord.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const RUNS_DIR = join(ROOT, 'runs');
const MEMORY_DIR = join(RUNS_DIR, 'memory');
const HISTORY_DIR = join(RUNS_DIR, 'history');
const HISTORY_MAX = 96; // 24h at 15-min cadence

// Ensure directories exist
for (const dir of [RUNS_DIR, MEMORY_DIR, join(MEMORY_DIR, 'cold'), HISTORY_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function saveHistory(data) {
  try {
    const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    writeFileSync(join(HISTORY_DIR, `${ts}.json`), JSON.stringify(data));
    // Prune oldest files beyond HISTORY_MAX
    const files = readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();
    if (files.length > HISTORY_MAX) {
      files.slice(0, files.length - HISTORY_MAX).forEach(f => {
        try { unlinkSync(join(HISTORY_DIR, f)); } catch {}
      });
    }
  } catch (err) {
    console.error('[Crucix] History save failed (non-fatal):', err.message);
  }
}

function listHistory() {
  try {
    return readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .map(f => {
        const id = f.replace('.json', '');
        const ts = id.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
        const size = statSync(join(HISTORY_DIR, f)).size;
        return { id, timestamp: ts, sizeKb: Math.round(size / 1024) };
      });
  } catch {
    return [];
  }
}

// === State ===
let currentData = null;    // Current synthesized dashboard data
let lastSweepTime = null;  // Timestamp of last sweep
let sweepStartedAt = null; // Timestamp when current/last sweep started
let sweepInProgress = false;
let lastSourceErrors = []; // Source-level errors from last sweep
let lastSourceTiming = {}; // Per-source timing from last sweep
const startTime = Date.now();
const sseClients = new Set();

// === Delta/Memory ===
const memory = new MemoryManager(RUNS_DIR);

// === LLM + Telegram + Discord ===
const llmProvider = createLLMProvider(config.llm);
const telegramAlerter = new TelegramAlerter(config.telegram);
const discordAlerter = new DiscordAlerter(config.discord || {});

if (llmProvider) console.log(`[Crucix] LLM enabled: ${llmProvider.name} (${llmProvider.model})`);
if (telegramAlerter.isConfigured) {
  console.log('[Crucix] Telegram alerts enabled');

  // ─── Two-Way Bot Commands ───────────────────────────────────────────────

  telegramAlerter.onCommand('/status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `🖥️ *DDN STATUS*`,
      ``,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: http://localhost:${config.port}`,
    ].join('\n');
  });

  telegramAlerter.onCommand('/sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    // Fire and forget — don't block the bot response
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  telegramAlerter.onCommand('/brief', async () => {
    if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';

    const tg = currentData.tg || {};
    const energy = currentData.energy || {};
    const delta = memory.getLastDelta();
    const ideas = (currentData.ideas || []).slice(0, 3);

    const sections = [
      `📋 *DDN BRIEF*`,
      `_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_`,
      ``,
    ];

    // Delta direction
    if (delta?.summary) {
      const dirEmoji = { 'risk-off': '📉', 'risk-on': '📈', 'mixed': '↔️' }[delta.summary.direction] || '↔️';
      sections.push(`${dirEmoji} Direction: *${delta.summary.direction.toUpperCase()}* | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
      sections.push('');
    }

    // Key metrics
    const vix = currentData.fred?.find(f => f.id === 'VIXCLS');
    const hy = currentData.fred?.find(f => f.id === 'BAMLH0A0HYM2');
    if (vix || energy.wti) {
      sections.push(`📊 VIX: ${vix?.value || '--'} | WTI: $${energy.wti || '--'} | Brent: $${energy.brent || '--'}`);
      if (hy) sections.push(`   HY Spread: ${hy.value} | NatGas: $${energy.natgas || '--'}`);
      sections.push('');
    }

    // OSINT
    if (tg.urgent?.length > 0) {
      sections.push(`📡 OSINT: ${tg.urgent.length} urgent signals, ${tg.posts || 0} total posts`);
      // Top 2 urgent
      for (const p of tg.urgent.slice(0, 2)) {
        sections.push(`  • ${(p.text || '').substring(0, 80)}`);
      }
      sections.push('');
    }

    // Top ideas
    if (ideas.length > 0) {
      sections.push(`💡 *Top Ideas:*`);
      for (const idea of ideas) {
        sections.push(`  ${idea.type === 'long' ? '📈' : idea.type === 'hedge' ? '🛡️' : '👁️'} ${idea.title}`);
      }
    }

    return sections.join('\n');
  });

  telegramAlerter.onCommand('/portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start polling for bot commands
  telegramAlerter.startPolling(config.telegram.botPollingInterval);
}

// === Discord Bot ===
if (discordAlerter.isConfigured) {
  console.log('[Crucix] Discord bot enabled');

  // Reuse the same command handlers as Telegram (DRY)
  discordAlerter.onCommand('status', async () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sourcesOk = currentData?.meta?.sourcesOk || 0;
    const sourcesTotal = currentData?.meta?.sourcesQueried || 0;
    const sourcesFailed = currentData?.meta?.sourcesFailed || 0;
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `**🖥️ DDN STATUS**\n`,
      `Uptime: ${h}h ${m}m`,
      `Last sweep: ${lastSweepTime ? new Date(lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${sourcesOk}/${sourcesTotal} OK${sourcesFailed > 0 ? ` (${sourcesFailed} failed)` : ''}`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
      `Dashboard: http://localhost:${config.port}`,
    ].join('\n');
  });

  discordAlerter.onCommand('sweep', async () => {
    if (sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    runSweepCycle().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered. You\'ll receive alerts if anything significant is detected.';
  });

  discordAlerter.onCommand('brief', async () => {
    if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';

    const tg = currentData.tg || {};
    const energy = currentData.energy || {};
    const delta = memory.getLastDelta();
    const ideas = (currentData.ideas || []).slice(0, 3);

    const sections = [`**📋 DDN BRIEF**\n_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_\n`];

    if (delta?.summary) {
      const dirEmoji = { 'risk-off': '📉', 'risk-on': '📈', 'mixed': '↔️' }[delta.summary.direction] || '↔️';
      sections.push(`${dirEmoji} Direction: **${delta.summary.direction.toUpperCase()}** | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical\n`);
    }

    const vix = currentData.fred?.find(f => f.id === 'VIXCLS');
    const hy = currentData.fred?.find(f => f.id === 'BAMLH0A0HYM2');
    if (vix || energy.wti) {
      sections.push(`📊 VIX: ${vix?.value || '--'} | WTI: $${energy.wti || '--'} | Brent: $${energy.brent || '--'}`);
      if (hy) sections.push(`   HY Spread: ${hy.value} | NatGas: $${energy.natgas || '--'}`);
      sections.push('');
    }

    if (tg.urgent?.length > 0) {
      sections.push(`📡 OSINT: ${tg.urgent.length} urgent signals, ${tg.posts || 0} total posts`);
      for (const p of tg.urgent.slice(0, 2)) {
        sections.push(`  • ${(p.text || '').substring(0, 80)}`);
      }
      sections.push('');
    }

    if (ideas.length > 0) {
      sections.push(`**💡 Top Ideas:**`);
      for (const idea of ideas) {
        sections.push(`  ${idea.type === 'long' ? '📈' : idea.type === 'hedge' ? '🛡️' : '👁️'} ${idea.title}`);
      }
    }

    return sections.join('\n');
  });

  discordAlerter.onCommand('portfolio', async () => {
    return '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.';
  });

  // Start the Discord bot (non-blocking — connection happens async)
  discordAlerter.start().catch(err => {
    console.error('[Crucix] Discord bot startup failed (non-fatal):', err.message);
  });
}

// === Express Server ===
const app = express();
app.use(express.static(join(ROOT, 'dashboard/public')));

// Serve loading page until first sweep completes, then the dashboard with injected locale
app.get('/', (req, res) => {
  if (!currentData) {
    res.sendFile(join(ROOT, 'dashboard/public/loading.html'));
  } else {
    const htmlPath = join(ROOT, 'dashboard/public/jarvis.html');
    let html = readFileSync(htmlPath, 'utf-8');
    
    // Inject locale data into the HTML
    const locale = getLocale();
    const localeScript = `<script>window.__DDN_LOCALE__ = ${JSON.stringify(locale).replace(/<\/script>/gi, '<\\/script>')};</script>`;
    html = html.replace('</head>', `${localeScript}\n</head>`);
    
    res.type('html').send(html);
  }
});

// API: current data
app.get('/api/data', (req, res) => {
  if (!currentData) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  res.json(currentData);
});

// API: health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    lastSweep: lastSweepTime,
    nextSweep: lastSweepTime
      ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
      : null,
    sweepInProgress,
    sweepStartedAt,
    sourcesOk: currentData?.meta?.sourcesOk || 0,
    sourcesFailed: currentData?.meta?.sourcesFailed || 0,
    llmEnabled: !!config.llm.provider,
    llmProvider: config.llm.provider,
    telegramEnabled: !!(config.telegram.botToken && config.telegram.chatId),
    refreshIntervalMinutes: config.refreshIntervalMinutes,
    language: currentLanguage,
  });
});

// API: raw FRED probe — shows exactly what FRED returns for VIXCLS
app.get('/api/debug/fred', async (req, res) => {
  const key = process.env.FRED_API_KEY;
  if (!key) return res.json({ error: 'FRED_API_KEY not set' });
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key=${key}&file_type=json&sort_order=desc&limit=3&observation_start=2026-01-01`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { rawText: text.slice(0, 500) }; }
    res.json({ httpStatus: r.status, keyPrefix: key.slice(0, 6) + '...', data: parsed });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// API: source-level status — shows which sources failed and why
app.get('/api/sources', (req, res) => {
  const envKeys = ['FRED_API_KEY','EIA_API_KEY','FIRMS_MAP_KEY','AISSTREAM_API_KEY',
                   'ACLED_EMAIL','ACLED_PASSWORD','LLM_API_KEY','LLM_PROVIDER'];
  res.json({
    lastSweep: lastSweepTime,
    errors: lastSourceErrors,
    timing: Object.entries(lastSourceTiming).map(([name, t]) => ({ name, status: t.status, ms: t.ms }))
             .sort((a, b) => (b.ms || 0) - (a.ms || 0)),
    envPresent: Object.fromEntries(envKeys.map(k => [k, !!process.env[k]])),
    synthesized: {
      fredCount: currentData?.fred?.length ?? 'no currentData',
      fredSample: currentData?.fred?.slice(0, 2) ?? null,
      spaceOk: !!(currentData?.space?.militarySats > 0 || currentData?.space?.totalNewObjects > 0),
      spaceSample: currentData?.space ? { totalNewObjects: currentData.space.totalNewObjects, militarySats: currentData.space.militarySats } : null,
    },
  });
});

// API: available locales
app.get('/api/locales', (req, res) => {
  res.json({
    current: currentLanguage,
    supported: getSupportedLocales(),
  });
});

// API: history list — available sweep snapshots for playback
app.get('/api/history', (req, res) => {
  res.json({ runs: listHistory() });
});

// API: history fetch — single sweep snapshot by id
app.get('/api/history/:id', (req, res) => {
  const file = join(HISTORY_DIR, `${req.params.id}.json`);
  if (!existsSync(file)) return res.status(404).json({ error: 'Run not found' });
  try {
    res.json(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: system diagnostic — verifies collection parameters, crawler health, and cadence
app.get('/api/diagnostic', (req, res) => {
  const now = Date.now();
  const checks = [];

  // 1. Verify sweep collection parameters
  const registeredSources = Object.keys(lastSourceTiming).length || 29;
  checks.push({
    id: 'collection_params',
    label: 'Sweep collection parameters',
    detail: `Language: ${currentLanguage}, Refresh interval: ${config.refreshIntervalMinutes}min, Sources registered: ${registeredSources}`,
    ok: true,
  });

  // 2. Confirm crawler functionality — IO / state-media sources
  const ioSourceNames = ['GDELT_IO', 'Telegram_IO', 'GDELT', 'Telegram', 'Bluesky', 'Reddit'];
  const ioTiming = ioSourceNames.map(name => ({
    name,
    ...(lastSourceTiming[name] || { status: 'no_data', ms: null }),
  }));
  const ioFailed = ioTiming.filter(s => s.status !== 'ok');
  checks.push({
    id: 'crawler_health',
    label: 'Crawler functionality (Russian, Chinese, Iranian state media + amplifier networks)',
    detail: ioFailed.length === 0
      ? `All ${ioSourceNames.length} IO collectors operational`
      : `${ioFailed.length} collector(s) degraded: ${ioFailed.map(s => s.name).join(', ')}`,
    ok: ioFailed.length === 0,
    sources: ioTiming,
  });

  // 3. Check for collection gaps in the last hour
  let gapOk = true;
  let gapDetail;
  if (!lastSweepTime) {
    gapOk = false;
    gapDetail = 'No sweep has completed yet';
  } else {
    const msSince = now - new Date(lastSweepTime).getTime();
    const expectedMs = config.refreshIntervalMinutes * 60 * 1000;
    const overdue = msSince > expectedMs * 1.5;
    gapOk = !overdue;
    const minAgo = Math.floor(msSince / 60000);
    gapDetail = overdue
      ? `Last sweep ${minAgo}min ago — exceeds ${config.refreshIntervalMinutes}min cadence`
      : `Last sweep ${minAgo}min ago — within normal ${config.refreshIntervalMinutes}min cadence`;
  }
  checks.push({
    id: 'collection_gaps',
    label: `Collection gaps (1-hour window: ${lastSweepTime || 'pending'})`,
    detail: gapDetail,
    ok: gapOk,
  });

  // 4. Confirm standard monitoring cadence is active
  const nextSweep = lastSweepTime
    ? new Date(new Date(lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
    : null;
  checks.push({
    id: 'monitoring_cadence',
    label: 'Standard monitoring cadence',
    detail: sweepInProgress
      ? 'Sweep currently in progress'
      : nextSweep
        ? `Next sweep scheduled: ${new Date(nextSweep).toLocaleTimeString()}`
        : 'Awaiting first sweep',
    ok: !!(lastSweepTime && !sweepInProgress) || sweepInProgress,
  });

  const allClear = checks.every(c => c.ok);
  res.json({
    timestamp: new Date().toISOString(),
    allClear,
    checks,
    summary: allClear
      ? 'All diagnostic checks passed. No new intelligence to present.'
      : `${checks.filter(c => !c.ok).length} check(s) require attention.`,
    lastSweep: lastSweepTime,
    sweepInProgress,
  });
});

// === Theater Intelligence ===

const THEATER_DEFS = {
  americas:    {
    name: 'Americas',
    bounds: (la,ln) => la>-60&&la<72&&ln>-170&&ln<-30,
    keywords: ['us','usa','united states','america','canada','mexico','brazil','venezuela','colombia','panama','cuba','cartel','pentagon','washington','congress','trump','tariff','border','latin','caribbean','arctic']
  },
  europe:      {
    name: 'Europe',
    bounds: (la,ln) => la>35&&la<72&&ln>-12&&ln<45,
    keywords: ['ukraine','russia','nato','eu','europe','european','britain','uk','france','germany','poland','baltic','moldova','belarus','kyiv','moscow','paris','berlin','london','brussels','finland','sweden','norway','crimea','donbas']
  },
  middleEast:  {
    name: 'Middle East',
    bounds: (la,ln) => la>12&&la<42&&ln>24&&ln<65,
    keywords: ['iran','israel','gaza','hamas','hezbollah','saudi','yemen','iraq','syria','lebanon','jordan','egypt','turkey','qatar','uae','persian gulf','red sea','houthi','tehran','jerusalem','riyadh','beirut']
  },
  asiaPacific: {
    name: 'Asia-Pacific',
    bounds: (la,ln) => la>-15&&la<55&&ln>60&&ln<180,
    keywords: ['china','taiwan','japan','korea','north korea','south korea','india','pakistan','philippines','vietnam','myanmar','south china sea','beijing','tokyo','seoul','pyongyang','delhi','australia','indonesia','pla','prc']
  },
  africa:      {
    name: 'Africa',
    bounds: (la,ln) => la>-36&&la<38&&ln>-20&&ln<55,
    keywords: ['africa','nigeria','kenya','ethiopia','somalia','sudan','congo','mali','sahel','mozambique','zimbabwe','south africa','cameroon','chad','wagner','burkina','senegal','rwanda','tanzania','angola']
  },
};

function filterForTheater(data, region) {
  const def = THEATER_DEFS[region];
  if (!def || !data) return null;
  const { bounds, keywords, name } = def;

  const matchKw = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return keywords.some(k => lower.includes(k));
  };

  const airInRegion    = (data.air||[]).filter(a => a.lat && a.lon && bounds(a.lat, a.lon));
  const thermalInRegion= (data.thermal||[]).filter(t => t.fires?.some(f => bounds(f.lat, f.lon)));
  const acledInRegion  = (data.acled?.deadliestEvents||[]).filter(e => e.lat && e.lon && bounds(e.lat, e.lon));
  const osintInRegion  = (data.tg?.urgent||[]).filter(p => matchKw(p.text)).slice(0, 12);
  const newsInRegion   = (data.news||[]).filter(n =>
    (n.lat && n.lon && bounds(n.lat, n.lon)) || matchKw(n.title)
  ).slice(0, 20);

  return {
    region, name,
    timestamp: data.meta?.timestamp || new Date().toISOString(),
    air:         airInRegion,
    thermal:     thermalInRegion,
    chokepoints: (data.chokepoints||[]).filter(c => c.lat && c.lon && bounds(c.lat, c.lon)),
    osint:       osintInRegion,
    news:        newsInRegion,
    acled:       acledInRegion,
    who:         (data.who||[]).filter(w => matchKw(w.title) || matchKw(w.summary)),
    noaaAlerts:  (data.noaa?.alerts||[]).filter(a => a.lat && a.lon && bounds(a.lat, a.lon)),
    gdeltGeoPoints: (data.gdelt?.geoPoints||[]).filter(p => p.lat && p.lon && bounds(p.lat, p.lon)).slice(0, 12),
    stats: {
      aircraftTotal:    airInRegion.reduce((s,a) => s+(a.total||0), 0),
      thermalTotal:     thermalInRegion.reduce((s,t) => s+(t.det||0), 0),
      osintCount:       osintInRegion.length,
      newsCount:        newsInRegion.length,
      acledEvents:      acledInRegion.length,
      acledFatalities:  acledInRegion.reduce((s,e) => s+(e.fatalities||0), 0),
      chokepointCount:  (data.chokepoints||[]).filter(c => c.lat && c.lon && bounds(c.lat, c.lon)).length,
    },
  };
}

// API: single theater — regionally filtered data bundle
app.get('/api/theater/:region', (req, res) => {
  const { region } = req.params;
  if (!THEATER_DEFS[region]) {
    return res.status(400).json({ error: `Unknown region: ${region}. Valid: ${Object.keys(THEATER_DEFS).join(', ')}` });
  }
  if (!currentData) return res.status(503).json({ error: 'No data yet — first sweep in progress' });
  res.json(filterForTheater(currentData, region));
});

// API: all theaters summary — heat-map overview of all 5
app.get('/api/theaters', (req, res) => {
  if (!currentData) return res.status(503).json({ error: 'No data yet' });
  const theaters = {};
  for (const region of Object.keys(THEATER_DEFS)) {
    const f = filterForTheater(currentData, region);
    theaters[region] = { name: f.name, stats: f.stats, topOsint: f.osint.slice(0,2), topNews: f.news.slice(0,3) };
  }
  res.json({ timestamp: currentData.meta?.timestamp, theaters });
});

// SSE: live updates
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// === Sweep Cycle ===
async function runSweepCycle() {
  if (sweepInProgress) {
    console.log('[Crucix] Sweep already in progress, skipping');
    return;
  }

  sweepInProgress = true;
  sweepStartedAt = new Date().toISOString();
  broadcast({ type: 'sweep_start', timestamp: sweepStartedAt });
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Crucix] Starting sweep at ${new Date().toLocaleTimeString()}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 1. Run the full briefing sweep
    const rawData = await fullBriefing();

    // 2. Save to runs/latest.json
    writeFileSync(join(RUNS_DIR, 'latest.json'), JSON.stringify(rawData, null, 2));
    lastSweepTime = new Date().toISOString();
    lastSourceErrors = rawData.errors || [];
    lastSourceTiming = rawData.timing || {};

    // 3. Synthesize into dashboard format
    console.log('[Crucix] Synthesizing dashboard data...');
    const synthesized = await synthesize(rawData);

    // 4. Delta computation + memory
    const delta = memory.addRun(synthesized);
    synthesized.delta = delta;

    // 5. LLM-powered trade ideas (LLM-only feature) — isolated so failures don't kill sweep
    if (llmProvider?.isConfigured) {
      try {
        console.log('[Crucix] Generating LLM trade ideas...');
        const previousIdeas = memory.getLastRun()?.ideas || [];
        const llmIdeas = await generateLLMIdeas(llmProvider, synthesized, delta, previousIdeas);
        if (llmIdeas) {
          synthesized.ideas = llmIdeas;
          synthesized.ideasSource = 'llm';
          console.log(`[Crucix] LLM generated ${llmIdeas.length} ideas`);
        } else {
          synthesized.ideas = [];
          synthesized.ideasSource = 'llm-failed';
        }
      } catch (llmErr) {
        console.error('[Crucix] LLM ideas failed (non-fatal):', llmErr.message);
        synthesized.ideas = [];
        synthesized.ideasSource = 'llm-failed';
      }
    } else {
      synthesized.ideas = [];
      synthesized.ideasSource = 'disabled';
    }

    // 6. Alert evaluation — Telegram + Discord (LLM with rule-based fallback, multi-tier, semantic dedup)
    if (delta?.summary?.totalChanges > 0) {
      if (telegramAlerter.isConfigured) {
        telegramAlerter.evaluateAndAlert(llmProvider, delta, memory).catch(err => {
          console.error('[Crucix] Telegram alert error:', err.message);
        });
      }
      if (discordAlerter.isConfigured) {
        discordAlerter.evaluateAndAlert(llmProvider, delta, memory).catch(err => {
          console.error('[Crucix] Discord alert error:', err.message);
        });
      }
    }

    // Prune old alerted signals
    memory.pruneAlertedSignals();

    // Attach IO intelligence — carry forward previous sweep's data if new sweep didn't produce any
    synthesized.io_intelligence = rawData.io_intelligence || currentData?.io_intelligence || null;
    currentData = synthesized;

    // Save to history for playback and correlation engine
    saveHistory(currentData);

    // 6. Push to all connected browsers
    broadcast({ type: 'update', data: currentData });

    console.log(`[Crucix] Sweep complete — ${currentData.meta.sourcesOk}/${currentData.meta.sourcesQueried} sources OK`);
    console.log(`[Crucix] ${currentData.ideas.length} ideas (${synthesized.ideasSource}) | ${currentData.news.length} news | ${currentData.newsFeed.length} feed items`);
    if (delta?.summary) console.log(`[Crucix] Delta: ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical, direction: ${delta.summary.direction}`);
    console.log(`[Crucix] Next sweep at ${new Date(Date.now() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()}`);

  } catch (err) {
    console.error('[Crucix] Sweep failed:', err.message);
    broadcast({ type: 'sweep_error', error: err.message });
  } finally {
    sweepInProgress = false;
  }
}

// === Startup ===
async function start() {
  const port = process.env.PORT || config.port;

  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           DDN INTELLIGENCE PLATFORM         ║
  ║          DDN Intelligence · 26 Sources         ║
  ╠══════════════════════════════════════════════╣
  ║  Dashboard:  http://localhost:${port}${' '.repeat(14 - String(port).length)}║
  ║  Health:     http://localhost:${port}/api/health${' '.repeat(4 - String(port).length)}║
  ║  Refresh:    Every ${config.refreshIntervalMinutes} min${' '.repeat(20 - String(config.refreshIntervalMinutes).length)}║
  ║  LLM:        ${(config.llm.provider || 'disabled').padEnd(31)}║
  ║  Telegram:   ${config.telegram.botToken ? 'enabled' : 'disabled'}${' '.repeat(config.telegram.botToken ? 24 : 23)}║
  ║  Discord:    ${config.discord?.botToken ? 'enabled' : config.discord?.webhookUrl ? 'webhook only' : 'disabled'}${' '.repeat(config.discord?.botToken ? 24 : config.discord?.webhookUrl ? 20 : 23)}║
  ╚══════════════════════════════════════════════╝
  `);

  const server = app.listen(port, '0.0.0.0');

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[Crucix] FATAL: Port ${port} is already in use!`);
      console.error(`[Crucix] A previous Crucix instance may still be running.`);
      console.error(`[Crucix] Fix:  taskkill /F /IM node.exe   (Windows)`);
      console.error(`[Crucix]       kill $(lsof -ti:${port})   (macOS/Linux)`);
      console.error(`[Crucix] Or change PORT in .env\n`);
    } else {
      console.error(`[Crucix] Server error:`, err.stack || err.message);
    }
    process.exit(1);
  });

  server.on('listening', async () => {
    console.log(`[Crucix] Server running on http://localhost:${port}`);

    // Auto-open browser
    // NOTE: On Windows, `start` in PowerShell is an alias for Start-Service, not cmd's start.
    // We must use `cmd /c start ""` to ensure it works in both cmd.exe and PowerShell.
    const openCmd = process.platform === 'win32' ? 'cmd /c start ""' :
                    process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${openCmd} "http://localhost:${port}"`, (err) => {
      if (err) console.log('[Crucix] Could not auto-open browser:', err.message);
    });

    // Try to load existing data first for instant display (await so dashboard shows immediately)
    try {
      const existing = JSON.parse(readFileSync(join(RUNS_DIR, 'latest.json'), 'utf8'));
      const data = await synthesize(existing);
      data.io_intelligence = existing?.io_intelligence || null;
      currentData = data;
      console.log('[Crucix] Loaded existing data from runs/latest.json — dashboard ready instantly');
      broadcast({ type: 'update', data: currentData });
    } catch {
      console.log('[Crucix] No existing data found — first sweep required');
    }

    // Run first sweep (refreshes data in background)
    console.log('[Crucix] Running initial sweep...');
    runSweepCycle().catch(err => {
      console.error('[Crucix] Initial sweep failed:', err.message || err);
    });

    // Schedule recurring sweeps
    setInterval(runSweepCycle, config.refreshIntervalMinutes * 60 * 1000);
  });
}

// Graceful error handling — log full stack traces for diagnosis
process.on('unhandledRejection', (err) => {
  console.error('[Crucix] Unhandled rejection:', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[Crucix] Uncaught exception:', err?.stack || err?.message || err);
});

start().catch(err => {
  console.error('[Crucix] FATAL — Server failed to start:', err?.stack || err?.message || err);
  process.exit(1);
});
