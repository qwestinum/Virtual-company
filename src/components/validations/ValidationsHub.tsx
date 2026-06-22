'use client';

/**
 * Hub « Validation suspendue » (HITL — P4).
 *
 * Deux listes : candidats refusés / acceptés par le système. Par carte, la
 * machine à 3 boutons :
 *   - Valider la décision  → confirme (PATCH confirmed) et déverrouille la revue
 *   - Vérifier le mail      → aperçu du brouillon (grisé tant que non validé)
 *   - Switcher              → flip vers l'autre liste (P6, à venir)
 *
 * L'envoi réel se fait depuis l'aperçu (« Envoyer ») — branché en P5.
 */

import { useEffect, useRef, useState } from 'react';

import { hydrateArtifactsForCampaign } from '@/lib/db/sync/artifacts-sync';
import { sendValidation, switchValidation } from '@/lib/hitl/send-validation';
import { openSignedArtifact } from '@/lib/storage/open-signed-artifact';
import {
  downloadArtifact,
  useArtifactsStore,
  type Artifact,
} from '@/stores/artifacts-store';
import type { PendingValidation } from '@/types/hitl';

/**
 * Ouvre l'artefact (rapport, FDP — consultation) via un lien signé éphémère
 * généré côté serveur (bucket privé). Repli sur le download local si l'objet
 * n'est pas encore en Storage ou si la signature échoue.
 */
async function openArtifact(artifact: Artifact): Promise<void> {
  if (artifact.storagePath) {
    const ok = await openSignedArtifact(artifact.id);
    if (ok) return;
  }
  downloadArtifact(artifact);
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: PendingValidation[] }
  | { kind: 'error'; message: string };

function payloadString(
  v: PendingValidation,
  key: string,
): string | null {
  const raw = v.payload?.[key];
  return typeof raw === 'string' ? raw : null;
}

/** Synthèse de secours pour les validations créées avant l'exposition directe. */
function candidateSummary(v: PendingValidation): string | null {
  const c = v.payload?.candidate;
  if (c && typeof c === 'object' && 'summary' in c) {
    const s = (c as { summary?: unknown }).summary;
    return typeof s === 'string' ? s : null;
  }
  return null;
}

