/* ═══════════════════════════════════════════════════════
   Crucix Interactive Data Showcase
   Connects to live Crucix API or falls back to demo data
   ═══════════════════════════════════════════════════════ */

let DATA = null;
let map = null;
let layerGroups = {};
let charts = {};

// ═══ DEMO DATA ═══
const DEMO = {
  meta: {
    timestamp: new Date().toISOString(),
    totalDurationMs: 12480,
    sourcesQueried: 27,
    sourcesOk: 25,
    sourcesFailed: 2
  },
  health: [
    { n: 'OpenSky', err: false }, { n: 'FIRMS', err: false }, { n: 'ACLED', err: false },
    { n: 'GDELT', err: false }, { n: 'Safecast', err: false }, { n: 'FRED', err: false },
    { n: 'BLS', err: false }, { n: 'EIA', err: false }, { n: 'Treasury', err: false },
    { n: 'GSCPI', err: false }, { n: 'Telegram', err: false }, { n: 'Reddit', err: true },
    { n: 'Bluesky', err: false }, { n: 'CelesTrak', err: false }, { n: 'KiwiSDR', err: false },
    { n: 'WHO', err: false }, { n: 'NOAA', err: false }, { n: 'Maritime', err: false },
    { n: 'Yahoo Finance', err: false }, { n: 'ReliefWeb', err: false }, { n: 'OFAC', err: false },
    { n: 'Comtrade', err: false }, { n: 'USAspending', err: false }, { n: 'EPA', err: true },
    { n: 'Patents', err: false }, { n: 'OpenSanctions', err: false }, { n: 'ADS-B', err: false }
  ],
  fred: [
    { id: 'VIXCLS', label: 'VIX', value: 22.4, date: '2026-06-20', recent: [19.8, 20.1, 21.3, 22.0, 22.4], momChange: 2.3, momChangePct: 11.4 },
    { id: 'BAMLH0A0HYM2', label: 'HY Spread', value: 3.82, date: '2026-06-20', recent: [3.45, 3.52, 3.65, 3.78, 3.82] },
    { id: 'T10Y2Y', label: '10Y-2Y Spread', value: -0.18, date: '2026-06-20', recent: [-0.32, -0.28, -0.22, -0.20, -0.18] },
    { id: 'DFF', label: 'Fed Funds Rate', value: 4.75, date: '2026-06-20', recent: [5.25, 5.25, 5.00, 4.75, 4.75] },
    { id: 'M2SL', label: 'M2 Supply', value: 21.4e12, date: '2026-06-20' },
    { id: 'DTWEXBGS', label: 'USD Index', value: 103.8, date: '2026-06-20', recent: [104.2, 104.0, 103.5, 103.9, 103.8] },
    { id: 'MORTGAGE30US', label: '30Y Mortgage', value: 6.45, date: '2026-06-20' },
    { id: 'UNRATE', label: 'Unemployment', value: 4.1, date: '2026-06-20' },
    { id: 'CPIAUCSL', label: 'CPI', value: 314.2, date: '2026-06-20' },
    { id: 'ICSA', label: 'Jobless Claims', value: 228000, date: '2026-06-20' }
  ],
  energy: {
    wti: 73.85, brent: 77.20, natgas: 2.95,
    wtiRecent: [71.20, 72.40, 73.10, 72.80, 73.85],
    signals: ['WTI above 200-day MA', 'Brent-WTI spread widening']
  },
  bls: [
    { id: 'LNS14000000', label: 'Unemployment Rate', value: 4.1, momChange: 0.1 },
    { id: 'CUUR0000SA0', label: 'CPI-U', value: 314.2, momChangePct: 0.3 },
    { id: 'CES0000000001', label: 'Nonfarm Payrolls', momChange: 175000 }
  ],
  markets: {
    timestamp: new Date().toISOString(),
    vix: { value: 22.4, changePct: 3.2 },
    indexes: [
      { name: 'S&P 500', symbol: 'SPY', price: 542.30, changePct: -0.45, history: [{ close: 545 }, { close: 543 }, { close: 540 }, { close: 541 }, { close: 542.3 }] },
      { name: 'Nasdaq', symbol: 'QQQ', price: 468.75, changePct: -0.68 },
      { name: 'Dow Jones', symbol: 'DIA', price: 398.20, changePct: 0.12 },
      { name: 'Russell 2000', symbol: 'IWM', price: 204.50, changePct: -0.92 }
    ],
    crypto: [
      { name: 'Bitcoin', symbol: 'BTC', price: 104250, changePct: 2.8 },
      { name: 'Ethereum', symbol: 'ETH', price: 3920, changePct: 1.5 }
    ],
    rates: [
      { name: '10Y Treasury', symbol: 'TNX', price: 4.28, changePct: 0.5 },
      { name: '2Y Treasury', symbol: 'UST2Y', price: 4.46, changePct: -0.2 }
    ]
  },
  air: [
    { region: 'Europe', total: 8420, noCallsign: 312, highAlt: 2100, top: [['Germany', 1450], ['UK', 1280], ['France', 1100]] },
    { region: 'Middle East', total: 2840, noCallsign: 185, highAlt: 620, top: [['UAE', 780], ['Saudi Arabia', 620], ['Qatar', 340]] },
    { region: 'East Asia', total: 6200, noCallsign: 240, highAlt: 1800, top: [['China', 2400], ['Japan', 1600], ['South Korea', 800]] },
    { region: 'North America', total: 9100, noCallsign: 180, highAlt: 2400, top: [['USA', 6200], ['Canada', 1800], ['Mexico', 1100]] },
    { region: 'South Asia', total: 3200, noCallsign: 145, highAlt: 680, top: [['India', 2200], ['Pakistan', 450], ['Bangladesh', 250]] },
    { region: 'Southeast Asia', total: 2600, noCallsign: 110, highAlt: 520, top: [['Indonesia', 800], ['Thailand', 600], ['Vietnam', 450]] }
  ],
  thermal: [
    { region: 'Sudan / Horn of Africa', det: 2840, night: 420, hc: 890, fires: [
      { lat: 13.5, lon: 30.2, frp: 92.3 }, { lat: 15.2, lon: 32.5, frp: 68.1 }, { lat: 9.8, lon: 42.1, frp: 45.7 }
    ]},
    { region: 'Ukraine / Eastern Europe', det: 1620, night: 380, hc: 520, fires: [
      { lat: 48.5, lon: 37.8, frp: 120.5 }, { lat: 47.2, lon: 35.6, frp: 85.2 }, { lat: 49.8, lon: 36.4, frp: 72.8 }
    ]},
    { region: 'Amazon Basin', det: 3200, night: 180, hc: 640, fires: [
      { lat: -3.4, lon: -60.2, frp: 55.3 }, { lat: -8.2, lon: -63.5, frp: 42.1 }, { lat: -12.5, lon: -55.8, frp: 38.6 }
    ]},
    { region: 'Myanmar / Southeast Asia', det: 1850, night: 310, hc: 420, fires: [
      { lat: 19.8, lon: 96.2, frp: 78.4 }, { lat: 21.3, lon: 97.8, frp: 62.5 }
    ]},
    { region: 'Central Africa', det: 4100, night: 280, hc: 920, fires: [
      { lat: 4.5, lon: 18.6, frp: 35.2 }, { lat: 0.3, lon: 25.4, frp: 28.9 }
    ]}
  ],
  chokepoints: [
    { label: 'Strait of Hormuz', lat: 26.56, lon: 56.25, note: '20% of global oil transit' },
    { label: 'Strait of Malacca', lat: 2.5, lon: 101.8, note: '25% of global shipping' },
    { label: 'Suez Canal', lat: 30.46, lon: 32.34, note: '12% of global trade' },
    { label: 'Bab el-Mandeb', lat: 12.6, lon: 43.3, note: 'Red Sea access point' },
    { label: 'Panama Canal', lat: 9.08, lon: -79.68, note: '5% of global trade' },
    { label: 'Turkish Straits', lat: 41.1, lon: 29.0, note: 'Black Sea access' },
    { label: 'GIUK Gap', lat: 63.0, lon: -20.0, note: 'N. Atlantic naval chokepoint' },
    { label: 'Strait of Gibraltar', lat: 35.96, lon: -5.5, note: 'Mediterranean access' },
    { label: 'Cape of Good Hope', lat: -34.35, lon: 18.47, note: 'Alt route for Suez' },
    { label: 'Taiwan Strait', lat: 24.0, lon: 119.5, note: 'Strategic flashpoint' }
  ],
  nuke: [
    { site: 'Zaporizhzhia', lat: 47.51, lon: 34.59, anom: false, cpm: 33.2, n: 10 },
    { site: 'Chernobyl Exclusion', lat: 51.39, lon: 30.1, anom: false, cpm: 42.8, n: 8 },
    { site: 'Fukushima Region', lat: 37.42, lon: 141.03, anom: false, cpm: 28.5, n: 12 },
    { site: 'Sellafield', lat: 54.42, lon: -3.5, anom: false, cpm: 18.1, n: 6 },
    { site: 'Yongbyon', lat: 39.8, lon: 125.75, anom: true, cpm: 58.4, n: 4 },
    { site: 'Natanz', lat: 33.72, lon: 51.73, anom: false, cpm: 22.0, n: 5 }
  ],
  acled: {
    totalEvents: 3842,
    totalFatalities: 2190,
    byRegion: {
      'Sub-Saharan Africa': { count: 1450, fatalities: 820 },
      'Middle East': { count: 680, fatalities: 540 },
      'South Asia': { count: 420, fatalities: 310 },
      'Eastern Europe': { count: 380, fatalities: 280 },
      'Southeast Asia': { count: 250, fatalities: 120 },
      'Latin America': { count: 180, fatalities: 85 }
    },
    deadliestEvents: [
      { date: '2026-06-19', type: 'Battles', country: 'Sudan', location: 'El-Fasher', fatalities: 85, lat: 13.63, lon: 25.35 },
      { date: '2026-06-20', type: 'Explosions', country: 'Ukraine', location: 'Donetsk', fatalities: 42, lat: 48.0, lon: 37.8 },
      { date: '2026-06-18', type: 'Violence against civilians', country: 'Myanmar', location: 'Sagaing', fatalities: 38, lat: 21.88, lon: 95.97 },
      { date: '2026-06-20', type: 'Battles', country: 'Syria', location: 'Deir ez-Zor', fatalities: 28, lat: 35.33, lon: 40.14 },
      { date: '2026-06-17', type: 'Riots', country: 'Nigeria', location: 'Maiduguri', fatalities: 22, lat: 11.85, lon: 13.16 }
    ]
  },
  who: [
    { title: 'Mpox Clade Ib — Multi-Country Outbreak', date: '2026-06-20', summary: 'WHO monitoring spread across 14 countries with 2,400+ confirmed cases' },
    { title: 'Avian Influenza A(H5N1) — Mammalian Spillover', date: '2026-06-18', summary: 'New dairy herd infections detected in 3 US states' },
    { title: 'Cholera — Haiti', date: '2026-06-15', summary: 'Resurgence in Port-au-Prince with 850 new cases this week' }
  ],
  tg: {
    posts: 1240,
    urgent: [
      { channel: 'Intel Slava Z', text: 'BREAKING: Large-scale drone attack reported on energy infrastructure in southern Russia', date: '2026-06-22T08:30:00Z', views: 48000, urgentFlags: ['BREAKING', 'ENERGY'] },
      { channel: 'Conflict Monitor', text: 'FLASH: IDF confirms strikes on targets in southern Lebanon following rocket barrage', date: '2026-06-22T06:15:00Z', views: 32000, urgentFlags: ['FLASH', 'ESCALATION'] },
      { channel: 'OSINT Aggregator', text: 'Unusual naval activity detected near Taiwan Strait — 3 carrier groups repositioning', date: '2026-06-21T22:00:00Z', views: 28000, urgentFlags: ['MILITARY', 'NAVAL'] },
      { channel: 'Geo Intel', text: 'RSF forces advance on El-Fasher — humanitarian corridor under threat', date: '2026-06-21T14:20:00Z', views: 15000, urgentFlags: ['CONFLICT', 'HUMANITARIAN'] },
      { channel: 'Market Intel', text: 'Chinese PBoC signals unexpected rate cut amid property sector stress', date: '2026-06-21T10:00:00Z', views: 22000, urgentFlags: ['ECONOMIC', 'CHINA'] }
    ]
  },
  tSignals: [
    'Energy infrastructure targeting correlates with WTI spike above $73 — monitor Brent-WTI spread for supply disruption signals',
    'Yield curve inversion narrowing (10Y-2Y at -0.18) while VIX rises — historically precedes volatility regime shift',
    'Multi-theater conflict escalation: Sudan + Ukraine + Myanmar — defense sector rotation detected in ETF flows',
    'Taiwan Strait naval activity + semiconductor export data = supply chain risk for Q3 chip deliveries',
    'HY spread widening (3.82) with unemployment ticking up (4.1%) — credit stress indicators approaching 2024 levels',
    'Nuclear anomaly at Yongbyon + DPRK satellite launch window — geopolitical risk premium building in KRW pairs'
  ],
  newsFeed: [
    { headline: 'Oil Prices Jump as Drone Attacks Hit Russian Energy Sites', source: 'BBC', type: 'rss', timestamp: '2026-06-22T09:00:00Z', region: 'Russia', urgent: true },
    { headline: 'Federal Reserve Signals Patience on Rate Cuts Despite Cooling Inflation', source: 'NYT', type: 'rss', timestamp: '2026-06-22T07:30:00Z', region: 'United States' },
    { headline: 'Sudan Crisis: UN Warns of Famine as Fighting Reaches El-Fasher', source: 'Al Jazeera', type: 'rss', timestamp: '2026-06-22T06:45:00Z', region: 'Sudan', urgent: true },
    { headline: 'Taiwan Strait Tensions Rise as China Conducts Naval Exercises', source: 'GDELT', type: 'gdelt', timestamp: '2026-06-21T22:30:00Z', region: 'Taiwan' },
    { headline: 'European Natural Gas Prices Surge on Supply Concerns', source: 'DW', type: 'rss', timestamp: '2026-06-21T18:00:00Z', region: 'Europe' },
    { headline: 'Avian Flu Detected in New US Dairy Herds, WHO Monitoring', source: 'NPR', type: 'rss', timestamp: '2026-06-21T15:20:00Z', region: 'United States' },
    { headline: 'Myanmar Junta Launches Offensive in Sagaing Region', source: 'France24', type: 'rss', timestamp: '2026-06-21T12:00:00Z', region: 'Myanmar' },
    { headline: 'Bitcoin Breaks $104K as Institutional Inflows Accelerate', source: 'GDELT', type: 'gdelt', timestamp: '2026-06-21T10:15:00Z', region: 'Global' },
    { headline: 'Nigerian Security Forces Clash with Militants in Borno State', source: 'Africa News', type: 'rss', timestamp: '2026-06-21T08:30:00Z', region: 'Nigeria' },
    { headline: 'China Property Sector Shows Fresh Signs of Stress', source: 'Telegram', type: 'telegram', timestamp: '2026-06-21T06:00:00Z', region: 'China', urgent: true },
    { headline: 'Lebanon Border Tensions Escalate After Rocket Exchange', source: 'Al Jazeera', type: 'rss', timestamp: '2026-06-20T20:00:00Z', region: 'Lebanon' },
    { headline: 'OPEC+ Debates Production Cuts Amid Demand Uncertainty', source: 'BBC', type: 'rss', timestamp: '2026-06-20T14:00:00Z', region: 'Middle East' }
  ],
  news: [
    { title: 'Drone Attacks on Russian Energy Infrastructure', source: 'BBC', lat: 48.7, lon: 44.5, region: 'Russia' },
    { title: 'El-Fasher Humanitarian Crisis Deepens', source: 'Al Jazeera', lat: 13.63, lon: 25.35, region: 'Sudan' },
    { title: 'Taiwan Strait Naval Exercises', source: 'GDELT', lat: 24.0, lon: 119.5, region: 'Taiwan' },
    { title: 'Myanmar Sagaing Offensive', source: 'France24', lat: 21.88, lon: 95.97, region: 'Myanmar' },
    { title: 'Lebanon Border Escalation', source: 'Al Jazeera', lat: 33.27, lon: 35.2, region: 'Lebanon' },
    { title: 'Nigerian Security Operations', source: 'Africa News', lat: 11.85, lon: 13.16, region: 'Nigeria' }
  ],
  delta: {
    summary: { direction: 'risk-on', totalChanges: 14, criticalChanges: 4, signalBreakdown: { new: 3, escalated: 7, deescalated: 4 } },
    signals: {
      new: [
        { key: 'NAVAL_TAIWAN', label: 'Taiwan Strait naval buildup', reason: '3 carrier groups detected via ADS-B + satellite' },
        { key: 'YONGBYON_ANOM', label: 'Yongbyon nuclear anomaly', reason: 'CPM reading 58.4 — above baseline' },
        { key: 'PBOC_CUT', label: 'PBoC rate cut signal', reason: 'Unexpected monetary policy shift' }
      ],
      escalated: [
        { label: 'VIX', from: 20.1, to: 22.4, pctChange: 11.4, severity: 'high' },
        { label: 'HY Spread', from: 3.52, to: 3.82, pctChange: 8.5, severity: 'medium' },
        { label: 'Sudan Fatalities', from: 620, to: 820, pctChange: 32.3, severity: 'critical' },
        { label: 'WTI Crude', from: 71.20, to: 73.85, pctChange: 3.7, severity: 'medium' },
        { label: 'Thermal — Ukraine', from: 1200, to: 1620, pctChange: 35.0, severity: 'high' },
        { label: 'Telegram Urgent', from: 3, to: 5, pctChange: 66.7, severity: 'medium' },
        { label: 'Drone Activity', from: 12, to: 28, pctChange: 133.3, severity: 'high' }
      ],
      deescalated: [
        { label: 'USD Index', from: 104.2, to: 103.8, change: -0.38 },
        { label: 'Nat Gas', from: 3.15, to: 2.95, change: -0.20 },
        { label: 'Thermal — Amazon', from: 3800, to: 3200, change: -600 },
        { label: 'NOAA Alerts', from: 18, to: 12, change: -6 }
      ]
    }
  },
  space: {
    totalNewObjects: 18,
    militarySats: 512,
    constellations: { Starlink: 6840, OneWeb: 680 },
    militaryByCountry: { USA: 178, Russia: 156, China: 148, India: 18, France: 12 },
    iss: { altitude: 408 },
    stationPositions: [{ name: 'ISS', lat: 42.5, lon: -78.3 }]
  },
  sdr: {
    total: 5200,
    online: 4380,
    zones: [
      { region: 'Western Europe', count: 1420, receivers: [{ name: 'KiwiSDR-DE01', lat: 50.1, lon: 8.7 }] },
      { region: 'East Asia', count: 680, receivers: [{ name: 'KiwiSDR-JP01', lat: 35.7, lon: 139.7 }] },
      { region: 'North America', count: 920, receivers: [{ name: 'KiwiSDR-US01', lat: 40.7, lon: -74.0 }] }
    ]
  },
  gscpi: { value: 1.45, interpretation: 'Mild upward pressure' },
  treasury: { totalDebt: '35.2T' }
};


