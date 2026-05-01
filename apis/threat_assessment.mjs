// LLM Narrative Summarisation
// Generates structured threat assessments using configured LLM provider

import { createLLMProvider } from '../lib/llm/index.mjs';

const SYSTEM_PROMPT = `You are a senior intelligence analyst at a UK-focused open source intelligence (OSINT) cell. Your job is to read clustered narrative data drawn from state-aligned media (Russian, Chinese, Iranian) and amplifier networks, and produce a tight threat assessment for a UK government audience.

ANALYTIC STANDARDS:
- Use ICD 203 standards: distinguish what is observed vs. what is inferred
- Use estimative language ("likely", "highly likely", "almost certainly")
- Flag low-confidence claims explicitly
- Never invent narratives that are not in the source data
- Note when narratives appear to be coordinated across multiple actors
- Identify specific UK targets (institutions, persons, policies) where present

OUTPUT FORMAT - return ONLY valid JSON, no preamble or markdown:
{
  "headline_assessment": "One-sentence top-line judgement (max 200 chars)",
  "confidence": "high | medium | low",
  "primary_narratives": [
    {
      "claim": "concise statement of the narrative being pushed",
      "actors_pushing": ["russia", "china", "iran"],
      "amplification_score": 1,
      "uk_target": "institution/person being targeted",
      "assessment": "1-2 sentences on significance"
    }
  ],
  "coordination_indicators": ["specific observable patterns suggesting coordinated activity"],
  "intent_assessment": "What the originating actors appear to be trying to achieve",
  "recommended_priorities": ["what a UK analyst should track or escalate"],
  "data_gaps": ["what is missing that would strengthen this assessment"]
}`;

export async function generateThreatAssessment(sweepData, llmConfig) {
  const llm = createLLMProvider(llmConfig);
  if (!llm || !llm.isConfigured) {
    return {
      error: 'LLM not configured',
      headline_assessment: 'LLM disabled - set LLM_PROVIDER and LLM_API_KEY in env',
      confidence: 'low'
    };
  }

  if (!sweepData || sweepData.error) {
    return {
      error: 'No sweep data available',
      headline_assessment: 'No data - sweep failed or pending',
      confidence: 'low'
    };
  }

  const userMessage = buildAnalystBriefing(sweepData);

  try {
    const response = await llm.complete(SYSTEM_PROMPT, userMessage, {
      maxTokens: 2000,
      timeout: 90000
    });

    const assessment = parseStructuredResponse(response.text);
    return {
      ...assessment,
      generated_at: new Date().toISOString(),
      model: response.model,
      tokens: response.usage,
      data_window: sweepData.timespan,
      articles_analysed: sweepData.summary?.total_articles || 0
    };
  } catch (err) {
    console.error('[LLM Assessment] Generation failed:', err.message);
    return {
      error: err.message,
      headline_assessment: `Assessment generation failed: ${err.message}`,
      confidence: 'low',
      generated_at: new Date().toISOString()
    };
  }
}

function buildAnalystBriefing(sweepData) {
  const lines = [];
  lines.push('# UK-FOCUSED IO SWEEP - EVIDENCE PACK');
  lines.push(`Sweep window: ${sweepData.timespan || 'unknown'}`);
  lines.push(`Total articles: ${sweepData.summary?.total_articles || 0}`);
  lines.push(`Generated: ${sweepData.timestamp}`);
  lines.push('');

  if (sweepData.by_actor) {
    lines.push('## VOLUME BY ACTOR');
    for (const [actor, data] of Object.entries(sweepData.by_actor)) {
      if (data.count > 0) {
        lines.push(`- ${actor.toUpperCase()}: ${data.count} articles, avg tone ${data.avg_tone}`);
      }
    }
    lines.push('');
  }

  const clusters = sweepData.narrative_clusters || [];
  if (clusters.length > 0) {
    lines.push('## CLUSTERED NARRATIVES (top 10)');
    clusters.slice(0, 10).forEach((c, i) => {
      lines.push(`\n### Cluster ${i + 1} - ${c.coordination_indicator.toUpperCase()}`);
      lines.push(`Representative title: "${c.representative_title}"`);
      lines.push(`Cluster size: ${c.cluster_size} articles`);
      lines.push(`Actors involved: ${c.actors.join(', ') || 'unattributed'}`);
      lines.push(`Distinct domains: ${c.domain_count}`);
      lines.push(`Sample headlines:`);
      c.members.slice(0, 5).forEach(m => {
        lines.push(`  - [${m.actor || '-'}] [${m.domain || '-'}] ${m.title}`);
      });
    });
    lines.push('');
  } else {
    lines.push('## RAW ARTICLES (clustering unavailable, top 20)');
    (sweepData.articles || []).slice(0, 20).forEach(a => {
      lines.push(`- [${a.actor || '-'}] [${a.domain || '-'}] tone=${a.tone?.toFixed(1) ?? '-'} :: ${a.title}`);
    });
    lines.push('');
  }

  const topNarratives = sweepData.top_narratives || [];
  if (topNarratives.length > 0) {
    lines.push('## DOMINANT NARRATIVES (LLM-extracted)');
    topNarratives.forEach((n, i) => {
      lines.push(`${i + 1}. "${n.claim}" — mentions: ${n.mentions}, confidence: ${n.confidence}`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('Produce your structured threat assessment now. Return JSON only.');
  return lines.join('\n');
}

function parseStructuredResponse(text) {
  if (!text || typeof text !== 'string') {
    return { error: 'Empty LLM response', confidence: 'low' };
  }

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (err) {
      return {
        error: `JSON parse failed: ${err.message}`,
        raw_text: cleaned.slice(0, 500),
        confidence: 'low'
      };
    }
  }

  return {
    error: 'No JSON object found in LLM response',
    raw_text: cleaned.slice(0, 500),
    confidence: 'low'
  };
}
