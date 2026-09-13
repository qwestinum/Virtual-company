'use client';

/**
 * Écrans terminaux de la page d'atterrissage (spec §14.6) : candidature
 * envoyée, bien reçue (analyse différée), offre fermée, opposition enregistrée.
 * Chacun offre une sortie — tentée, avec un repli dit en toutes lettres.
 */

import { useState } from 'react';

export type Outcome =
  | { kind: 'sent'; firstName: string; recruiterName: string | null }
  | { kind: 'received'; firstName: string }
  | { kind: 'closed' }
  | { kind: 'opposed' };

export function LandingOutcome({ outcome, organizationName, privacyContact }: { outcome: Outcome; organizationName: string | null; privacyContact: string | null }) {
  const dataLine = (
    <p className="font-body text-[12.5px] text-stone-500">
      Vos données : utilisées pour ce recrutement{privacyContact ? ` · ${privacyContact}` : ''}
    </p>
  );
  return (
    <section className="flex flex-col gap-3 py-4" data-outcome={outcome.kind}>
      {outcome.kind === 'sent' || outcome.kind === 'received' ? (
        <>
          <h1 className="font-display text-[19px] font-bold text-stone-900">
            ✓ Merci{outcome.firstName ? ` ${outcome.firstName}` : ''}, votre candidature est bien reçue.
          </h1>
          <p className="font-body text-[14px] text-stone-700">
            {outcome.kind === 'sent'
              ? `Vous allez recevoir un email pour choisir un créneau d’entretien${outcome.recruiterName ? ` avec ${outcome.recruiterName}` : ''}.`
              : 'Nous revenons vers vous par email très prochainement.'}
          </p>
          {dataLine}
        </>
      ) : outcome.kind === 'closed' ? (
        <h1 className="font-display text-[19px] font-bold text-stone-900">Cette offre n’est plus ouverte.</h1>
      ) : (
        <>
          <h1 className="font-display text-[19px] font-bold text-stone-900">C’est noté.</h1>
          <p className="font-body text-[14px] text-stone-700">
            Vos données de profil ont été supprimées et vous ne serez plus contacté·e pour les recrutements
            {organizationName ? ` de ${organizationName}` : ''}. Seule une empreinte technique, qui ne permet pas de
            vous identifier, est conservée pour garantir ce choix.
          </p>
        </>
      )}
      <CloseButton />
    </section>
  );
}

function CloseButton() {
  const [refused, setRefused] = useState(false);
  if (refused) return <p className="font-body text-[13px] text-stone-500">Vous pouvez fermer cet onglet.</p>;
  return (
    <button
      type="button"
      className="self-end rounded-lg border border-stone-300 px-4 py-1.5 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-50"
      onClick={() => {
        window.close();
        window.setTimeout(() => setRefused(true), 250);
      }}
    >
      Fermer
    </button>
  );
}
