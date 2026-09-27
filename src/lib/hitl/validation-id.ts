/**
 * Identifiant DÉTERMINISTE d'une ligne de file HITL, dérivé de l'analyse — PUR.
 *
 * Réciproque de `analysisIdForValidation` : une validation se retrouve depuis
 * son analyse, et une analyse depuis sa validation, sans jamais chercher.
 *
 *   `can_imap_<boîte>_<uid>` → `val_imap_<boîte>_<uid>_<décision>`
 *   `can_src_<approche>`     → `val_src_<approche>_<décision>`
 *   `cvb_<…>` (chat)         → `val_cvb_<…>_<décision>`
 *
 * Pourquoi ici, et pourquoi déterministe : trois écrivains construisaient déjà
 * cette chaîne, dont deux en la recopiant (`imapOutreachKeys`, le patch de
 * score du re-scoring) et un en tirant un id ALÉATOIRE (`nowTaskId('val')`,
 * chemin chat). Conséquences mesurées le 20/09/2026 :
 *   · le chemin chat n'était pas idempotent — deux dispatches du même lot
 *     créaient deux lignes pour un seul candidat ;
 *   · rien ne permettait, depuis une analyse orpheline, de retrouver ou de
 *     recréer sa file (cf. `docs/ops/diagnostic-validations-orphelines-2026-09-20.md`).
 *
 * L'identifiant d'analyse est la SEULE entrée : il est globalement unique
 * (l'uid IMAP ne l'est que par boîte), et c'est lui que porte `payload.analysisId`.
 */
import type { HitlDecision } from '@/types/hitl';

/** Préfixe historique des identifiants d'analyse, retiré côté validation. */
const ANALYSIS_PREFIX = /^can_/;

/**
 * `val_<racine de l'analyse>_<décision>`.
 *
 * ⚠️ La forme est un CONTRAT : elle doit continuer de produire exactement les
 * identifiants déjà en base (`val_imap_<boîte>_<uid>_reject`), sinon une
 * re-mise en file créerait un doublon au lieu de retrouver la ligne existante.
 */
export function validationIdFor(
  analysisId: string,
  decision: HitlDecision,
): string {
  return `val_${analysisId.replace(ANALYSIS_PREFIX, '')}_${decision}`;
}

/**
 * Direction PROVISOIRE portée par la ligne de file. Ce n'est PAS une décision :
 * la carte de validation compose le mail à la demande, quand l'humain tranche.
 * Seule l'acceptation automatique a une direction établie — et celle-là ne
 * passe jamais par la file.
 */
export function provisionalDecisionFor(zone: string): HitlDecision {
  return zone === 'auto_accept' ? 'accept' : 'reject';
}
