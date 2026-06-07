/**
 * HITL — orchestration de l'ENVOI d'une validation suspendue (P5).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Réutilise les routes d'envoi existantes :
 *   1. /api/mail-composer (override) → envoie le mail ÉDITÉ au candidat.
 *   2. /api/scheduler (si accept)    → brief entretien au DRH (best-effort).
 *   3. /api/validations/[id]/send    → marque `sent` + journalise.
 *
 * Seul échec bloquant : l'envoi candidat (1). Si le brief (2) échoue, on
 * continue (le candidat a reçu son mail, c'est l'essentiel).
 */

import type { PendingValidation } from '@/types/hitl';
import type { MailCandidate } from '@/types/mail-candidate';

export type SendResult = { ok: boolean; message: string };

function newArtifactId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function sendValidation(
  v: PendingValidation,
  edited: { subject: string; html: string },
): Promise<SendResult> {
  const candidate = v.payload?.candidate as MailCandidate | undefined;
  const jobTitle =
    typeof v.payload?.jobTitle === 'string' ? (v.payload.jobTitle as string) : null;
  if (!candidate) {
    return { ok: false, message: 'Données candidat manquantes pour l’envoi.' };
  }
  const mode = v.decision === 'accept' ? 'invite' : 'reject';

  // 1. Envoi du mail candidat (contenu édité, override → pas de re-composition).
  try {
    const res = await fetch('/api/mail-composer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artifactId: newArtifactId('art_sent'),
        campaignId: v.campaignId,
        jobTitle,
        mode,
        candidate,
        mail: edited,
      }),
    });
    const data = (await res.json()) as { status?: string; error?: string | null };
    if (!res.ok || data.status !== 'sent') {
      return {
        ok: false,
        message:
          data.status === 'skipped_no_email'
            ? 'Pas d’email candidat — envoi impossible.'
            : data.status === 'skipped_no_config'
              ? 'Service email non configuré — envoi impossible.'
              : `Échec de l’envoi (${data.error ?? data.status ?? 'erreur'}).`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      message: `Erreur réseau à l’envoi (${err instanceof Error ? err.message : 'inconnue'}).`,
    };
  }

  // 2. Brief DRH pour un accept (best-effort, ne bloque pas).
  if (v.decision === 'accept') {
    try {
      await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId: newArtifactId('art_brief'),
          campaignId: v.campaignId,
          jobTitle,
          candidate,
        }),
      });
    } catch {
      // best-effort : le brief n'est pas bloquant.
    }
  }

  // 3. Marque la validation envoyée + journalise.
  try {
    await fetch(`/api/validations/${encodeURIComponent(v.id)}/send`, {
      method: 'POST',
    });
  } catch {
    // Le mail est parti ; l'échec de marquage est non bloquant côté DRH.
  }

  return {
    ok: true,
    message:
      v.decision === 'accept'
        ? 'Invitation envoyée au candidat (brief DRH inclus).'
        : 'Refus envoyé au candidat.',
  };
}
