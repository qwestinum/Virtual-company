'use client';

/**
 * Fiche candidature — le candidat est-il INFORMÉ de la décision qui le
 * concerne ? (feat/feedback-candidat, lot 5.) Rattrape les verdicts posés
 * avant le chantier et les messages qui ne sont pas partis.
 *
 * Le type de message vient du SERVEUR (déduit de l'état du dossier) : l'écran
 * ne choisit jamais « quoi annoncer ». Rien à annoncer ⇒ le bloc ne s'affiche
 * pas. Aucune décision n'est posée ici.
 */

import { useCallback, useEffect, useState } from 'react';

import { postDecisionWithFeedback } from '@/lib/dashboard/candidate-actions';
import {
  FEEDBACK_CHANNEL_LABELS,
  FEEDBACK_KIND_LABELS,
  type CandidateFeedback,
  type FeedbackChoice,
  type FeedbackKind,
} from '@/types/candidate-feedback';
import type { DismissalReason } from '@/types/dismissal';

import { FeedbackChoicePanel } from './FeedbackChoicePanel';

type Status = {
  expectedKind: FeedbackKind | null;
  informed: CandidateFeedback | null;
  lastAttempt: CandidateFeedback | null;
  reason: DismissalReason | null;
};

function describe(f: CandidateFeedback): string {
  const date = new Date(f.createdAt).toLocaleDateString('fr-FR');
  const how =
    f.channel === 'mail'
      ? 'message envoyé par ORQA'
      : `prévenu par ${FEEDBACK_CHANNEL_LABELS[f.channel].toLowerCase()}${f.channelNote ? ` (${f.channelNote})` : ''}`;
  return `${how}, le ${date}${f.authorEmail ? ` — ${f.authorEmail}` : ''}`;
}

export function InformCandidateBlock({ analysisId }: { analysisId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<FeedbackChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const url = `/api/candidatures/${encodeURIComponent(analysisId)}/feedback`;

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setStatus((await res.json()) as Status);
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!status?.expectedKind) return null;
  const kind = status.expectedKind;

  async function confirm() {
    if (!choice || busy) return;
    setBusy(true);
    const result = await postDecisionWithFeedback(url, { feedback: choice });
    setBusy(false);
    setNotice(result.ok ? result.feedbackNotice : result.message);
    if (result.ok) {
      setOpen(false);
      await load();
    }
  }

  return (
    <section data-role="inform-candidate" className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3">
      <p className="font-body text-[12.5px] text-stone-700">
        <span className="font-semibold">Message « {FEEDBACK_KIND_LABELS[kind]} » : </span>
        {status.informed ? (
          <span data-informed="true" className="text-emerald-800">✓ candidat informé — {describe(status.informed)}.</span>
        ) : (
          <span data-informed="false" className="text-amber-800">
            candidat non informé de cette décision
            {status.lastAttempt?.channel === 'mail' && status.lastAttempt.mailStatus !== 'sent'
              ? ' (le dernier message n’est pas parti)'
              : ''}
            .
          </span>
        )}
      </p>
      {notice ? <p role="status" className="font-body text-[12px] text-stone-600">{notice}</p> : null}
      {!status.informed && !open ? (
        <div>
          <button
            type="button"
            data-role="open-inform"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 font-body text-[12.5px] font-semibold text-stone-700 hover:bg-stone-50"
          >
            Informer le candidat
          </button>
        </div>
      ) : null}
      {open ? (
        <>
          <FeedbackChoicePanel
            analysisId={analysisId}
            kind={kind}
            reason={status.reason ?? undefined}
            disabled={busy}
            onChange={setChoice}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100"
            >
              Annuler
            </button>
            <button
              type="button"
              data-role="confirm-inform"
              disabled={busy || !choice}
              onClick={() => void confirm()}
              className="rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
