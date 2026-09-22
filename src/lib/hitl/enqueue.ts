/**
 * ÉCRIVAIN UNIQUE de la file de validation humaine (`pending_validations`).
 *
 * Toutes les portes d'entrée d'une candidature passent ici pour mettre en
 * file : poller IMAP, dépôt de CV par le chat, re-scoring, re-mise en file
 * manuelle. Avant le 20/09/2026, chaque porte écrivait la sienne — d'où des
 * garanties différentes selon l'origine du CV (cf.
 * `docs/ops/diagnostic-validations-orphelines-2026-09-20.md` §4.1).
 *
 * Le contrat est celui que le chemin IMAP tenait déjà, et il ne change pas :
 *   · upsert par id DÉTERMINISTE (`validationIdFor`) ⇒ rejouable ;
 *   · fusion NON DESTRUCTIVE (`mergePendingValidationEnqueue`) ⇒ une re-passe
 *     ne remplace jamais un lien d'artefact non-null par null, ne rouvre
 *     jamais un `sent` et ne piétine jamais un `sending` — la lecture le
 *     décide, et l'ÉCRITURE le garantit (conditionnelle : la fenêtre entre
 *     les deux était réelle, cf. `upsertPendingValidation`) ;
 *   · l'issue dit la PERSISTANCE, rien d'autre : `failed` fait retomber le
 *     gate sur `deferred`, donc sur le réessai — jamais sur un envoi à
 *     l'aveugle. `already_engaged` est un SUCCÈS (l'humain a déjà la main),
 *     distinct de `written` pour que l'appelant ne re-journalise pas une mise
 *     en file qui n'a pas eu lieu.
 */
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  getPendingValidation,
  upsertPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { mergePendingValidationEnqueue } from '@/lib/hitl/enqueue-merge';
import type { PendingValidation } from '@/types/hitl';

export type EnqueueOutcome = 'written' | 'already_engaged' | 'failed';

/** `written` et `already_engaged` valent tous deux « la file est bonne ». */
export function enqueuePersisted(outcome: EnqueueOutcome): boolean {
  return outcome !== 'failed';
}

/**
 * Met (ou remet) une candidature en file.
 *
 * N'écrit RIEN d'autre : le journal appartient à l'appelant, dont le
 * vocabulaire dépend de l'origine (`imap_outreach_pending`,
 * `chat_outreach_pending`, `validation_requeued`).
 */
export async function enqueueValidationRow(
  fresh: PendingValidation,
): Promise<EnqueueOutcome> {
  try {
    const existing = await getPendingValidation(fresh.id);
    const merged = mergePendingValidationEnqueue(existing, fresh);
    // Déjà engagée (`sending`) ou tranchée (`sent`) : la validation existe
    // durablement, l'humain a la main — cette passe n'a rien à écrire.
    if (!merged.write) return 'already_engaged';
    // ⚠️ La lecture ci-dessus ne suffit PAS : une réservation d'envoi peut se
    // poser entre elle et l'écriture. C'est l'écriture elle-même qui refuse
    // de rouvrir une fiche engagée (`null` ⇒ elle l'était devenue).
    const written = await upsertPendingValidation(merged.value);
    return written ? 'written' : 'already_engaged';
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[hitl] mise en file échouée', fresh.id, err);
    }
    return 'failed';
  }
}