// ═══ INITIALIZATION ═══

document.addEventListener('DOMContentLoaded', () => {
  animateHeroCounters();
  setupScrollAnimations();
  loadDemoData();
});


// ═══ API CONNECTION ═══

async function connectAPI() {
  const url = document.getElementById('apiUrl').value.trim();
  if (!url) return;
  const dot = document.querySelector('.conn-dot');
  const status = document.getElementById('connStatus');

  dot.className = 'conn-dot';
  status.textContent = 'Connecting...';

  try {
    const base = url.replace(/\/+$/, '');
    const res = await fetch(base + '/api/data', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
    dot.classList.add('connected');
    status.textContent = `Connected to ${base}`;
    renderAll();
    connectSSE(base);
  } catch (err) {
    dot.classList.add('error');
    status.textContent = `Failed: ${err.message}`;
  }
}

function connectSSE(base) {
  try {
    const es = new EventSource(base + '/events');
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'update' && msg.data) {
          DATA = msg.data;
          renderAll();
        }
      } catch {}
    };
  } catch {}
}

function loadDemoData() {
  DATA = DEMO;
  const dot = document.querySelector('.conn-dot');
  const status = document.getElementById('connStatus');
  dot.className = 'conn-dot connected';
  status.textContent = 'Loaded demo data (27 simulated sources)';
  renderAll();
}


