/**
 * Rapprochement opportuniste par email (Session V3, §6.3).
 *
 * Quand une candidature entre dans une campagne, on vérifie si son email
 * correspond à un candidat vivier CONTACTÉ pour CETTE campagne. Si oui, on note
 * le fait « a postulé » sur la proposition (applied_at). Le candidat sort alors
 * du cooldown pour cette campagne — automatiquement, puisqu'il devient « déjà
 * candidat » (exclu par la règle de présélection).
 *
 * Rapprochement EXACT ou inexistant : correspondance stricte sur l'email
 * normalisé, JAMAIS de fuzzy matching sur le nom. Pas de correspondance ⇒
 * aucune annotation, aucun statut spéculatif. Non bloquant (best-effort).
 *
 * Les annotations visibles (candidature « issu du vivier », dossier « a
 * postulé ») sont DÉRIVÉES à la lecture des propositions — pas d'écho persisté.
 */

import { markAnalysisFromVivier } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getVivierCandidateByEmail } from '@/lib/db/repos/vivier';
import {
  findContactedProposalByEmail,
  recordApplied,
} from '@/lib/db/repos/vivier-preselection';
import { normalizeEmail } from '@/lib/vivier/candidates';

/**
 * Tente le rapprochement d'une candidature entrante avec un candidat vivier
 * contacté pour la campagne. No-op hors campagne (tâche) ou sans email. Ne lève
 * jamais.
 *
 * `analysisId` (optionnel) = l'analyse persistée pour cette candidature : si le
 * candidat a été CONTACTÉ depuis le vivier pour cette campagne (repêchage), on
 * FIGE l'origine sur l'analyse (`from_vivier` + dossier source). Indépendant du
 * `recordApplied` (qui ne pose `applied_at` qu'à la 1ʳᵉ candidature) : l'origine
 * doit tenir aussi sur une candidature ultérieure (nouvelle analyse).
 */
export async function matchVivierApplication(
  campaignId: string | null,
  email: string | null,
  analysisId?: string,
): Promise<boolean> {
  if (!campaignId || !email) return false;
  const normalized = normalizeEmail(email);
  try {
    const candidate = await getVivierCandidateByEmail(normalized);
    if (!candidate) return false;
    // Origine vivier : existe-t-il une proposition CONTACTÉE pour (campagne,
    // email) ? C'est la définition de « issu du vivier » (repêché), distincte
    // d'un simple dossier présent. On la fige sur l'analyse.
    if (analysisId) {
      const contacted = await findContactedProposalByEmail(campaignId, normalized);
      if (contacted) await markAnalysisFromVivier(analysisId, candidate.id);
    }
    // recordApplied ne pose applied_at que sur une proposition `contacted` non
    // encore rapprochée : il EST le test de correspondance contacté↔candidature.
    const matched = await recordApplied(campaignId, candidate.id);
    if (matched) {
      await appendJournalEntry({
        action: 'vivier_application_matched',
        actor: 'system',
        campaignId,
        payload: { candidateId: candidate.id, email: normalized },
      });
    }
    return matched;
  } catch (err) {
    console.error('[vivier] rapprochement candidature échoué', err);
    return false;
  }
}
