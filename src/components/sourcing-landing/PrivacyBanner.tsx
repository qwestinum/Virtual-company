'use client';

/**
 * Information art. 14 — la personne n'a pas fourni ces données, on lui dit
 * d'où elles viennent, combien de temps elles restent, qui en répond, et
 * comment dire non (spec §9.2). Le « non » est une opposition GLOBALE : il se
 * confirme avant de partir.
 */

import { useState } from 'react';

export function PrivacyBanner({
  token,
  organizationName,
  privacyContact,
  prefilled,
  onOpposed,
}: {
  token: string;
  organizationName: string | null;
  privacyContact: string | null;
  prefilled: boolean;
  onOpposed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oppose = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sourcing/approach/${encodeURIComponent(token)}/oppose`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { outcome?: string; message?: string } | null;
      if (res.ok && data?.outcome === 'opposed') return onOpposed();
      setError(data?.message ?? 'Votre demande n’a pas pu être enregistrée. Merci de réessayer.');
    } catch {
      setError('Votre demande n’a pas pu être enregistrée. Merci de réessayer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3" data-testid="privacy-banner">
      <p className="font-body text-[12px] font-semibold uppercase tracking-wide text-stone-500">Information</p>
      <p className="font-body text-[13px] text-stone-700">
        {prefilled ? 'Pré-rempli à partir de votre profil professionnel public · ' : ''}
        supprimé à la clôture de ce recrutement
        {organizationName ? ` · responsable de traitement : ${organizationName}` : ''}
        {privacyContact ? ` · contact : ${privacyContact}` : ''}
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-body text-[13px] text-stone-700">Vos données de profil seront supprimées et vous ne serez plus contacté·e.</span>
          <button type="button" disabled={busy} onClick={oppose} className="rounded-md border border-stone-400 bg-white px-3 py-1 font-body text-[13px] font-semibold text-stone-800 disabled:opacity-50">
            Confirmer
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="font-body text-[13px] text-stone-500 underline">
            Annuler
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="self-start font-body text-[13px] font-semibold text-stone-700 underline">
          Je ne souhaite pas être recontacté·e
        </button>
      )}
      {error ? <p className="font-body text-[12.5px] text-red-700">{error}</p> : null}
    </aside>
  );
}
