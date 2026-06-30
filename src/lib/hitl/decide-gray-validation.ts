/**
 * HITL — décision d'une candidature en ZONE GRISE (Accepter / Refuser + mail).
 *
 * MÉCANIQUE UNIQUE PARTAGÉE : extraite de `ValidationCard.onSend` pour qu'AUCUN
 * appelant ne réimplémente le chemin d'envoi. Utilisée à l'identique par :
 *   - `ValidationCard` (onglet Validations suspendues) ;
 *   - le menu Candidatures (panneau niveau 2 ET page niveau 3).
 *
 * Séquence (strictement celle de l'historique) :
 *   1. Si la décision diffère de la proposition stockée → PATCH
 *      /api/validations/[id] { decision, confirmed:true } : persiste la décision
 *      tranchée + capture l'identité du valideur (côté serveur, jamais le
 *      payload client). Le brief Scheduler et la propagation candidate_analyses
 *      lisent la décision EN BASE, pas un payload volatile.
 *   2. Envoi via `sendValidation` → /api/mail-composer → /api/scheduler →
 *      /api/validations/[id]/send. STRICTEMENT le même chemin que les envois
 *      automatiques (zéro divergence, cf. rappel des bugs HITL/briefing).
 */

import { sendValidation, type SendResult } from '@/lib/hitl/send-validation';
import type { HitlDecision, PendingValidation } from '@/types/hitl';

export async function decideGrayValidation(
  v: PendingValidation,
  decision: HitlDecision,
  draft: { subject: string; html: string },
): Promise<SendResult> {
  if (decision !== v.decision) {
    try {
      const res = await fetch(`/api/validations/${encodeURIComponent(v.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, confirmed: true }),
      });
      if (!res.ok) {
        return {
          ok: false,
          message: `Décision non enregistrée (HTTP ${res.status}). Réessaie.`,
        };
      }
    } catch {
      return {
        ok: false,
        message: 'Erreur réseau — décision non enregistrée. Réessaie.',
      };
    }
  }
  return sendValidation({ ...v, decision }, draft);
}