// ═══ RENDER ALL ═══

function renderAll() {
  if (!DATA) return;
  renderMeta();
  renderHealthGrid();
  renderKPIs();
  renderSignals();
  renderNewsFeed();
  renderDelta();

  // Map and charts need visible containers — defer slightly
  requestAnimationFrame(() => {
    renderMap();
    setTimeout(() => {
      renderCharts();
    }, 300);
  });
}


// ═══ META ═══

function renderMeta() {
  const m = DATA.meta || {};
  document.getElementById('sweepTime').textContent = m.timestamp
    ? `Sweep: ${new Date(m.timestamp).toLocaleTimeString()}`
    : '--';
  document.getElementById('sweepTime').className = 'tag live';

  const ok = m.sourcesOk || 0;
  const total = m.sourcesQueried || 0;
  const tag = document.getElementById('sourcesTag');
  tag.textContent = `${ok}/${total} Sources OK`;
  tag.className = ok === total ? 'tag live' : 'tag warn';

  const d = DATA.delta?.summary;
  const dtag = document.getElementById('directionTag');
  if (d) {
    const arrows = { 'risk-on': 'RISK-ON ▲', 'risk-off': 'RISK-OFF ▼', 'mixed': 'MIXED ◆' };
    dtag.textContent = `${arrows[d.direction] || d.direction} | ${d.totalChanges} changes`;
    dtag.className = d.direction === 'risk-on' ? 'tag danger' : d.direction === 'risk-off' ? 'tag live' : 'tag warn';
  } else {
    dtag.textContent = '--';
  }
}


