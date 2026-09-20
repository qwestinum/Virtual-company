/**
 * La file de validation et l'analyse racontent-elles la même histoire ? — PUR.
 *
 * Les deux tables décrivent le MÊME fait — « ce dossier attend une décision
 * humaine » — sans clé étrangère ni réconciliation. Elles divergent donc, dans
 * les deux sens :
 *
 *   · A — analyse en attente, aucune ligne de file : le dossier est compté
 *     « à valider » et n'est pas décidable (dev, 20/09 — corrigé) ;
 *   · B — ligne de file OUVERTE, analyse qui n'attend plus : la carte propose
 *     d'arbitrer un dossier déjà tranché ailleurs (prod, 20/09 — ce module).
 *
 * Le cas B est DANGEREUX et pas seulement faux : les deux dossiers observés en
 * production portaient la direction `reject` avec un score de 100 et 90 sur
 * une analyse `auto_accept`. Refuser depuis cette carte aurait envoyé un refus
 * à quelqu'un que tout le reste du produit compte comme accepté.
 *
 * ⚠️ RÈGLE : on ne conclut JAMAIS sur un doute. Analyse introuvable, zone
 * absente (ligne antérieure au modèle 3 zones) ⇒ `unknown`, et la carte garde
 * son chemin de décision. Retirer un arbitrage sur une incertitude serait pire
 * que la divergence qu'on cherche à voir.
 */
import { isAwaitingHumanZone, type DecidedBy, type DecisionZone } from '@/types/hitl';

/** Pourquoi le dossier n'attend plus — le mot est destiné à l'écran. */
export type SettledReason =
  /** L'analyse est acceptée : elle ne relève plus d'un arbitrage. */
  | 'accepted'
  /** Un humain a déjà tranché ce dossier, ailleurs. */
  | 'decided'
  /** La candidature a été classée sans suite. */
  | 'dismissed'
  /** Zone `auto_reject` (ancien régime) : une file portant cette zone est une anomalie. */
  | 'legacy_auto_reject';

export type ValidationCoherence =
  | { kind: 'awaiting' }
  | { kind: 'settled'; reason: SettledReason }
  | { kind: 'unknown' };

/** L'état de l'analyse rapprochée, ou `null` si aucune ne l'a été. */
export type AnalysisFacts = {
  decisionZone: DecisionZone | null;
  decidedBy: DecidedBy | null;
  dismissedAt: string | null;
} | null;

/**
 * L'ordre compte, et il suit celui de `deriveCandidateStage` : un classement
 * sans suite domine tout, puis une décision humaine, puis la zone.
 */
export function checkValidationCoherence(facts: AnalysisFacts): ValidationCoherence {
  // Aucune analyse rapprochée : on ne sait pas, donc on ne retire rien.
  if (!facts) return { kind: 'unknown' };
  if (facts.dismissedAt !== null) return { kind: 'settled', reason: 'dismissed' };
  if (facts.decidedBy === 'user') return { kind: 'settled', reason: 'decided' };
  // Zone absente (ligne historique) : frontière nette, jamais reconstruite.
  if (facts.decisionZone === null) return { kind: 'unknown' };
  if (isAwaitingHumanZone(facts.decisionZone)) return { kind: 'awaiting' };
  if (facts.decisionZone === 'auto_accept') {
    return { kind: 'settled', reason: 'accepted' };
  }
  return { kind: 'settled', reason: 'legacy_auto_reject' };
}

/** Raccourci de lecture — une fiche à clore, pas à arbitrer. */
export function isSettledElsewhere(c: ValidationCoherence): boolean {
  return c.kind === 'settled';
}

/**
 * Ce que la carte DIT, à la place des boutons d'arbitrage. Jamais de jargon :
 * la phrase doit se tenir devant un recruteur qui n'a pas lu le diagnostic.
 */
export const SETTLED_LABELS: Record<SettledReason, string> = {
  accepted:
    'Ce dossier a été ré-évalué et compte désormais comme accepté : il n’attend plus d’arbitrage.',
  decided:
    'Une décision a déjà été prise sur ce dossier, depuis un autre écran : il n’attend plus d’arbitrage.',
  dismissed:
    'Cette candidature a été classée sans suite : elle n’attend plus d’arbitrage.',
  legacy_auto_reject:
    'Ce dossier relève de l’ancien régime de refus automatique : il n’aurait pas dû rester en file.',
};
