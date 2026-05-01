// CISA Known Exploited Vulnerabilities (KEV) Catalog
// Public feed — no API key required
// Tracks vulnerabilities actively exploited in the wild, mandated for US federal patching

import { safeFetch } from '../utils/fetch.mjs';

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

export async function briefing() {
  const data = await safeFetch(KEV_URL, { timeout: 15000 });

  if (!data?.vulnerabilities) {
    return { error: 'No KEV data returned', totalCount: 0, recent: [], signals: [] };
  }

  const vulns = data.vulnerabilities || [];

  const sorted = [...vulns].sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

  const recent = sorted.slice(0, 15).map(v => ({
    cveID: v.cveID,
    vendorProject: v.vendorProject,
    product: v.product,
    vulnerabilityName: v.vulnerabilityName,
    dateAdded: v.dateAdded,
    shortDescription: (v.shortDescription || '').substring(0, 160),
    requiredAction: (v.requiredAction || '').substring(0, 120),
    dueDate: v.dueDate,
  }));

  const signals = recent.slice(0, 3).map(v =>
    `CISA KEV: ${v.vendorProject} ${v.product} — ${v.vulnerabilityName} added ${v.dateAdded}`
  );

  return {
    totalCount: vulns.length,
    catalogVersion: data.catalogVersion,
    dateReleased: data.dateReleased,
    recent,
    signals,
  };
}
