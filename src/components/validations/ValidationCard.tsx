'use client';

/**
 * Carte d'une candidature en zone de validation (HITL 3 zones, lot 2d).
 *
 * Refonte : colonne unique, DEUX actions explicites « Accepter + mail » /
 * « Refuser + mail » (plus de décision pré-proposée — le gris n'a pas de sens
 * acté). Choisir une action révèle le brouillon ÉDITABLE correspondant ; l'envoi
 * reste un clic distinct (protection A : on relit le mail avant qu'il parte,
 * + garde de réentrance synchrone). L'envoi passe par la MÊME mécanique que les
 * chemins auto (sendValidation → /api/mail-composer → Resend).
 */

import { useEffect, useRef, useState } from 'react';

import { sendValidation } from '@/lib/hitl/send-validation';
import { openSignedArtifact } from '@/lib/storage/open-signed-artifact';
import { formatDateTimeFr } from '@/lib/format/datetime';
import {
  downloadArtifact,
  useArtifactsStore,
  type Artifact,
} from '@/stores/artifacts-store';
import type { HitlDecision, PendingValidation } from '@/types/hitl';

async function openArtifact(artifact: Artifact): Promise<void> {
  if (artifact.storagePath) {
    const ok = await openSignedArtifact(artifact.id);
    if (ok) return;
  }
  downloadArtifact(artifact);
}

function payloadString(v: PendingValidation, key: string): string | null {
  const raw = v.payload?.[key];
  return typeof raw === 'string' ? raw : null;
}

function candidateSummary(v: PendingValidation): string | null {
  const c = v.payload?.candidate;
  if (c && typeof c === 'object' && 'summary' in c) {
    const s = (c as { summary?: unknown }).summary;
    return typeof s === 'string' ? s : null;
  }
  return null;
}

