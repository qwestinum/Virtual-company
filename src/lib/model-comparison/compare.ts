/**
 * Comparaison de deux bras — PUR. Protocole : docs/ops/comparaison-modeles-scoring.md §3-4.
 *
 * On compare des DÉCISIONS, pas seulement des scores : un écart de 4 points
 * qui fait passer un dossier de « accepté » à « refus proposé » compte plus
 * qu'un écart de 15 points qui reste dans la même zone.
 */
import type { DecisionZone } from '@/types/hitl';

import type { ArmRecord, ArmSuccess, ArmVerdict, ZoneBucket } from './types';

// ─── Zones ──────────────────────────────────────────────────────────────────

export function zoneBucket(zone: DecisionZone): ZoneBucket {
  if (zone === 'auto_accept') return 'accept';
  if (zone === 'gray') return 'gray';
  return 'reject'; // proposed_reject + auto_reject (legacy, même bande de score)
}

export const ZONE_BUCKETS: readonly ZoneBucket[] = ['accept', 'gray', 'reject'];

/** Accepté ↔ refus : l'échec bloquant à lui seul. */
export function isFlip(a: ZoneBucket, b: ZoneBucket): boolean {
  return (a === 'accept' && b === 'reject') || (a === 'reject' && b === 'accept');
}

// ─── Citations ──────────────────────────────────────────────────────────────

/**
 * La règle du PRODUIT (« aucun oui sans preuve »), réexportée : le rapport
 * mesure exactement ce que la garde de l'analyse applique.
 */
export { normalizeForQuote, quoteFoundInCv } from '@/lib/scoring/quote-evidence';

/**
 * Preuves d'un bras sur un CV : verdicts POSITIFS rendus par le modèle
 * (satisfait/partiel, AVANT la garde) et, parmi eux, ceux dont la citation ne
 * tenait pas. Depuis la garde, c'est `evidenceDowngrade` qui le dit ; pour un
 * enregistrement antérieur, une citation introuvable sur un verdict positif.
 */
export function evidenceOf(verdicts: ArmVerdict[]): { positives: number; unproven: number } {
  let positives = 0;
  let unproven = 0;
  for (const v of verdicts) {
    if (v.evidenceDowngrade) {
      positives += 1;
      unproven += 1;
    } else if (v.decision === 'satisfait' || v.decision === 'partiel') {
      positives += 1;
      if (v.quoteFound !== true) unproven += 1;
    }
  }
  return { positives, unproven };
}

// ─── Comparaison d'un CV ────────────────────────────────────────────────────

