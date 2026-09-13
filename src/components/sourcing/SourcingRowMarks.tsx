'use client';

/**
 * Repères d'une ligne repliée (lot 3) : « En recherche », « Peut-être dans
 * votre vivier », mots de la fiche retrouvés. Des INDICES : aucun ne classe,
 * aucun ne compte, aucun ne dit « non ».
 */

import type { SourcingProfileView } from '@/types/sourcing';

const MAX_TERMS = 3;

export function SourcingRowMarks({ profile }: { profile: SourcingProfileView }) {
  const found = (profile.mentions ?? []).flatMap((m) => m.found);
  const unique = [...new Set(found)];
  return (
    <>
      {profile.state === 'contacted' ? (
        <span className="rounded-full bg-stone-800 px-2 py-0.5 font-body text-[11px] font-semibold text-white">Contacté</span>
      ) : null}
      {profile.snapshot.availability ? (
        <span
          title={`« ${profile.snapshot.availability.expression} » — indiqué sur le profil`}
          className="rounded-full bg-emerald-50 px-2 py-0.5 font-body text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
        >
          En recherche
        </span>
      ) : null}
      {profile.vivierCandidateId ? (
        <a
          href="/vivier"
          title="Même nom et même entreprise qu’un dossier du vivier — à vérifier (homonymes possibles)"
          className="rounded-full bg-sky-50 px-2 py-0.5 font-body text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100"
        >
          Peut-être dans votre vivier
        </a>
      ) : null}
      {unique.length > 0 ? (
        <span title="Mots de la fiche retrouvés dans le profil — indice de lecture, pas une évaluation" className="font-body text-[11.5px] text-stone-500">
          {unique.slice(0, MAX_TERMS).map((t) => `✓ ${t}`).join(' · ')}
          {unique.length > MAX_TERMS ? ` · +${unique.length - MAX_TERMS}` : ''}
        </span>
      ) : null}
    </>
  );
}

export function SourcingRowActions({
  profile,
  busy,
  onDecline,
  onApproach,
}: {
  profile: SourcingProfileView;
  busy: boolean;
  onDecline: (p: SourcingProfileView) => void;
  onApproach: (p: SourcingProfileView, channel: 'linkedin' | 'email') => void;
}) {
  const button =
    'rounded-md border px-2 py-0.5 font-body text-[12px] font-semibold disabled:opacity-40';
  const hasEmail = (profile.snapshot.contacts?.emails.length ?? 0) > 0;
  return (
    <>
      {profile.state === 'to_review' ? (
        <button type="button" disabled={busy} onClick={() => onDecline(profile)} className={`${button} border-stone-300 text-stone-600 hover:bg-stone-50`}>
          Décliner
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => onApproach(profile, 'linkedin')}
        className={`${button} border-stone-800 bg-stone-900 text-white hover:bg-stone-800`}
      >
        Se connecter
      </button>
      {hasEmail ? (
        <button type="button" disabled={busy} onClick={() => onApproach(profile, 'email')} className={`${button} border-stone-300 text-stone-700 hover:bg-stone-50`}>
          Contacter par email
        </button>
      ) : null}
    </>
  );
}