// ═══ HEALTH GRID ═══

function renderHealthGrid() {
  const grid = document.getElementById('healthGrid');
  if (!DATA.health) return;
  grid.innerHTML = DATA.health.map(h =>
    `<div class="health-item ${h.err ? 'err' : 'ok'}">
      <span class="health-dot ${h.err ? 'err' : 'ok'}"></span>
      <span>${h.n}</span>
    </div>`
  ).join('');
}


// ═══ KPIs ═══

function renderKPIs() {
  const vix = DATA.fred?.find(f => f.id === 'VIXCLS');
  setKPI('kpiVix', vix?.value, vix?.momChangePct, { warn: 20, danger: 30 });

  setKPI('kpiWti', DATA.energy?.wti, null, null, '$');

  const spy = DATA.markets?.indexes?.find(i => i.symbol === 'SPY');
  setKPI('kpiSpy', spy?.price, spy?.changePct, null, '$');

  const btc = DATA.markets?.crypto?.find(c => c.symbol === 'BTC');
  setKPI('kpiBtc', btc?.price, btc?.changePct, null, '$');

  setKPI('kpiConflicts', DATA.acled?.totalEvents, null, { warn: 2000, danger: 4000 });
  const totalThermal = DATA.thermal?.reduce((s, t) => s + (t.det || 0), 0) || 0;
  setKPI('kpiThermal', totalThermal);
}

