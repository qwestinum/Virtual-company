/**
 * Refus GROUPÉ — exécution d'une fournée de refus depuis le sous-onglet
 * « Propositions de refus ».
 *
 * Ce n'est PAS un nouveau chemin de décision. Chaque candidature passe une par
 * une par `decideGrayValidation`, donc par sa propre réservation d'envoi, son
 * propre claim d'idempotence et sa propre finalisation. Le « groupé » ne vit
 * que dans le geste de l'humain : dix clics deviennent un, la mécanique en
 * dessous ne change pas d'un octet.
 *
 * SÉQUENTIEL, délibérément. Un `Promise.all` sur cinquante refus lancerait
 * cinquante envois Resend simultanés (limites de débit) et rendrait un rapport
 * d'échecs illisible. On avance en file, on rend compte au fur et à mesure.
 *
 * Un échec n'arrête PAS la fournée : les candidatures suivantes sont traitées,
 * et celles qui ont échoué restent `pending` — donc encore dans la liste, prêtes
 * à être retentées. C'est l'exigence explicite : un échec partiel ne doit ni
 * tout annuler ni faire disparaître ce qui n'est pas parti.
 */

import { decideGrayValidation } from '@/lib/hitl/decide-gray-validation';
import type { PendingValidation } from '@/types/hitl';

export type BulkRejectOutcome = {
  id: string;
  candidateName: string;
  ok: boolean;
  message: string;
};

export type BulkRejectReport = {
  outcomes: BulkRejectOutcome[];
  succeeded: number;
  failed: number;
};

function payloadString(v: PendingValidation, key: string): string | null {
  const raw = v.payload?.[key];
  return typeof raw === 'string' ? raw : null;
}

/**
 * Brouillon de refus d'UNE candidature, depuis le modèle courant — exactement
 * la source qu'utilise la carte individuelle. `null` = brouillon indisponible.
 */
async function loadRejectionDraft(
  v: PendingValidation,
): Promise<{ subject: string; html: string } | null> {
  const candidate = v.payload?.candidate;
  if (!candidate) return null;
  try {
    const res = await fetch('/api/mail-composer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artifactId: 'preview',
        campaignId: v.campaignId,
        jobTitle: payloadString(v, 'jobTitle') ?? null,
        mode: 'reject',
        candidate,
        preview: true,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { subject?: string; html?: string };
    const subject = data.subject ?? '';
    const html = data.html ?? '';
    if (subject.trim() === '' || html.trim() === '') return null;
    return { subject, html };
  } catch {
    return null;
  }
}

export async function runBulkReject(
  items: readonly PendingValidation[],
  opts: {
    sendMail: boolean;
    batchId: string;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<BulkRejectReport> {
  const outcomes: BulkRejectOutcome[] = [];
  for (const [index, v] of items.entries()) {
    let draft: { subject: string; html: string } = { subject: '', html: '' };
    if (opts.sendMail) {
      const loaded = await loadRejectionDraft(v);
      if (!loaded) {
        // On ne décide PAS sans mail rédigeable quand le mail est demandé :
        // finaliser ici enverrait un message vide, ou pire, marquerait la
        // candidature traitée sans que le candidat ait jamais rien reçu.
        // Elle reste `pending`, visible, retentable.
        outcomes.push({
          id: v.id,
          candidateName: v.candidateName,
          ok: false,
          message:
            'Brouillon de refus indisponible — rien n’a été envoyé, la candidature reste en attente.',
        });
        opts.onProgress?.(index + 1, items.length);
        continue;
      }
      draft = loaded;
    }
    const result = await decideGrayValidation(v, 'reject', draft, {
      sendMail: opts.sendMail,
      batchId: opts.batchId,
    });
    outcomes.push({
      id: v.id,
      candidateName: v.candidateName,
      ok: result.ok,
      message: result.message,
    });
    opts.onProgress?.(index + 1, items.length);
  }
  return {
    outcomes,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
  };
}