export type CvComparison = {
  analysisId: string;
  campaignId: string;
  refScore: number;
  otherScore: number;
  deltaScore: number;
  refZone: ZoneBucket;
  otherZone: ZoneBucket;
  zoneSame: boolean;
  flip: boolean;
  criteriaCompared: number;
  criteriaAgreeing: number;
  /** Critères `non_verifiable` chez la référence devenus `non` : régression interdite. */
  nonVerifiableToNon: number;
  knockoutsAgree: boolean;
  quotesChecked: number;
  quotesInvalid: number;
  /** Verdicts positifs rendus / sans preuve tenable — référence et autre bras. */
  refPositives: number;
  refUnproven: number;
  otherPositives: number;
  otherUnproven: number;
  /** Critères en désaccord, pour la relecture. */
  disagreeingCriteria: { criterionId: string; label: string; ref: ArmVerdict['decision']; other: ArmVerdict['decision'] }[];
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export function compareCv(ref: ArmSuccess, other: ArmSuccess): CvComparison {
  const otherById = new Map(other.verdicts.map((v) => [v.criterionId, v]));
  let compared = 0;
  let agreeing = 0;
  let nvToNon = 0;
  const disagreeing: CvComparison['disagreeingCriteria'] = [];
  for (const r of ref.verdicts) {
    const o = otherById.get(r.criterionId);
    if (!o) continue;
    compared += 1;
    if (r.decision === o.decision) agreeing += 1;
    else disagreeing.push({ criterionId: r.criterionId, label: r.label, ref: r.decision, other: o.decision });
    if (r.decision === 'non_verifiable' && o.decision === 'non') nvToNon += 1;
  }
  const checked = other.verdicts.filter((v) => v.quoteFound !== null);
  const refEvidence = evidenceOf(ref.verdicts);
  const otherEvidence = evidenceOf(other.verdicts);
  const refZone = zoneBucket(ref.zone);
  const otherZone = zoneBucket(other.zone);
  return {
    analysisId: ref.analysisId,
    campaignId: ref.campaignId,
    refScore: ref.score,
    otherScore: other.score,
    deltaScore: other.score - ref.score,
    refZone,
    otherZone,
    zoneSame: refZone === otherZone,
    flip: isFlip(refZone, otherZone),
    criteriaCompared: compared,
    criteriaAgreeing: agreeing,
    nonVerifiableToNon: nvToNon,
    knockoutsAgree: sameSet(ref.knockoutsFailed, other.knockoutsFailed),
    quotesChecked: checked.length,
    quotesInvalid: checked.filter((v) => v.quoteFound === false).length,
    refPositives: refEvidence.positives,
    refUnproven: refEvidence.unproven,
    otherPositives: otherEvidence.positives,
    otherUnproven: otherEvidence.unproven,
    disagreeingCriteria: disagreeing,
  };
}

/** Apparie deux bras par identifiant d'analyse ; les échecs sont rendus à part, jamais comparés. */
export function pairArms(ref: ArmRecord[], other: ArmRecord[]): {
  pairs: CvComparison[];
  refFailed: string[];
  otherFailed: string[];
  missing: string[];
} {
  const otherById = new Map(other.map((r) => [r.analysisId, r]));
  const pairs: CvComparison[] = [];
  const refFailed: string[] = [];
  const otherFailed: string[] = [];
  const missing: string[] = [];
  for (const r of ref) {
    const o = otherById.get(r.analysisId);
    if (!r.ok) {
      refFailed.push(r.analysisId);
      continue;
    }
    if (!o) {
      missing.push(r.analysisId);
      continue;
    }
    if (!o.ok) {
      otherFailed.push(r.analysisId);
      continue;
    }
    pairs.push(compareCv(r, o));
  }
  return { pairs, refFailed, otherFailed, missing };
}

// ─── Agrégats ───────────────────────────────────────────────────────────────

export type Aggregate = {
  n: number;
  meanAbsDelta: number;
  meanDelta: number;
  stdDelta: number;
  zoneAgreement: number;
  flips: number;
  confusion: Record<ZoneBucket, Record<ZoneBucket, number>>;
  criteriaAgreement: number;
  nonVerifiableToNon: number;
  knockoutAgreement: number;
  quotesChecked: number;
  quotesInvalid: number;
  quotesInvalidRate: number;
  /** Part des verdicts positifs sans preuve tenable (avant la garde), par bras. */
  refUnprovenRate: number;
  otherUnprovenRate: number;
  refUnproven: number;
  refPositives: number;
  otherUnproven: number;
  otherPositives: number;
};

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function aggregate(pairs: CvComparison[]): Aggregate {
  const deltas = pairs.map((p) => p.deltaScore);
  const m = mean(deltas);
  const confusion = Object.fromEntries(
    ZONE_BUCKETS.map((a) => [a, Object.fromEntries(ZONE_BUCKETS.map((b) => [b, 0]))]),
  ) as Aggregate['confusion'];
  for (const p of pairs) confusion[p.refZone][p.otherZone] += 1;
  const compared = pairs.reduce((a, p) => a + p.criteriaCompared, 0);
  const agreeing = pairs.reduce((a, p) => a + p.criteriaAgreeing, 0);
  const quotesChecked = pairs.reduce((a, p) => a + p.quotesChecked, 0);
  const quotesInvalid = pairs.reduce((a, p) => a + p.quotesInvalid, 0);
  const sum = (f: (p: CvComparison) => number) => pairs.reduce((a, p) => a + f(p), 0);
  const refPositives = sum((p) => p.refPositives);
  const otherPositives = sum((p) => p.otherPositives);
  const refUnproven = sum((p) => p.refUnproven);
  const otherUnproven = sum((p) => p.otherUnproven);
  return {
    refPositives,
    otherPositives,
    refUnproven,
    otherUnproven,
    refUnprovenRate: refPositives === 0 ? 0 : refUnproven / refPositives,
    otherUnprovenRate: otherPositives === 0 ? 0 : otherUnproven / otherPositives,
    n: pairs.length,
    meanAbsDelta: mean(deltas.map(Math.abs)),
    meanDelta: m,
    stdDelta: Math.sqrt(mean(deltas.map((d) => (d - m) ** 2))),
    zoneAgreement: pairs.length === 0 ? 0 : pairs.filter((p) => p.zoneSame).length / pairs.length,
    flips: pairs.filter((p) => p.flip).length,
    confusion,
    criteriaAgreement: compared === 0 ? 0 : agreeing / compared,
    nonVerifiableToNon: pairs.reduce((a, p) => a + p.nonVerifiableToNon, 0),
    knockoutAgreement: pairs.length === 0 ? 0 : pairs.filter((p) => p.knockoutsAgree).length / pairs.length,
    quotesChecked,
    quotesInvalid,
    quotesInvalidRate: quotesChecked === 0 ? 0 : quotesInvalid / quotesChecked,
  };
}

// ─── Verdict proposé (§4) ───────────────────────────────────────────────────

export const RULES = {
  zoneAgreementMin: 0.95,
  deltaMarginOverNoise: 3,
  knockoutAgreementMin: 1,
  /** (e) redéfini le 25/09/2026 : pas plus de 2 points au-dessus de la RÉFÉRENCE. */
  unprovenMarginOverReference: 0.02,
} as const;

export type ProposedVerdict = {
  acceptable: boolean;
  /**
   * Critère par critère, dans l'ordre (a)…(e) du protocole : passé ou non, et
   * pourquoi. (f) n'apparaît que s'il y a des analyses en échec chez le modèle
   * candidat : elles ne sont pas comparées, donc elles ne peuvent pas passer.
   */
  checks: { id: 'a' | 'b' | 'c' | 'd' | 'e' | 'f'; passed: boolean; detail: string }[];
};

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

/**
 * La règle du protocole. `noiseFloor` = écart moyen absolu gpt-4o vs gpt-4o ;
 * `null` si le bras de bruit n'a rien donné — (b) échoue alors : sans plancher,
 * on ne peut pas dire qu'un écart n'est pas significatif.
 */
export function proposeVerdict(candidate: Aggregate, noiseFloor: number | null, candidateFailures: number): ProposedVerdict {
  const checks: ProposedVerdict['checks'] = [];
  checks.push({
    id: 'a',
    passed: candidate.flips === 0,
    detail: `${candidate.flips} basculement(s) accepté ↔ refus`,
  });
  const deltaOk = noiseFloor !== null && candidate.meanAbsDelta <= noiseFloor + RULES.deltaMarginOverNoise;
  checks.push({
    id: 'b',
    passed: candidate.zoneAgreement >= RULES.zoneAgreementMin && deltaOk,
    detail:
      `accord de zone ${pct(candidate.zoneAgreement)} (seuil ${pct(RULES.zoneAgreementMin)}) ; ` +
      `Δscore moyen absolu ${candidate.meanAbsDelta.toFixed(1)} ` +
      (noiseFloor === null ? '(plancher de bruit INCONNU)' : `(plafond ${(noiseFloor + RULES.deltaMarginOverNoise).toFixed(1)} = bruit ${noiseFloor.toFixed(1)} + ${RULES.deltaMarginOverNoise})`),
  });
  checks.push({
    id: 'c',
    passed: candidate.knockoutAgreement >= RULES.knockoutAgreementMin,
    detail: `accord sur les rédhibitoires ${pct(candidate.knockoutAgreement)}`,
  });
  checks.push({
    id: 'd',
    passed: candidate.nonVerifiableToNon === 0,
    detail: `${candidate.nonVerifiableToNon} « non vérifiable » devenu(s) « non »`,
  });
  // (e) — redéfini le 25/09/2026 : un seuil ABSOLU (1 %) était hors d'atteinte
  // pour la référence elle-même (17 % au premier run). On compare au modèle
  // de référence, sur les mêmes CV : pas plus de 2 points au-dessus.
  const ceiling = candidate.refUnprovenRate + RULES.unprovenMarginOverReference;
  checks.push({
    id: 'e',
    passed: candidate.otherUnprovenRate <= ceiling + 1e-9,
    detail:
      `verdicts positifs sans preuve tenable : ${candidate.otherUnproven}/${candidate.otherPositives} (${pct(candidate.otherUnprovenRate)}) ` +
      `contre ${candidate.refUnproven}/${candidate.refPositives} (${pct(candidate.refUnprovenRate)}) pour la référence — plafond ${pct(ceiling)}`,
  });
  // Un CV que le modèle candidat n'a pas su analyser n'est pas « comparable » :
  // il ne peut pas faire passer le verdict en silence.
  if (candidateFailures > 0) {
    checks.push({
      id: 'f',
      passed: false,
      detail: `${candidateFailures} analyse(s) en échec chez le modèle candidat — non comparées, à examiner`,
    });
  }
  return { acceptable: checks.every((c) => c.passed), checks };
}

// ─── Désaccords, classés par gravité (§4) ───────────────────────────────────

export type Severity = 1 | 2 | 3 | 4 | 5;
export const SEVERITY_LABEL: Record<Severity, string> = {
  1: 'Basculement accepté ↔ refus',
  2: 'Changement de zone',
  3: 'Désaccord sur un rédhibitoire',
  4: '« Non vérifiable » devenu « non »',
  5: 'Citation introuvable dans le CV',
};

export function severityOf(p: CvComparison): Severity | null {
  if (p.flip) return 1;
  if (!p.zoneSame) return 2;
  if (!p.knockoutsAgree) return 3;
  if (p.nonVerifiableToNon > 0) return 4;
  if (p.quotesInvalid > 0) return 5;
  return null;
}

/** Les désaccords, les plus graves d'abord ; à gravité égale, le plus grand écart de score. */
export function rankDisagreements(pairs: CvComparison[]): (CvComparison & { severity: Severity })[] {
  return pairs
    .map((p) => ({ ...p, severity: severityOf(p) }))
    .filter((p): p is CvComparison & { severity: Severity } => p.severity !== null)
    .sort((a, b) => a.severity - b.severity || Math.abs(b.deltaScore) - Math.abs(a.deltaScore));
}

// ─── Modèle renvoyé ─────────────────────────────────────────────────────────

/**
 * Le modèle renvoyé par l'API est-il bien celui demandé ? Égalité, ou même nom
 * suivi d'un suffixe de DATE seulement — `gpt-4o-mini-2024-07-18` n'est PAS un
 * `gpt-4o` (un préfixe naïf l'accepterait, et un bras tournant en réalité sur
 * le mauvais modèle rendrait un accord parfait).
 */
export function isSameModel(requested: string, returned: string): boolean {
  const r = requested.trim();
  const got = returned.trim();
  if (got === r) return true;
  return got.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '') === r;
}
