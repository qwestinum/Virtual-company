/**
 * HITL — orchestration de l'ENVOI d'une validation suspendue (P5, durci C6).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Séquence EXACTLY-ONCE (audit C6) :
 *   0. /api/validations/[id]/reserve-send → verrou atomique `pending→sending`
 *      côté serveur AVANT tout envoi (double-clic / second onglet → 409, rien
 *      ne part deux fois ; un `sending` périmé — crash — est repris après TTL).
 *   1. /api/mail-composer (override + validationId) → envoie le mail ÉDITÉ au
 *      candidat, sous claim d'idempotence deux-phases : un retry après un
 *      envoi réussi reçoit `duplicate` et ne renvoie RIEN.
 *   2. /api/scheduler (si accept)    → trame d'entretien MISE EN FILE
 *                                       (délivrée au DRH à la réservation Cal.com).
 *   3. /api/validations/[id]/send    → marque `sent` + journalise avec le
 *      statut d'envoi RÉEL (`mailStatus` — journal honnête ; si le mail n'est
 *      pas parti : action dédiée `hitl_mail_not_sent`, candidat à recontacter).
 *
 * Seul échec bloquant : l'envoi candidat (1). Si le brief (2) échoue, on
 * continue (le candidat a reçu son mail, c'est l'essentiel). Un échec de la
 * finalisation (3) est RE-TENTABLE SANS RISQUE : la réservation + le claim
 * garantissent qu'aucun second mail ne partira.
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

  // 0. RÉSERVATION (audit C6) — le verrou atomique AVANT tout envoi. Perdu ⇒
  //    on n'envoie rien : soit déjà traité, soit un envoi est en cours.
  try {
    const res = await fetch(
      `/api/validations/${encodeURIComponent(v.id)}/reserve-send`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (data.error === 'already_sent') {
        return {
          ok: false,
          message:
            'Cette validation a déjà été traitée — aucun nouvel envoi. Recharge la liste.',
        };
      }
      if (data.error === 'send_in_flight') {
        return {
          ok: false,
          message:
            'Un envoi est déjà en cours pour cette validation — patiente quelques instants puis recharge.',
        };
      }
      return {
        ok: false,
        message: `Impossible de réserver l’envoi (HTTP ${res.status}) — rien n’a été envoyé.`,
      };
    }
  } catch {
    return {
      ok: false,
      message: 'Erreur réseau avant l’envoi — rien n’a été envoyé. Réessaie.',
    };
  }

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
        // Claim d'idempotence deux-phases côté serveur (audit C6) : un retry
        // après un envoi réussi reçoit `duplicate` — jamais de second mail.
        validationId: v.id,
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
      const uid = typeof v.payload?.uid === 'string' ? v.payload.uid : undefined;
      await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: v.campaignId,
          jobTitle,
          candidate,
          uid, // rattache le brief à CETTE candidature (tag « RDV pris » fiable)
        }),
      });
    } catch {
      // best-effort : la mise en file du brief n'est pas bloquante.
    }
  }

  // 3. FINALISE : marque la validation envoyée + journalise avec le statut
  //    d'envoi RÉEL (journal honnête — audit C6). Un échec ici est RE-TENTABLE
  //    SANS RISQUE : réservation + claim garantissent zéro second mail.
  try {
    const res = await fetch(
      `/api/validations/${encodeURIComponent(v.id)}/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerMessageId, mailStatus }),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        message: `Le mail a été pris en compte, mais l'enregistrement de la décision n'a pas abouti (HTTP ${res.status}). Réessaie — aucun second mail ne partira.`,
      };
    }
  } catch {
    return {
      ok: false,
      message:
        'Le mail a été pris en compte, mais l’enregistrement de la décision n’a pas abouti (réseau). Réessaie — aucun second mail ne partira.',
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
  } else if (mailStatus === 'duplicate') {
    tail =
      '— le mail était déjà parti lors d’une tentative précédente, aucun doublon envoyé.';
  } else if (mailStatus === 'skipped_no_email') {
    tail = '— pas d’email candidat, mail à transmettre manuellement.';
  } else if (mailStatus === 'skipped_no_config') {
    tail = '— service email non configuré, mail NON envoyé (candidat listé à recontacter).';
  } else {
    tail =
      '— le mail n’est PAS parti (candidat listé à recontacter), mais la décision est enregistrée.';
  }
  return { ok: true, message: `${verb} ${tail}` };
}
