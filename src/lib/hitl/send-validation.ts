/**
 * HITL — orchestration de l'ENVOI d'une validation suspendue (P5).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Réutilise les routes d'envoi existantes :
 *   1. /api/mail-composer (override) → envoie le mail ÉDITÉ au candidat.
 *   2. /api/scheduler (si accept)    → trame d'entretien MISE EN FILE
 *                                       (délivrée au DRH à la réservation Cal.com).
 *   3. /api/validations/[id]/send    → marque `sent` + journalise.
 *
 * Seul échec bloquant : l'envoi candidat (1). Si le brief (2) échoue, on
 * continue (le candidat a reçu son mail, c'est l'essentiel).
 */

import type { HitlDecision, PendingValidation } from '@/types/hitl';
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

  // 1. Tentative d'envoi du mail candidat (best-effort). « Envoyer » EST la
  //    validation humaine de la décision → on FINALISE toujours (étape 3), même
  //    si l'email ne part pas (Resend non configuré, pas d'email candidat…). On
  //    informe juste de l'issue d'envoi. Sinon le HITL serait indémoable sans
  //    Resend et le candidat resterait éternellement « à valider ».
  let mailStatus = 'unknown';
  // Message-id Resend de l'envoi candidat — propagé au journal `hitl_validation_sent`
  // pour rendre la livraison vérifiable via /api/email/status (le HITL ne passe
  // pas par `imap_outreach_mail`, seul porteur de l'id côté envoi auto).
  let providerMessageId: string | null = null;
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
    const data = (await res.json()) as {
      status?: string;
      providerMessageId?: string | null;
    };
    mailStatus = res.ok ? (data.status ?? 'unknown') : `http_${res.status}`;
    if (res.ok) providerMessageId = data.providerMessageId ?? null;
  } catch {
    mailStatus = 'network_error';
  }

  // 2. Briefing DRH MIS EN FILE pour un accept (best-effort, ne bloque pas).
  //    Il sera délivré (mail + CV) à la réservation Cal.com du candidat.
  if (v.decision === 'accept') {
    try {
      await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: v.campaignId,
          jobTitle,
          candidate,
        }),
      });
    } catch {
      // best-effort : la mise en file du brief n'est pas bloquante.
    }
  }

  // 3. FINALISE : marque la validation envoyée + journalise (le candidat
  //    réapparaît au dashboard avec la bonne issue, compteurs à jour).
  try {
    const res = await fetch(
      `/api/validations/${encodeURIComponent(v.id)}/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerMessageId }),
      },
    );
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

  // 4. Message selon l'issue d'ENVOI (la décision, elle, est validée).
  const verb = v.decision === 'accept' ? 'Acceptation validée' : 'Refus validé';
  let tail: string;
  if (mailStatus === 'sent') {
    tail =
      v.decision === 'accept'
        ? '— invitation envoyée (le brief partira au DRH à la réservation du créneau).'
        : '— refus envoyé au candidat.';
  } else if (mailStatus === 'skipped_no_email') {
    tail = '— pas d’email candidat, mail à transmettre manuellement.';
  } else if (mailStatus === 'skipped_no_config') {
    tail = '— service email non configuré, mail non envoyé.';
  } else {
    tail = '— l’email n’a pas pu partir, mais la décision est enregistrée.';
  }
  return { ok: true, message: `${verb} ${tail}` };
}
