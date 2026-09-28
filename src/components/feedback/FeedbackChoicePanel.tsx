'use client';

/**
 * « Informer le candidat » — le choix OBLIGATOIRE posé avec une décision qui
 * clôt une candidature (retenu, non retenu, absent, sans suite).
 * feat/feedback-candidat (28/09/2026).
 *
 * Deux issues, aucune pré-sélectionnée : envoyer le message (pré-rempli
 * depuis les Réglages, relu, retouchable) ou prévenir soi-même (canal
 * déclaré). Tant que le choix est incomplet, `onChange(null)` : l'hôte garde
 * son bouton de décision désarmé. La route refuse de toute façon une décision
 * sans ce choix — l'écran ne fait que le rendre visible.
 *
 * Monté avec une `key` par type de message : changer de verdict repart d'un
 * brouillon neuf (un « retenu » retouché ne devient jamais un « non retenu »).
 */

import { useEffect, useId, useState } from 'react';

import {
  applyProposal,
  draftToChoice,
  emptyFeedbackDraft,
  sendUnavailableReason,
  type FeedbackDraft,
} from '@/lib/candidatures/feedback-draft';
import type {
  FeedbackChoice,
  FeedbackKind,
  FeedbackProposal,
} from '@/types/candidate-feedback';
import type { DismissalReason } from '@/types/dismissal';

import { FeedbackMessageEditor } from './FeedbackMessageEditor';
import { FeedbackSelfChannel } from './FeedbackSelfChannel';

export function FeedbackChoicePanel({
  analysisId,
  kind,
  reason,
  disabled,
  onChange,
}: {
  analysisId: string;
  kind: FeedbackKind;
  /** Raison d'un « sans suite » — alimente [motif]. */
  reason?: DismissalReason;
  disabled: boolean;
  onChange: (choice: FeedbackChoice | null) => void;
}) {
  const [proposal, setProposal] = useState<FeedbackProposal | null>(null);
  const [draft, setDraft] = useState<FeedbackDraft>(emptyFeedbackDraft);
  const [loadError, setLoadError] = useState(false);
  const groupName = useId();

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ kind, ...(reason ? { reason } : {}) });
    fetch(`/api/candidatures/${encodeURIComponent(analysisId)}/feedback-proposal?${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as FeedbackProposal;
      })
      .then((p) => {
        if (!alive) return;
        setProposal(p);
        setDraft((d) => applyProposal(d, p));
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [analysisId, kind, reason]);

  function update(next: FeedbackDraft) {
    setDraft(next);
    onChange(draftToChoice(next, proposal));
  }

  const sendBlocked = proposal ? sendUnavailableReason(proposal) : 'loading';

  return (
    <section
      data-role="feedback-choice"
      className="flex flex-col gap-2 rounded-xl border border-l-4 border-emerald-200 border-l-emerald-600 bg-emerald-50/60 p-3"
    >
      <h4 className="font-display text-[14px] font-bold text-emerald-950">
        Informer le candidat <span className="font-body text-[12px] font-normal text-stone-600">(obligatoire)</span>
      </h4>
      {proposal?.alreadyInformed ? (
        <p className="font-body text-[12px] text-stone-700">
          Un message de ce type l’a déjà informé le{' '}
          {new Date(proposal.alreadyInformed.at).toLocaleDateString('fr-FR')} : rien ne repartira.
          Indiquez comment vous le prévenez de nouveau, le cas échéant.
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" className="font-body text-[12px] text-rose-700">
          Le message proposé n’a pas pu être chargé. Vous pouvez prévenir le candidat vous-même.
        </p>
      ) : null}

      <div role="radiogroup" aria-label="Comment le candidat est-il informé ?" className="flex flex-col gap-2">
        <ModeOption
          name={groupName}
          value="send"
          checked={draft.mode === 'send'}
          disabled={disabled || sendBlocked !== null}
          onSelect={() => update({ ...draft, mode: 'send' })}
          title="Envoyer ce message"
          detail={
            sendBlocked === 'no_email'
              ? 'Aucune adresse n’est connue pour ce candidat.'
              : sendBlocked === 'loading'
                ? 'Chargement du message proposé…'
                : 'Signé de vous ; ses réponses arrivent dans votre messagerie.'
          }
        />
        {draft.mode === 'send' && proposal ? (
          <FeedbackMessageEditor
            kind={kind}
            draft={draft}
            proposal={proposal}
            disabled={disabled}
            onChange={update}
          />
        ) : null}
        <ModeOption
          name={groupName}
          value="self"
          checked={draft.mode === 'self'}
          disabled={disabled}
          onSelect={() => update({ ...draft, mode: 'self' })}
          title="Je préviens moi-même"
          detail="Aucun message ne part ; le canal est noté au dossier."
        />
        {draft.mode === 'self' ? (
          <FeedbackSelfChannel draft={draft} disabled={disabled} onChange={update} />
        ) : null}
      </div>
    </section>
  );
}

function ModeOption({
  name,
  value,
  checked,
  disabled,
  onSelect,
  title,
  detail,
}: {
  name: string;
  value: 'send' | 'self';
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={`flex gap-2.5 rounded-lg border bg-white px-3 py-2 ${
        checked ? 'border-emerald-500' : 'border-stone-200'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        data-feedback-mode={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5"
      />
      <span>
        <span className="block font-body text-[13px] font-semibold text-stone-800">{title}</span>
        <span className="block font-body text-[12px] text-stone-600">{detail}</span>
      </span>
    </label>
  );
}