function setKPI(id, value, changePct, thresholds, prefix) {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl = el.querySelector('.kpi-value');
  if (value == null) { valEl.textContent = '--'; return; }

  let display = typeof value === 'number'
    ? (value >= 10000 ? `${prefix || ''}${(value / 1000).toFixed(1)}K` : `${prefix || ''}${value.toFixed(2)}`)
    : value;
  valEl.textContent = display;

  if (thresholds && typeof value === 'number') {
    if (value >= thresholds.danger) valEl.style.color = 'var(--red)';
    else if (value >= thresholds.warn) valEl.style.color = 'var(--orange)';
    else valEl.style.color = 'var(--accent)';
  }

  let changeEl = el.querySelector('.kpi-change');
  if (changePct != null) {
    if (!changeEl) {
      changeEl = document.createElement('div');
      changeEl.className = 'kpi-change';
      el.appendChild(changeEl);
    }
    const sign = changePct >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${changePct.toFixed(1)}%`;
    changeEl.className = `kpi-change ${changePct >= 0 ? 'up' : 'down'}`;
  }
}


// ═══ MAP ═══

function renderMap() {
  if (!map) {
    map = L.map('map', {
      center: [20, 20],
      zoom: 2,
      minZoom: 2,
      maxZoom: 10,
      zoomControl: true,
      attributionControl: false
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 500);

    layerGroups = {
      thermal: L.layerGroup().addTo(map),
      conflict: L.layerGroup().addTo(map),
      nuclear: L.layerGroup().addTo(map),
      air: L.layerGroup().addTo(map),
      maritime: L.layerGroup().addTo(map),
      news: L.layerGroup().addTo(map)
    };
  }

  Object.values(layerGroups).forEach(lg => lg.clearLayers());

  // Thermal detections
  if (DATA.thermal) {
    for (const t of DATA.thermal) {
      if (!t.fires) continue;
      for (const f of t.fires) {
        const radius = Math.max(4, Math.min(15, Math.sqrt(f.frp || 10) * 2));
        L.circleMarker([f.lat, f.lon], {
          radius, color: '#ff4444', fillColor: '#ff4444', fillOpacity: 0.6, weight: 1
        }).bindPopup(`<b>Thermal Detection</b><br>${t.region}<br>FRP: ${f.frp} MW`)
          .addTo(layerGroups.thermal);
      }
    }
  }

  // Conflict events
  if (DATA.acled?.deadliestEvents) {
    for (const ev of DATA.acled.deadliestEvents) {
      if (!ev.lat || !ev.lon) continue;
      const radius = Math.max(6, Math.min(20, Math.sqrt(ev.fatalities) * 2));
      L.circleMarker([ev.lat, ev.lon], {
        radius, color: '#ff8800', fillColor: '#ff8800', fillOpacity: 0.6, weight: 2
      }).bindPopup(`<b>${ev.type}</b><br>${ev.location}, ${ev.country}<br>Fatalities: ${ev.fatalities}<br>${ev.date}`)
        .addTo(layerGroups.conflict);
    }
  }

  // Nuclear sites
  if (DATA.nuke) {
    for (const n of DATA.nuke) {
      const color = n.anom ? '#ff4444' : '#ffdd00';
      L.circleMarker([n.lat, n.lon], {
        radius: n.anom ? 10 : 7, color, fillColor: color, fillOpacity: n.anom ? 0.8 : 0.5, weight: 2
      }).bindPopup(`<b>${n.site}</b><br>CPM: ${n.cpm}<br>Anomaly: ${n.anom ? 'YES' : 'No'}<br>Readings: ${n.n}`)
        .addTo(layerGroups.nuclear);
    }
  }

  // Air traffic hotspots
  if (DATA.air) {
    const hubs = [
      { name: 'London', lat: 51.47, lon: -0.46 }, { name: 'Dubai', lat: 25.25, lon: 55.36 },
      { name: 'Singapore', lat: 1.36, lon: 103.99 }, { name: 'New York', lat: 40.64, lon: -73.78 },
      { name: 'Tokyo', lat: 35.76, lon: 139.79 }, { name: 'Frankfurt', lat: 50.03, lon: 8.57 }
    ];
    for (const hub of hubs) {
      L.circleMarker([hub.lat, hub.lon], {
        radius: 6, color: '#44ff88', fillColor: '#44ff88', fillOpacity: 0.5, weight: 1
      }).bindPopup(`<b>${hub.name} Hub</b><br>Major air traffic node`)
        .addTo(layerGroups.air);
    }
  }

  // Maritime chokepoints
  if (DATA.chokepoints) {
    for (const cp of DATA.chokepoints) {
      L.circleMarker([cp.lat, cp.lon], {
        radius: 8, color: '#aa44ff', fillColor: '#aa44ff', fillOpacity: 0.5, weight: 2
      }).bindPopup(`<b>${cp.label}</b><br>${cp.note}`)
        .addTo(layerGroups.maritime);
    }
  }

  // News geolocations
  if (DATA.news) {
    for (const n of DATA.news) {
      if (!n.lat || !n.lon) continue;
      L.circleMarker([n.lat, n.lon], {
        radius: 5, color: '#44aaff', fillColor: '#44aaff', fillOpacity: 0.6, weight: 1
      }).bindPopup(`<b>${n.title}</b><br>Source: ${n.source}`)
        .addTo(layerGroups.news);
    }
  }
}

function toggleLayer(btn, layerName) {
  btn.classList.toggle('active');
  if (btn.classList.contains('active')) {
    map.addLayer(layerGroups[layerName]);
  } else {
    map.removeLayer(layerGroups[layerName]);
  }
}


// ═══ CHARTS ═══

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#c8d6e5', font: { family: "'JetBrains Mono', monospace", size: 11 } } }
  },
  scales: {
    x: { ticks: { color: '#6b7d95', font: { family: "'JetBrains Mono', monospace", size: 10 } }, grid: { color: 'rgba(30,45,66,0.5)' } },
    y: { ticks: { color: '#6b7d95', font: { family: "'JetBrains Mono', monospace", size: 10 } }, grid: { color: 'rgba(30,45,66,0.5)' } }
  }
};

function renderCharts() {
  renderVixChart();
  renderEnergyChart();
  renderMarketsChart();
  renderMacroChart();
}

function renderVixChart() {
  const vix = DATA.fred?.find(f => f.id === 'VIXCLS');
  if (!vix?.recent) return;
  if (charts.vix) charts.vix.destroy();

  const labels = vix.recent.map((_, i) => `Day ${i + 1}`);
  charts.vix = new Chart(document.getElementById('chartVix'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'VIX',
        data: vix.recent,
        borderColor: '#ff4757',
        backgroundColor: 'rgba(255,71,87,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#ff4757'
      }]
    },
    options: {
      ...chartDefaults,
      plugins: {
        ...chartDefaults.plugins,
        annotation: {
          annotations: {
            threshold: { type: 'line', yMin: 20, yMax: 20, borderColor: 'rgba(255,136,0,0.5)', borderDash: [5, 5], label: { content: 'Fear threshold', enabled: true } }
          }
        }
      }
    }
  });
}

function renderEnergyChart() {
  if (!DATA.energy?.wtiRecent) return;
  if (charts.energy) charts.energy.destroy();

  const labels = DATA.energy.wtiRecent.map((_, i) => `Day ${i + 1}`);
  charts.energy = new Chart(document.getElementById('chartEnergy'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'WTI ($)',
          data: DATA.energy.wtiRecent,
          backgroundColor: 'rgba(100,240,200,0.6)',
          borderColor: '#64f0c8',
          borderWidth: 1
        }
      ]
    },
    options: chartDefaults
  });
}

function renderMarketsChart() {
  const all = [
    ...(DATA.markets?.indexes || []),
    ...(DATA.markets?.crypto || [])
  ];
  if (!all.length) return;
  if (charts.markets) charts.markets.destroy();

  charts.markets = new Chart(document.getElementById('chartMarkets'), {
    type: 'bar',
    data: {
      labels: all.map(i => i.symbol || i.name),
      datasets: [{
        label: 'Change %',
        data: all.map(i => i.changePct || 0),
        backgroundColor: all.map(i => (i.changePct || 0) >= 0 ? 'rgba(68,255,136,0.6)' : 'rgba(255,71,87,0.6)'),
        borderColor: all.map(i => (i.changePct || 0) >= 0 ? '#44ff88' : '#ff4757'),
        borderWidth: 1
      }]
    },
    options: {
      ...chartDefaults,
      indexAxis: 'y',
      scales: {
        ...chartDefaults.scales,
        x: { ...chartDefaults.scales.x, suggestedMin: -3, suggestedMax: 3 }
      }
    }
  });
}

function renderMacroChart() {
  if (!DATA.fred?.length) return;
  if (charts.macro) charts.macro.destroy();

  const gauges = [
    { id: 'VIXCLS', label: 'VIX', max: 50 },
    { id: 'BAMLH0A0HYM2', label: 'HY Spread', max: 8 },
    { id: 'DFF', label: 'Fed Funds', max: 8 },
    { id: 'DTWEXBGS', label: 'USD Index', max: 120 },
    { id: 'UNRATE', label: 'Unemployment', max: 10 }
  ];

  const items = gauges.map(g => {
    const f = DATA.fred.find(x => x.id === g.id);
    return { label: g.label, value: f?.value || 0, max: g.max };
  });

  charts.macro = new Chart(document.getElementById('chartMacro'), {
    type: 'radar',
    data: {
      labels: items.map(i => i.label),
      datasets: [{
        label: 'Current',
        data: items.map(i => (i.value / i.max) * 100),
        borderColor: '#64f0c8',
        backgroundColor: 'rgba(100,240,200,0.15)',
        pointBackgroundColor: '#64f0c8',
        pointRadius: 4
      }]
    },
    options: {
      ...chartDefaults,
      scales: {
        r: {
          grid: { color: 'rgba(30,45,66,0.5)' },
          angleLines: { color: 'rgba(30,45,66,0.5)' },
          pointLabels: { color: '#c8d6e5', font: { family: "'JetBrains Mono', monospace", size: 10 } },
          ticks: { display: false },
          suggestedMin: 0,
          suggestedMax: 100
        }
      }
    }
  });
}


// ═══ SIGNALS ═══

function renderSignals() {
  const list = document.getElementById('signalsList');
  if (!DATA.tSignals?.length) {
    list.innerHTML = '<div class="signal-item" style="color:var(--text-dim)">No signals available</div>';
    return;
  }
  list.innerHTML = DATA.tSignals.map((s, i) =>
    `<div class="signal-item"><span class="signal-idx">SIG-${String(i + 1).padStart(2, '0')}</span>${s}</div>`
  ).join('');
}


// ═══ NEWS FEED ═══

function renderNewsFeed() {
  const feed = document.getElementById('newsFeed');
  if (!DATA.newsFeed?.length) {
    feed.innerHTML = '<div class="news-item" style="color:var(--text-dim)">No news available</div>';
    return;
  }

  feed.innerHTML = DATA.newsFeed.map(n => {
    const age = timeAgo(n.timestamp);
    const sourceColor = getSourceColor(n.source);
    return `<div class="news-item">
      <span class="news-source" style="color:${sourceColor};border:1px solid ${sourceColor}">${n.source}</span>
      <div>
        <div class="news-headline">${n.urgent ? '<strong>' : ''}${n.headline}${n.urgent ? '</strong>' : ''}</div>
        <div class="news-time">${age} · ${n.region || ''}</div>
      </div>
    </div>`;
  }).join('');
}

function getSourceColor(src) {
  const colors = {
    'BBC': '#ff4444', 'NYT': '#44aaff', 'Al Jazeera': '#ff8800', 'GDELT': '#aa44ff',
    'NPR': '#44ff88', 'DW': '#ffdd00', 'France24': '#4ecdc4', 'Africa News': '#ff6b9d',
    'Telegram': '#0088cc', 'Euronews': '#64f0c8'
  };
  return colors[src] || '#6b7d95';
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}


// ═══ DELTA ═══

function renderDelta() {
  const content = document.getElementById('deltaContent');
  const d = DATA.delta;
  if (!d?.summary) {
    content.innerHTML = '<div style="color:var(--text-dim)">No delta data</div>';
    return;
  }

  let html = '';
  const arrows = { 'risk-on': '▲ RISK-ON', 'risk-off': '▼ RISK-OFF', 'mixed': '◆ MIXED' };
  const dirColor = { 'risk-on': 'var(--red)', 'risk-off': 'var(--green)', 'mixed': 'var(--orange)' };

  html += `<div style="text-align:center;padding:0.75rem;margin-bottom:1rem;background:var(--bg);border-radius:4px;">
    <div style="font-family:var(--font-mono);font-size:1.2rem;font-weight:700;color:${dirColor[d.summary.direction]}">${arrows[d.summary.direction]}</div>
    <div style="font-size:0.7rem;color:var(--text-dim);margin-top:0.3rem">${d.summary.totalChanges} changes · ${d.summary.criticalChanges} critical</div>
  </div>`;

  if (d.signals?.new?.length) {
    for (const s of d.signals.new) {
      html += `<div class="delta-row"><span class="delta-badge new">NEW</span><span>${s.label}</span></div>`;
    }
  }
  if (d.signals?.escalated?.length) {
    for (const s of d.signals.escalated) {
      html += `<div class="delta-row"><span class="delta-badge up">▲ ${s.pctChange?.toFixed(0) || ''}%</span><span>${s.label}: ${s.from} → ${s.to}</span></div>`;
    }
  }
  if (d.signals?.deescalated?.length) {
    for (const s of d.signals.deescalated) {
      html += `<div class="delta-row"><span class="delta-badge down">▼</span><span>${s.label}: ${s.change}</span></div>`;
    }
  }

  content.innerHTML = html;
}


// ═══ HERO COUNTER ANIMATION ═══

function animateHeroCounters() {
  const counters = document.querySelectorAll('.stat-num[data-target]');
  counters.forEach(el => {
    const target = parseInt(el.dataset.target);
    let current = 0;
    const step = Math.max(1, Math.floor(target / 40));
    const interval = setInterval(() => {
      current += step;
      if (current >= target) {
        current = target;
        clearInterval(interval);
      }
      el.textContent = current;
    }, 40);
  });
}


// ═══ SCROLL ANIMATIONS ═══

let chartsRenderedOnVisible = false;

function setupScrollAnimations() {
  const sections = document.querySelectorAll('.section');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        if ((entry.target.id === 'charts' || entry.target.id === 'mapSection') && DATA && !chartsRenderedOnVisible) {
          chartsRenderedOnVisible = true;
          setTimeout(() => { renderCharts(); renderMap(); }, 200);
        }
      }
    });
  }, { threshold: 0.05 });

  sections.forEach(s => {
    s.style.opacity = '0';
    s.style.transform = 'translateY(30px)';
    s.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(s);
  });
}


// ═══ UTILITIES ═══

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

// Expose to global for onclick handlers
window.connectAPI = connectAPI;
window.loadDemoData = loadDemoData;
window.toggleLayer = toggleLayer;
window.scrollToSection = scrollToSection;
