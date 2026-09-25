/**
 * Rapport de comparaison — PUR. Protocole : docs/ops/comparaison-modeles-scoring.md §4.
 *
 * ⚠️ AUCUN NOM, AUCUN CONTENU DE CV : identifiants et chiffres seulement. Les
 * entrées de ce module ne portent ni citation ni justification (les
 * `CvComparison` n'en ont pas) — la garantie est structurelle, pas une
 * question de soin au moment d'écrire.
 */
import {
  aggregate,
  pairArms,
  proposeVerdict,
  rankDisagreements,
  SEVERITY_LABEL,
  ZONE_BUCKETS,
  type Aggregate,
  type CvComparison,
  type ProposedVerdict,
} from './compare';
import type { ArmRecord, ZoneBucket } from './types';

export type ArmSummary = {
  arm: string;
  provider: string;
  requestedModel: string;
  baseUrl: string | null;
  returnedModels: string[];
  analysed: number;
  failed: number;
  failuresByKind: Record<string, number>;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  meanSeconds: number;
  /** Phases dégradées (échec de sortie après réessais), par phase. */
  degraded: Record<string, number>;
};

export function summarizeArm(
  arm: string,
  meta: { provider: string; requestedModel: string; baseUrl: string | null },
  records: ArmRecord[],
): ArmSummary {
  const ok = records.filter((r) => r.ok);
  const failed = records.filter((r) => !r.ok);
  const failuresByKind: Record<string, number> = {};
  for (const f of failed) if (!f.ok) failuresByKind[f.kind] = (failuresByKind[f.kind] ?? 0) + 1;
  const models = new Set<string>();
  for (const r of ok) if (r.ok) r.models.forEach((m) => models.add(m));
  const sum = (f: (r: Extract<ArmRecord, { ok: true }>) => number) =>
    ok.reduce((a, r) => a + (r.ok ? f(r) : 0), 0);
  const degraded: Record<string, number> = {};
  for (const r of ok) if (r.ok) for (const p of r.degradedPhases ?? []) degraded[p] = (degraded[p] ?? 0) + 1;
  return {
    arm,
    ...meta,
    degraded,
    returnedModels: [...models].sort(),
    analysed: ok.length,
    failed: failed.length,
    failuresByKind,
    costUsd: sum((r) => r.costUsd),
    promptTokens: sum((r) => r.promptTokens),
    completionTokens: sum((r) => r.completionTokens),
    meanSeconds: ok.length === 0 ? 0 : sum((r) => r.durationMs) / ok.length / 1000,
  };
}

export type ComparisonOutcome = {
  candidate: { pairs: CvComparison[]; agg: Aggregate; refFailed: string[]; otherFailed: string[]; missing: string[] };
  noise: { pairs: CvComparison[]; agg: Aggregate } | null;
  noiseFloor: number | null;
  verdict: ProposedVerdict;
};

export function computeOutcome(reference: ArmRecord[], candidate: ArmRecord[], noise: ArmRecord[] | null): ComparisonOutcome {
  const c = pairArms(reference, candidate);
  const n = noise ? pairArms(reference, noise) : null;
  const noiseAgg = n && n.pairs.length > 0 ? aggregate(n.pairs) : null;
  const noiseFloor = noiseAgg ? noiseAgg.meanAbsDelta : null;
  const agg = aggregate(c.pairs);
  return {
    candidate: { pairs: c.pairs, agg, refFailed: c.refFailed, otherFailed: c.otherFailed, missing: c.missing },
    noise: n && noiseAgg ? { pairs: n.pairs, agg: noiseAgg } : null,
    noiseFloor,
    verdict: proposeVerdict(agg, noiseFloor, c.otherFailed.length),
  };
}

// ─── Rendu ──────────────────────────────────────────────────────────────────

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const usd = (x: number) => `${x.toFixed(3)} $`;
const ZONE_FR: Record<ZoneBucket, string> = { accept: 'accepté', gray: 'à décider', reject: 'refus proposé' };

