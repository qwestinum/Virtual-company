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

import type { HitlDecision, PendingValidation } from '@/types/hitl';
import type { MailCandidate } from '@/types/mail-candidate';

export type SendResult = { ok: boolean; message: string };

export type SwitchResult = {
  ok: boolean;
  validation?: PendingValidation;
  message: string;
};

function newArtifactId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * P6 — SWITCHER : flip NON terminal de la décision. Régénère le brouillon de la
 * chaîne inverse (refus↔acceptation), réinitialise `confirmed`, et déplace la
 * ligne vers l'autre liste. Rien n'est envoyé. Retourne la validation à jour.
 */
export async function switchValidation(
  v: PendingValidation,
): Promise<SwitchResult> {
  const candidate = v.payload?.candidate as MailCandidate | undefined;
  const jobTitle =
    typeof v.payload?.jobTitle === 'string' ? (v.payload.jobTitle as string) : null;
  if (!candidate) {
    return { ok: false, message: 'Données candidat manquantes pour le switch.' };
  }
  const newDecision: HitlDecision = v.decision === 'accept' ? 'reject' : 'accept';
  const newMode = newDecision === 'accept' ? 'invite' : 'reject';
  const artifactId = newArtifactId('art_draft');

  // 1. Régénère le brouillon de la décision inverse (best-effort : un accept
  //    sans Cal.com configuré renverra 503 → pas de brouillon, mais le flip a
  //    quand même lieu).
  let mailDraftArtifactId: string | null = null;
  let mailDraftUrl: string | null = null;
  let mailSubject: string | null = null;
  let mailBody: string | null = null;
  try {
    const res = await fetch('/api/mail-composer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artifactId,
        campaignId: v.campaignId,
        jobTitle,
        mode: newMode,
        candidate,
        draft: true,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        subject?: string;
        html?: string;
        publicUrl?: string | null;
      };
      mailDraftArtifactId = artifactId;
      mailDraftUrl = data.publicUrl ?? null;
      mailSubject = data.subject ?? null;
      mailBody = data.html ?? null;
    }
  } catch {
    // best-effort
  }

  // 2. Flip la décision + reset confirmed + nouveau brouillon (PATCH).
  try {
    const res = await fetch(`/api/validations/${encodeURIComponent(v.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: newDecision,
        confirmed: false,
        mailDraftArtifactId,
        payload: { candidate, jobTitle, mailDraftUrl, mailSubject, mailBody },
      }),
    });
    if (!res.ok) {
      return { ok: false, message: `Échec du switch (HTTP ${res.status}).` };
    }
    const data = (await res.json()) as { validation?: PendingValidation };
    return {
      ok: true,
      validation: data.validation,
      message:
        newDecision === 'accept'
          ? 'Basculé en acceptation.'
          : 'Basculé en refus.',
    };
  } catch (err) {
    return {
      ok: false,
      message: `Erreur réseau au switch (${err instanceof Error ? err.message : 'inconnue'}).`,
    };
  }
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
