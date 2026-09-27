/**
 * Rail de reprise de l'INDEXATION du vivier — branché sur le même tour que les
 * autres (cron de relève en prod, tick du scheduler en dev/VPS).
 *
 * ⚠️ Pourquoi il existe (23/09/2026, constaté en production : 124 dossiers).
 * La porte email crée le dossier puis lance son indexation en promesse
 * FLOTTANTE (`void feedVivierFromApplication` dans le poller). Sur Vercel,
 * l'instance est gelée dès que la réponse du cron part : l'indexation n'aboutit
 * jamais, ni en succès ni en échec. Le dossier reste `pending` — donc
 * INVISIBLE à la présélection, qui ne lit que `indexing_status = 'indexed'`.
 * Ce n'est pas une étiquette mal placée, c'est une perte de couverture
 * silencieuse.
 *
 * La ligne `pending` EST la file d'attente : rien à créer en base. Le rail
 * reprend les plus anciennes, quelques-unes par passage — une indexation coûte
 * un appel au modèle et plusieurs embeddings, et le cron partage ses 60
 * secondes avec la relève, le drain des rendez-vous et le sourcing.
 *
 * FAIL-SOFT de bout en bout : rien ici ne doit faire échouer une relève de
 * boîte.
 */

import { CLAIM_TTL_MS } from '@/lib/db/claims-policy';
import {
  claimVivierIndexing,
  listVivierCandidatesToReindex,
} from '@/lib/db/repos/vivier';
import { getServerSupabase } from '@/lib/db/supabase-server';
import { indexVivierCandidate } from '@/lib/vivier/indexing';

/** Une indexation = un appel au modèle + N embeddings : peu par passage. */
const PER_TICK = 2;

/**
 * Âge minimal d'un dossier pour être repris. Il sert DEUX fois : il évite de
 * re-servir celui qu'une passe est en train d'indexer (le claim vient de
 * toucher `updated_at`), et il laisse sa chance au chemin nominal — un dossier
 * créé à l'instant peut encore être indexé par la promesse qui l'accompagne.
 * Même TTL que les autres réservations du produit.
 */
const MIN_AGE_MS = CLAIM_TTL_MS;

export type VivierMaintenanceOutcome = {
  /** Dossiers passés à `indexed` pendant ce passage. */
  indexed: number;
  /** Dossiers passés à `failed` (défaut prouvé du document, panne du modèle…). */
  failed: number;
};

export async function runVivierIndexingMaintenance(
  now: Date = new Date(),
): Promise<VivierMaintenanceOutcome> {
  const outcome: VivierMaintenanceOutcome = { indexed: 0, failed: 0 };
  if (!getServerSupabase()) return outcome;

  try {
    const before = new Date(now.getTime() - MIN_AGE_MS).toISOString();
    // On lit un peu plus large que ce qu'on traite : les claims perdus (une
    // autre invocation est passée avant) ne doivent pas faire rentrer le rail
    // les mains vides.
    const candidates = await listVivierCandidatesToReindex(PER_TICK * 3, before);
    let done = 0;
    for (const candidate of candidates) {
      if (done >= PER_TICK) break;
      if (!(await claimVivierIndexing(candidate))) continue;
      done++;
      const result = await indexVivierCandidate(candidate.id);
      if (result.status === 'indexed') outcome.indexed++;
      else outcome.failed++;
    }
  } catch (err) {
    console.error('[vivier] rail d’indexation échoué', err);
  }
  return outcome;
}