export function ValidationCard({
  v,
  onSent,
}: {
  v: PendingValidation;
  onSent: (v: PendingValidation, message: string) => void;
}) {
  const [chosen, setChosen] = useState<HitlDecision | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const editedRef = useRef(false);
  // Garde SYNCHRONE : `disabled={sending}` ne s'applique qu'au re-render suivant ;
  // un double-clic rapide enverrait le mail deux fois (mail-composer non idempotent).
  const sendingRef = useRef(false);

  // Choisir une action → (re)compose le brouillon de CETTE direction depuis le
  // modèle courant. On ne piétine pas une édition en cours (editedRef).
  useEffect(() => {
    if (!chosen || editedRef.current) return;
    const candidate = v.payload?.candidate;
    if (!candidate) return;
    const mode = chosen === 'accept' ? 'invite' : 'reject';
    let cancelled = false;
    setDraftLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/mail-composer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artifactId: 'preview',
            campaignId: v.campaignId,
            jobTitle: payloadString(v, 'jobTitle') ?? null,
            mode,
            candidate,
            preview: true,
          }),
        });
        if (res.ok && !cancelled && !editedRef.current) {
          const data = (await res.json()) as { subject?: string; html?: string };
          if (data.subject != null) setSubject(data.subject);
          if (data.html != null) setBody(data.html);
        }
      } catch {
        // réseau KO → brouillon indisponible, on le signale plus bas.
      } finally {
        if (!cancelled) setDraftLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chosen, v]);

  const jobTitle = payloadString(v, 'jobTitle');
  const summary = payloadString(v, 'summary') ?? candidateSummary(v);
  const reportArtifact = useArtifactsStore((s) =>
    v.reportArtifactId ? s.byId[v.reportArtifactId] : undefined,
  );
  const fdpArtifact = useArtifactsStore((s) =>
    Object.values(s.byId).find(
      (a) => a.campaignId === v.campaignId && a.kind === 'fdp',
    ),
  );

  const choose = (d: HitlDecision) => {
    editedRef.current = false;
    setSendError(null);
    setChosen(d);
  };

  const canSend =
    chosen != null && subject.trim().length > 0 && body.trim().length > 0 && !draftLoading;

  const onSend = async () => {
    if (sendingRef.current || chosen == null) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      // Persiste la décision TRANCHÉE avant l'envoi : le brief Scheduler (accept)
      // et la propagation vers candidate_analyses (route /send) lisent la décision
      // EN BASE, pas le payload client.
      if (chosen !== v.decision) {
        await fetch(`/api/validations/${encodeURIComponent(v.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: chosen, confirmed: true }),
        });
      }
      const result = await sendValidation(
        { ...v, decision: chosen },
        { subject, html: body },
      );
      if (result.ok) onSent(v, result.message);
      else setSendError(result.message);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <p className="mb-1.5 font-body text-[11px] font-semibold uppercase tracking-wide text-stone-400">
        Reçue le {formatDateTimeFr(v.createdAt)}
      </p>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold text-stone-900 truncate">
            {v.candidateName}
          </p>
          <p className="font-body text-[12px] text-stone-500">
            {v.campaignId}
            {v.candidateEmail ? ` · ${v.candidateEmail}` : ''}
          </p>
        </div>
        {v.score != null ? (
          <span className="flex-shrink-0 rounded-full bg-amber-100 px-2.5 py-1 font-data text-[12px] font-bold text-amber-700">
            {v.score}/100 · à trancher
          </span>
        ) : null}
      </div>

      {jobTitle ? (
        <p className="mt-2 font-body text-[12px] text-stone-600">
          <span className="font-semibold text-stone-500">Poste :</span> {jobTitle}
        </p>
      ) : null}
      {summary ? (
        <p className="mt-1 font-body text-[12px] leading-relaxed text-stone-600 line-clamp-3">
          {summary}
        </p>
      ) : null}
      {reportArtifact || fdpArtifact ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {reportArtifact ? (
            <button
              type="button"
              onClick={() => void openArtifact(reportArtifact)}
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 font-body text-[11px] font-semibold text-stone-600 hover:bg-stone-50"
            >
              📄 Rapport d’analyse
            </button>
          ) : null}
          {fdpArtifact ? (
            <button
              type="button"
              onClick={() => void openArtifact(fdpArtifact)}
              className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 font-body text-[11px] font-semibold text-stone-600 hover:bg-stone-50"
            >
              📋 Fiche de poste
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => choose('accept')}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-body font-semibold ${
            chosen === 'accept'
              ? 'bg-emerald-600 text-white'
              : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
          }`}
        >
          Accepter + mail
        </button>
        <button
          type="button"
          onClick={() => choose('reject')}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-body font-semibold ${
            chosen === 'reject'
              ? 'bg-rose-600 text-white'
              : 'border border-rose-300 text-rose-700 hover:bg-rose-50'
          }`}
        >
          Refuser + mail
        </button>
      </div>

      {chosen ? (
        <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
          <p className="mb-2 font-body text-[11px] text-stone-500">
            Relisez le mail {chosen === 'accept' ? "d’invitation" : 'de refus'}{' '}
            avant de l’envoyer.
          </p>
          {draftLoading && !editedRef.current ? (
            <p className="font-body text-[12px] text-stone-400 italic">
              Préparation du brouillon depuis le modèle…
            </p>
          ) : body ? (
            <>
              <label className="block font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Objet
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => {
                  editedRef.current = true;
                  setSubject(e.currentTarget.value);
                }}
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400"
              />
              <label className="mt-3 block font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Corps du mail
              </label>
              <textarea
                value={body}
                onChange={(e) => {
                  editedRef.current = true;
                  setBody(e.currentTarget.value);
                }}
                rows={8}
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-[12px] text-stone-800 outline-none focus:border-blue-400"
              />
              {sendError ? (
                <p className="mt-2 font-body text-[12px] text-rose-600">{sendError}</p>
              ) : null}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend || sending}
                  className={`rounded-lg px-4 py-1.5 text-[12px] font-body font-semibold ${
                    canSend && !sending
                      ? chosen === 'accept'
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-rose-600 text-white hover:bg-rose-700'
                      : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  }`}
                >
                  {sending
                    ? 'Envoi…'
                    : chosen === 'accept'
                      ? 'Envoyer l’invitation'
                      : 'Envoyer le refus'}
                </button>
              </div>
            </>
          ) : (
            <p className="font-body text-[12px] text-stone-400 italic">
              Brouillon indisponible (service email non configuré au moment de la
              rédaction).
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
