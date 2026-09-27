'use client';

/**
 * « L'entretien a-t-il eu lieu ? » — deux réponses explicites.
 *
 * Elles remplacent un bouton « Répondre » qui ne disait pas ce qu'on allait
 * répondre, et qui servait AUSSI à donner son verdict : deux gestes sous un
 * même mot.
 *
 * ⚠️ ASYMÉTRIE VOULUE, et elle n'est pas négociable. « Oui » est un CONSTAT :
 * il se pose d'ici, directement. « Non » est une DÉCISION — un entretien
 * manqué dérive vers « non retenu » — et le produit impose un dialogue avant
 * de la poser (classer non retenu, ou reproposer un créneau). Ce dialogue vit
 * dans Entretiens ; « Non » y emmène donc au lieu de trancher à sa place.
 * Poser le marqueur d'ici écarterait un candidat en un clic, sans que personne
 * n'ait choisi entre les deux suites possibles.
 */

import { useState } from 'react';

import { ActionButton } from '@/components/campagnes/ActionButton';
import { markCandidateInterview } from '@/lib/dashboard/candidate-actions';
import { PHRASES } from '@/lib/lexique/phrases-ecran';

export function ConfirmInterviewButtons({
  uid,
  candidateName,
  campaignId,
  href,
  onDone,
}: {
  uid: string | null;
  candidateName: string;
  campaignId: string | null;
  /** Où va « Non » : l'écran qui porte le dialogue. */
  href: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // Sans identité de candidature, on ne pose rien : les deux réponses
  // emmènent alors vers l'écran qui sait résoudre le dossier.
  if (!uid) {
    return (
      <ActionButton href={href} label={PHRASES.aConfirmer.question} />
    );
  }

  const confirmer = async (): Promise<void> => {
    setBusy(true);
    try {
      await markCandidateInterview({
        uid,
        candidateName,
        campaignId,
        status: 'realized',
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <ActionButton
        variant="success"
        label={busy ? 'Enregistrement…' : PHRASES.aConfirmer.oui}
        onClick={() => void confirmer()}
        disabled={busy}
      />
      <ActionButton href={href} label={PHRASES.aConfirmer.non} />
    </span>
  );
}
