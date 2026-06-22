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
 * Pur contrôle de flux : aucun import server-only (supabase) ni client-only
 * (fetch/store). Les effets de bord (lire la config, envoyer, mettre en file)
 * sont injectés par l'appelant via `OutreachGatePorts`.
 */
import { hitlSectionForDecision, type HitlConfig, type HitlDecision } from '@/types/hitl';

/** Issue terminale d'un envoi immédiat (chemin non gaté). */
export type SendResult =
  | { kind: 'sent' }
  | { kind: 'skipped'; reason: 'no_email' | 'no_config' }
  | { kind: 'send_failed'; reason: string };

/** Issue de la décision de gating. */
export type GateOutcome =
  | SendResult // a été envoyé (ou skip/échec terminal)
  | { kind: 'queued' } // mis en file de validation (persisté durablement)
  | { kind: 'deferred'; reason: 'hitl_unconfirmed' | 'enqueue_unpersisted' };
//   ^ état HITL non confirmable / file non persistée ET on a choisi de NE PAS
//     envoyer → l'appelant DOIT préserver l'item pour réessai (ne pas marquer
//     traité). C'est le contrat anti-perte-silencieuse.

export interface OutreachGatePorts {
  /** Config HITL, ou `null` si on ne peut pas la confirmer (offline / illisible). */
  loadHitlConfig(): Promise<HitlConfig | null>;
  /** Envoie le mail maintenant (chemin non gaté). */
  send(): Promise<SendResult>;
  /** Met en file de validation. `true` = persisté durablement, `false` sinon. */
  enqueue(): Promise<boolean>;
}

export interface GateOptions {
  /**
   * Que faire quand l'état HITL est non confirmable (`loadHitlConfig`→null/throw)
   * ou que la mise en file ne persiste pas :
   *  - `'send'`  : retombe sur l'envoi immédiat (comportement chat historique) ;
   *  - `'defer'` : n'envoie RIEN, renvoie `{kind:'deferred'}` (comportement sûr
   *    IMAP — un mail retardé est rattrapable, un refus parti à tort ne l'est pas).
   */
  onUnconfirmed: 'send' | 'defer';
}

export async function gateCandidateOutreach(
  decision: HitlDecision,
  ports: OutreachGatePorts,
  options: GateOptions,
): Promise<GateOutcome> {
  let hitl: HitlConfig | null;
  try {
    hitl = await ports.loadHitlConfig();
  } catch {
    // Lecture illisible (réseau, table absente non gérée…) → non confirmable.
    hitl = null;
  }

  if (hitl === null) {
    return options.onUnconfirmed === 'send'
      ? await ports.send()
      : { kind: 'deferred', reason: 'hitl_unconfirmed' };
  }

  const gated = hitl[hitlSectionForDecision(decision)];
  if (!gated) {
    return await ports.send();
  }

  // Section sous validation humaine → on met en file, on n'envoie pas.
  const persisted = await ports.enqueue();
  if (persisted) return { kind: 'queued' };

  // Gaté mais file non persistée → ne pas envoyer aveuglément.
  return options.onUnconfirmed === 'send'
    ? await ports.send()
    : { kind: 'deferred', reason: 'enqueue_unpersisted' };
}
