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
 * La décision n'est pas dérivée d'une config par type de mail, mais de la ZONE
 * du candidat (calculée UNE fois par `scoreCandidat` à partir des deux seuils
 * de la campagne).
 *
 * ⚠️ RÈGLE ACTUELLE (mise en conformité RGPD, 18/08/2026) — **AUCUN REFUS NE
 * PART SANS UN HUMAIN**. Une seule zone envoie encore d'elle-même :
 *   - `auto_accept` → invitation envoyée (décision FAVORABLE et réversible) ;
 *   - `proposed_reject` ET `gray` → file de validation humaine, RIEN ne part.
 *
 * C'est un renversement de la règle d'origine, où `auto_reject` envoyait le
 * refus immédiatement. Le refus est désormais *proposé* : il attend un clic.
 * Écrire ce gate en listant les zones qui mettent en file serait fragile — une
 * zone ajoutée demain enverrait par défaut. On liste donc celle qui ENVOIE, et
 * tout le reste attend : le défaut penche du côté qui ne peut pas nuire.
 *
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
  | { kind: 'send_failed'; reason: string }
  // Idempotence cross-instance : le claim est CONFIRMÉ — une passe concurrente
  // a envoyé ce mail (PROUVÉ, claims deux-phases). CE process n'envoie rien —
  // et l'appelant ne doit PAS non plus enchaîner les effets post-envoi (ex.
  // brief d'entretien), la passe gagnante s'en charge. Cf. `imap_outreach_claims`.
  | { kind: 'duplicate' }
  // Claim posé par une autre passe mais NON confirmé et non périmé : l'envoi
  // est peut-être EN COURS. Ni final ni échec — l'appelant doit DIFFÉRER
  // (IMAP : geler le curseur et re-présenter le message ; le prochain passage
  // verra soit un claim confirmé → duplicate, soit périmé → reprise). Audit C5.
  | { kind: 'in_flight' };

/** Issue de la décision de gating. */
export type GateOutcome =
  | SendResult // a été envoyé (ou skip/échec terminal)
  | { kind: 'queued' } // mis en file de validation (persisté durablement)
  | { kind: 'deferred'; reason: 'enqueue_unpersisted' };
//   ^ zone en attente d'un humain ET la file n'a PAS persisté → on n'envoie
//     RIEN. L'appelant DOIT préserver l'item pour réessai (IMAP :
//     RetryableOutreachError ; chat : on saute, candidat non traité).

export interface OutreachGatePorts {
  /** Envoie le mail maintenant (acceptation automatique UNIQUEMENT). */
  send(): Promise<SendResult>;
  /** Met en file de validation. `true` = persisté durablement, `false` sinon. */
  enqueue(): Promise<boolean>;
}

export async function gateCandidateOutreach(
  zone: DecisionZone,
  ports: OutreachGatePorts,
): Promise<GateOutcome> {
  // SEULE zone qui envoie d'elle-même : l'acceptation automatique.
  // (`auto_reject` est legacy et n'est plus jamais produite ; si une projection
  // ancienne en présentait une, elle passerait ici par la file — le repli
  // prudent, jamais l'envoi.)
  if (zone === 'auto_accept') {
    return await ports.send();
  }

  // Proposé au refus OU gris → validation humaine. On met en file, on n'envoie
  // pas : c'est ici que se tient la conformité RGPD.
  const persisted = await ports.enqueue();
  if (persisted) return { kind: 'queued' };

  // File non persistée → ne JAMAIS envoyer à l'aveugle. Defer pour les DEUX
  // chemins (chat inclus) : l'item repassera.
  return { kind: 'deferred', reason: 'enqueue_unpersisted' };
}