function confusionTable(agg: Aggregate, refLabel: string, otherLabel: string): string {
  const head = `| ${refLabel} ↓ / ${otherLabel} → | ${ZONE_BUCKETS.map((z) => ZONE_FR[z]).join(' | ')} |`;
  const sep = `|---|${ZONE_BUCKETS.map(() => '---:').join('|')}|`;
  const rows = ZONE_BUCKETS.map((a) => `| **${ZONE_FR[a]}** | ${ZONE_BUCKETS.map((b) => agg.confusion[a][b]).join(' | ')} |`);
  return [head, sep, ...rows].join('\n');
}

function aggLines(agg: Aggregate): string[] {
  return [
    `- CV comparés : **${agg.n}**`,
    `- Δscore : moyenne ${agg.meanDelta.toFixed(1)}, moyenne absolue **${agg.meanAbsDelta.toFixed(1)}**, écart-type ${agg.stdDelta.toFixed(1)}`,
    `- Accord de zone : **${pct(agg.zoneAgreement)}** · basculements accepté ↔ refus : **${agg.flips}**`,
    `- Accord des verdicts par critère : ${pct(agg.criteriaAgreement)}`,
    `- « Non vérifiable » devenu « non » : **${agg.nonVerifiableToNon}**`,
    `- Accord sur les rédhibitoires : ${pct(agg.knockoutAgreement)}`,
    `- Citations introuvables : ${agg.quotesInvalid} / ${agg.quotesChecked} (${pct(agg.quotesInvalidRate)})`,
  ];
}

export type ReportInput = {
  generatedAt: string;
  projectRef: string;
  sample: { eligible: number; selected: number; excluded: Record<string, number>; sentinelsRequested: number; sentinelsFound: number };
  arms: ArmSummary[];
  outcome: ComparisonOutcome;
  candidateLabel: string;
};

export function renderReport(input: ReportInput): string {
  const { outcome: o } = input;
  const L: string[] = [];
  L.push(`# Comparaison de modèles — analyse des CV`, '');
  L.push(`Généré le ${input.generatedAt} · base \`${input.projectRef}\` · protocole : \`docs/ops/comparaison-modeles-scoring.md\``, '');
  L.push(`> Identifiants et chiffres seulement : aucun nom, aucun contenu de CV. Les citations et justifications, pour la relecture à la main, sont dans \`details.json\` (même répertoire, **données personnelles**).`, '');

  L.push(`## Verdict proposé : **${o.verdict.acceptable ? 'ACCEPTABLE' : 'REFUSÉ'}** — ${input.candidateLabel}`, '');
  for (const c of o.verdict.checks) L.push(`- ${c.passed ? '✅' : '❌'} (${c.id}) ${c.detail}`);
  L.push('', `_Une proposition : la décision se prend sur la liste des désaccords ci-dessous._`, '');

  L.push(`## Échantillon`, '');
  L.push(`- Analyses éligibles (CV d'origine disponible, fiche de scoring présente) : ${input.sample.eligible}`);
  L.push(`- Sélectionnées : **${input.sample.selected}**`);
  for (const [why, n] of Object.entries(input.sample.excluded)) L.push(`- Écartées — ${why} : ${n}`);
  L.push(`- Cas sentinelles demandés : ${input.sample.sentinelsRequested}, trouvés dans cette base : ${input.sample.sentinelsFound}`, '');

  L.push(`## Bras`, '');
  L.push(`| bras | fournisseur | modèle demandé | modèle(s) renvoyé(s) | analysés | échecs | phases dégradées | coût | jetons entrée / sortie | s / CV |`);
  L.push(`|---|---|---|---|---:|---:|---|---:|---:|---:|`);
  for (const a of input.arms) {
    const fails = a.failed === 0 ? '0' : `${a.failed} (${Object.entries(a.failuresByKind).map(([k, n]) => `${k} ${n}`).join(', ')})`;
    L.push(`| ${a.arm} | ${a.provider}${a.baseUrl ? ` (${a.baseUrl})` : ''} | ${a.requestedModel} | ${a.returnedModels.join(', ') || '—'} | ${a.analysed} | ${fails} | ${Object.entries(a.degraded).map(([k, n]) => `${k} ${n}`).join(', ') || '—'} | ${usd(a.costUsd)} | ${a.promptTokens} / ${a.completionTokens} | ${a.meanSeconds.toFixed(1)} |`);
  }
  const perCv = input.arms.map((a) => `${a.arm} ${a.analysed ? usd(a.costUsd / a.analysed) : '—'}`).join(' · ');
  L.push('', `Coût par CV : ${perCv}`, '');

  L.push(`## Plancher de bruit (gpt-4o rejoué contre lui-même)`, '');
  if (o.noise) {
    L.push(...aggLines(o.noise.agg), '');
    L.push(confusionTable(o.noise.agg, 'référence', 'second rejeu'), '');
  } else {
    L.push(`Aucun : le bras de bruit n'a rien donné de comparable. Le critère (b) ne peut pas passer.`, '');
  }

  L.push(`## ${input.candidateLabel} contre la référence`, '');
  L.push(...aggLines(o.candidate.agg), '');
  L.push(confusionTable(o.candidate.agg, 'référence', 'candidat'), '');
  if (o.candidate.refFailed.length || o.candidate.otherFailed.length || o.candidate.missing.length) {
    L.push(`Non comparés : référence en échec ${o.candidate.refFailed.length}, candidat en échec ${o.candidate.otherFailed.length}, absents ${o.candidate.missing.length}.`);
    for (const id of o.candidate.otherFailed) L.push(`- candidat en échec : \`${id}\``);
    L.push('');
  }

  const ranked = rankDisagreements(o.candidate.pairs);
  L.push(`## Désaccords, par gravité (${ranked.length})`, '');
  if (ranked.length === 0) L.push(`Aucun.`, '');
  let current = 0;
  for (const d of ranked) {
    if (d.severity !== current) {
      current = d.severity;
      L.push(`### ${current}. ${SEVERITY_LABEL[d.severity]}`, '');
    }
    L.push(
      `- \`${d.analysisId}\` (${d.campaignId}) — score ${d.refScore} → ${d.otherScore} (${d.deltaScore >= 0 ? '+' : ''}${d.deltaScore}), ` +
        `zone ${ZONE_FR[d.refZone]} → ${ZONE_FR[d.otherZone]}` +
        (d.nonVerifiableToNon ? `, ${d.nonVerifiableToNon} « non vérifiable » → « non »` : '') +
        (d.quotesInvalid ? `, ${d.quotesInvalid} citation(s) introuvable(s)` : '') +
        (d.knockoutsAgree ? '' : ', rédhibitoires en désaccord'),
    );
    for (const c of d.disagreeingCriteria) L.push(`  - ${c.label} : référence **${c.ref}** · candidat **${c.other}**`);
  }
  L.push('');
  return L.join('\n');
}

