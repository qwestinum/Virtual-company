'use client';

/**
 * Bloc « Recruteur référent » d'une campagne (multi-utilisateur). Le référent
 * choisi voit SON agenda Cal.com utilisé pour les invitations d'entretien de
 * cette campagne (repli explicite : lien global des paramètres). Options =
 * recruteurs ACTIFS (/api/recruiters/options — projection minimale, accessible
 * à toute session). Persistance via le store (PUT snapshot debouncé).
 */

import { useEffect, useState } from 'react';

import { useCampaignsStore } from '@/stores/campaigns-store';

type RecruiterOption = { id: string; displayName: string; hasCalcomLink: boolean };

export function OwnerEditBlock({ campaignId }: { campaignId: string }) {
  const ownerUserId = useCampaignsStore(
    (s) => s.byId[campaignId]?.ownerUserId ?? null,
  );
  const setOwner = useCampaignsStore((s) => s.setOwner);
  const [options, setOptions] = useState<RecruiterOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/recruiters/options', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { options?: RecruiterOption[] };
        if (!cancelled) setOptions(json.options ?? []);
      } catch {
        if (!cancelled) setOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = options?.find((o) => o.id === ownerUserId) ?? null;
  const missingLink = selected !== null && !selected.hasCalcomLink;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p className="font-body" style={{ fontSize: 12.5, color: 'var(--dash-text-secondary)' }}>
        Les invitations d&apos;entretien de cette campagne utiliseront
        l&apos;agenda Cal.com personnel du référent. Sans référent (ou sans
        lien renseigné), le lien global des paramètres s&apos;applique.
      </p>
      <select
        value={ownerUserId ?? ''}
        onChange={(e) => setOwner(campaignId, e.currentTarget.value || null)}
        disabled={options === null}
        className="font-body"
        style={{
          height: 38,
          borderRadius: 8,
          border: '1px solid var(--dash-border)',
          background: 'white',
          padding: '0 10px',
          fontSize: 13,
        }}
      >
        <option value="">— Aucun (agenda global)</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.displayName}
            {o.hasCalcomLink ? '' : ' (sans lien Cal.com)'}
          </option>
        ))}
      </select>
      {missingLink ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          Ce recruteur n&apos;a pas encore de lien Cal.com — les invitations
          utiliseront le lien global en attendant (à renseigner dans
          Paramètres → Recruteurs).
        </p>
      ) : null}
      {ownerUserId && options !== null && selected === null ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          Le référent actuel n&apos;est plus actif — les invitations utilisent
          le lien global. Choisissez un remplaçant.
        </p>
      ) : null}
    </div>
  );
}
