/**
 * Décision de gating HITL pour l'outreach candidat — SOURCE UNIQUE.
 *
 * Les deux pipelines de sortie de mail (chat `manager-flow` et poller
 * `imap/outreach`) appellent CETTE fonction pour décider, pour un candidat
 * analysé : envoyer le mail tout de suite, ou le mettre en file de validation
 * humaine. La règle vivait avant uniquement dans le chemin chat ; le chemin
 * IMAP la dupliquait (en fait : ne l'avait pas), d'où le bug « le refus part
 * sans validation ». Elle n'existe désormais qu'ici.
 *
 * Lot 2 (HITL 3 zones) — la décision n'est plus dérivée d'une config HITL
 * GLOBALE par type de mail, mais de la ZONE du candidat (calculée UNE fois par
 * `scoreCandidat` à partir des deux seuils de la campagne) :
 *   - `auto_reject` / `auto_accept` → on envoie (refus / invitation auto) ;
 *   - `gray` → on met en file de validation humaine, on n'envoie JAMAIS.
 * La zone est passée par l'appelant (chat lit `scoringResult.decisionZone`,
 * IMAP lit `candidate.decisionZone` — même champ, même source). Zéro
 * duplication de la logique de zone ici.
 *
 * Pur contrôle de flux : aucun import server-only (supabase) ni client-only
 * (fetch/store). Les effets de bord (envoyer, mettre en file) sont injectés par
 * l'appelant via `OutreachGatePorts`.
 */
import type { DecisionZone } from '@/types/hitl';

/** Issue terminale d'un envoi immédiat (chemin non gaté). */
export type SendResult =
  | { kind: 'sent' }
  | { kind: 'skipped'; reason: 'no_email' | 'no_config' }
  | { kind: 'send_failed'; reason: string };

/** Issue de la décision de gating. */
export type GateOutcome =
  | SendResult // a été envoyé (ou skip/échec terminal)
  | { kind: 'queued' } // mis en file de validation (persisté durablement)
  | { kind: 'deferred'; reason: 'enqueue_unpersisted' };
//   ^ zone grise ET la file n'a PAS persisté → on n'envoie RIEN (un gris n'a
//     aucune direction de mail décidée : l'auto-envoyer serait la perte
//     silencieuse interdite). L'appelant DOIT préserver l'item pour réessai
//     (IMAP : RetryableOutreachError ; chat : on saute, candidat non traité).

export interface OutreachGatePorts {
  /** Envoie le mail maintenant (zones auto). */
  send(): Promise<SendResult>;
  /** Met en file de validation. `true` = persisté durablement, `false` sinon. */
  enqueue(): Promise<boolean>;
}

export async function gateCandidateOutreach(
  zone: DecisionZone,
  ports: OutreachGatePorts,
): Promise<GateOutcome> {
  // Zones automatiques → envoi immédiat (refus ou invitation).
  if (zone !== 'gray') {
    return await ports.send();
  }

  // Zone grise → validation humaine. On met en file, on n'envoie pas.
  const persisted = await ports.enqueue();
  if (persisted) return { kind: 'queued' };

  // Gris mais file non persistée → ne JAMAIS envoyer à l'aveugle (un gris n'a
  // pas de direction décidée). Defer pour les DEUX chemins (chat inclus).
  return { kind: 'deferred', reason: 'enqueue_unpersisted' };
}