const CSV_HEADER = [
  'analysis_id', 'campaign_id', 'ref_score', 'cand_score', 'delta', 'ref_zone', 'cand_zone', 'zone_same', 'flip',
  'criteria_compared', 'criteria_agreeing', 'nv_to_non', 'knockouts_agree', 'quotes_checked', 'quotes_invalid',
  'ref_cost_usd', 'cand_cost_usd', 'ref_seconds', 'cand_seconds', 'cand_models',
];

/** Une ligne par CV comparé : identifiants et chiffres, jamais un nom ni une citation. */
export function renderCsv(pairs: CvComparison[], reference: ArmRecord[], candidate: ArmRecord[]): string {
  const ref = new Map(reference.map((r) => [r.analysisId, r]));
  const cand = new Map(candidate.map((r) => [r.analysisId, r]));
  const cost = (r: ArmRecord | undefined) => (r && r.ok ? r.costUsd.toFixed(5) : '');
  const secs = (r: ArmRecord | undefined) => (r ? (r.durationMs / 1000).toFixed(1) : '');
  const rows = pairs.map((p) => {
    const r = ref.get(p.analysisId);
    const c = cand.get(p.analysisId);
    return [p.analysisId, p.campaignId, p.refScore, p.otherScore, p.deltaScore, p.refZone, p.otherZone, p.zoneSame, p.flip,
      p.criteriaCompared, p.criteriaAgreeing, p.nonVerifiableToNon, p.knockoutsAgree, p.quotesChecked, p.quotesInvalid,
      cost(r), cost(c), secs(r), secs(c), c && c.ok ? [...new Set(c.models)].join(' ') : ''].join(',');
  });
  return [CSV_HEADER.join(','), ...rows].join('\n') + '\n';
}