export function ValidationsHub() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { validations: PendingValidation[] };
        if (!cancelled) setState({ kind: 'ready', items: json.validations });
        // Hydrate les artefacts (rapport + FDP) des campagnes concernées, pour
        // que les cartes puissent proposer « Rapport » et « FDP » après reload.
        const campaigns = [
          ...new Set(json.validations.map((v) => v.campaignId)),
        ];
        await Promise.all(campaigns.map((c) => hydrateArtifactsForCampaign(c)));
      } catch (err) {
        if (!cancelled)
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'load_failed',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <p className="font-body text-stone-500 text-sm">
        Chargement des validations…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="font-body text-rose-600 text-sm">
        Impossible de charger les validations ({state.message}).
      </p>
    );
  }

  const { items } = state;
  const rejected = items.filter((v) => v.decision === 'reject');
  const accepted = items.filter((v) => v.decision === 'accept');

  const updateItem = (next: PendingValidation) =>
    setState({
      kind: 'ready',
      items: items.map((v) => (v.id === next.id ? next : v)),
    });

  const removeItem = (id: string) =>
    setState({ kind: 'ready', items: items.filter((v) => v.id !== id) });

  const onSent = (v: PendingValidation, message: string) => {
    removeItem(v.id);
    setFlash(message);
    window.setTimeout(() => setFlash(null), 3500);
  };

  const onSwitch = async (v: PendingValidation) => {
    const result = await switchValidation(v);
    if (result.ok && result.validation) {
      updateItem(result.validation); // décision flippée → change de liste
      setFlash(result.message);
    } else {
      setFlash(result.message);
    }
    window.setTimeout(() => setFlash(null), 3500);
  };

  const onConfirm = async (v: PendingValidation) => {
    // Optimiste.
    updateItem({ ...v, confirmed: true });
    try {
      const res = await fetch(`/api/validations/${encodeURIComponent(v.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) {
        updateItem({ ...v, confirmed: false });
        setFlash(`Échec de la validation (HTTP ${res.status}).`);
      } else {
        setFlash('Décision validée — vérifiez le mail avant envoi.');
      }
    } catch {
      updateItem({ ...v, confirmed: false });
      setFlash('Erreur réseau — validation non enregistrée.');
    }
    window.setTimeout(() => setFlash(null), 3500);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="font-body text-[13px] text-stone-600">
          <strong className="font-semibold">{items.length}</strong> action
          {items.length > 1 ? 's' : ''} en attente.
        </p>
      </div>
      {flash ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 font-body">
          {flash}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ValidationColumn
          title="Refusés par le système"
          accent="rose"
          items={rejected}
          onConfirm={onConfirm}
          onSent={onSent}
          onSwitch={onSwitch}
        />
        <ValidationColumn
          title="Acceptés par le système"
          accent="emerald"
          items={accepted}
          onConfirm={onConfirm}
          onSent={onSent}
          onSwitch={onSwitch}
        />
      </div>
    </div>
  );
}

function ValidationColumn({
  title,
  accent,
  items,
  onConfirm,
  onSent,
  onSwitch,
}: {
  title: string;
  accent: 'rose' | 'emerald';
  items: PendingValidation[];
  onConfirm: (v: PendingValidation) => void;
  onSent: (v: PendingValidation, message: string) => void;
  onSwitch: (v: PendingValidation) => void;
}) {
  const dot = accent === 'rose' ? 'bg-rose-500' : 'bg-emerald-500';
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <h2 className="font-display text-[15px] font-bold text-stone-900">
          {title}
        </h2>
        <span className="font-body text-[12px] text-stone-500">
          ({items.length})
        </span>
      </div>
      {items.length === 0 ? (
        <p className="font-body text-[13px] text-stone-400 italic rounded-lg border border-dashed border-stone-200 px-4 py-6 text-center">
          Aucune validation en attente.
        </p>
      ) : (
        items.map((v) => (
          <ValidationCard
            key={`${v.id}-${v.decision}`}
            v={v}
            onConfirm={onConfirm}
            onSent={onSent}
            onSwitch={onSwitch}
          />
        ))
      )}
    </section>
  );
}

function ValidationCard({
  v,
  onConfirm,
  onSent,
  onSwitch,
}: {
  v: PendingValidation;
  onConfirm: (v: PendingValidation) => void;
  onSent: (v: PendingValidation, message: string) => void;
  onSwitch: (v: PendingValidation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [subject, setSubject] = useState(payloadString(v, 'mailSubject') ?? '');
  const [body, setBody] = useState(payloadString(v, 'mailBody') ?? '');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // L'ouverture de l'éditeur RECOMPOSE la base depuis le template courant (et
  // non le snapshot figé à la préparation), sauf si le DRH a déjà commencé à
  // éditer (on ne piétine pas ses modifications).
  const [draftLoading, setDraftLoading] = useState(false);
  const editedRef = useRef(false);
  // Garde de réentrance SYNCHRONE de l'envoi. `disabled={sending}` ne suffit
  // pas : `setSending(true)` n'est appliqué qu'au re-render suivant, donc un
  // double-clic rapide rappelle `onSend` avant et envoie le mail DEUX fois
  // (l'étape mail-composer n'est pas idempotente). Le ref bloque dès le 1er clic.
  const sendingRef = useRef(false);
  const canSend =
    subject.trim().length > 0 && body.trim().length > 0 && !draftLoading;

  useEffect(() => {
    if (!open || editedRef.current) return;
    const candidate = v.payload?.candidate;
    if (!candidate) return; // rien à recomposer → on garde le snapshot
    const mode = v.decision === 'accept' ? 'invite' : 'reject';
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
          const data = (await res.json()) as {
            subject?: string;
            html?: string;
          };
          if (data.subject != null) setSubject(data.subject);
          if (data.html != null) setBody(data.html);
        }
      } catch {
        // Échec réseau → on garde le snapshot existant comme base.
      } finally {
        if (!cancelled) setDraftLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, v]);

  // Contexte de la candidature.
  const jobTitle = payloadString(v, 'jobTitle');
  const summary = payloadString(v, 'summary') ?? candidateSummary(v);
  // Liens artefacts (résolus depuis le store, hydraté par campagne).
  const reportArtifact = useArtifactsStore((s) =>
    v.reportArtifactId ? s.byId[v.reportArtifactId] : undefined,
  );
  const fdpArtifact = useArtifactsStore((s) =>
    Object.values(s.byId).find(
      (a) => a.campaignId === v.campaignId && a.kind === 'fdp',
    ),
  );

  const onSend = async () => {
    // Anti double-soumission : un envoi déjà en vol → on ignore ce clic.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const result = await sendValidation(v, { subject, html: body });
      if (result.ok) {
        onSent(v, result.message);
      } else {
        setSendError(result.message);
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
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
          <span className="flex-shrink-0 rounded-full bg-stone-100 px-2.5 py-1 font-data text-[12px] font-bold text-stone-700">
            {v.score}/100
          </span>
        ) : null}
      </div>

      {/* Contexte de la candidature : poste, synthèse, accès rapport + FDP. */}
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
          onClick={() => onConfirm(v)}
          disabled={v.confirmed}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-body font-semibold ${
            v.confirmed
              ? 'bg-emerald-100 text-emerald-700 cursor-default'
              : 'bg-stone-800 text-white hover:bg-stone-700'
          }`}
        >
          {v.confirmed ? '✓ Décision validée' : 'Valider la décision'}
        </button>

        <button
          type="button"
          onClick={async () => {
            setSwitching(true);
            await onSwitch(v);
            setSwitching(false);
          }}
          disabled={switching}
          title={
            v.decision === 'reject'
              ? 'Basculer en acceptation'
              : 'Basculer en refus'
          }
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-[12px] font-body font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {switching
            ? 'Bascule…'
            : v.decision === 'reject'
              ? 'Switcher → accepter'
              : 'Switcher → refuser'}
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!v.confirmed}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-body font-semibold ${
            v.confirmed
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-stone-100 text-stone-400 cursor-not-allowed'
          }`}
        >
          Vérifier le mail
        </button>
      </div>

      {open && v.confirmed ? (
        <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
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
                <p className="mt-2 font-body text-[12px] text-rose-600">
                  {sendError}
                </p>
              ) : null}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend || sending}
                  className={`rounded-lg px-4 py-1.5 text-[12px] font-body font-semibold ${
                    canSend && !sending
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  }`}
                >
                  {sending ? 'Envoi…' : 'Envoyer'}
                </button>
              </div>
            </>
          ) : (
            <p className="font-body text-[12px] text-stone-400 italic">
              Brouillon indisponible (service email non configuré au moment de
              la rédaction). Réactivez le service puis relancez l&apos;analyse.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
