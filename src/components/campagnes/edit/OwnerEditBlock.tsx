'use client';

/**
 * Bloc « Recruteur référent » d'une campagne (multi-utilisateur). Le référent
 * choisi porte l'agenda des entretiens : son lien Cal.com personnel en régime
 * historique, ses disponibilités en réservation native.
 *
 * En réservation native, changer de référent a un EFFET IMMÉDIAT sur des liens
 * déjà envoyés : ils basculent tous sur le nouvel agenda, sans réémission. On
 * montre donc l'impact AVANT d'écrire — même geste que le dialog de clôture
 * sans-suite. Et on dit aussi ce qui NE bouge pas : les rendez-vous déjà pris
 * restent chez l'ancien référent, parce qu'un rendez-vous est un engagement.
 *
 * L'écriture passe par le PATCH ciblé (et non le snapshot du store) : c'est le
 * seul chemin qui re-pointe la cible de réservation dans la foulée.
 */

import { useEffect, useState } from 'react';

import { useCampaignsStore } from '@/stores/campaigns-store';

import { OwnerChangeDialog, type TargetImpact } from './OwnerChangeDialog';

type RecruiterOption = {
  id: string;
  displayName: string;
  hasCalcomLink: boolean;
  /** `null` = indéterminé (module de réservation injoignable). */
  hasAvailability: boolean | null;
};

export function OwnerEditBlock({ campaignId }: { campaignId: string }) {
  const ownerUserId = useCampaignsStore(
    (s) => s.byId[campaignId]?.ownerUserId ?? null,
  );
  const native = useCampaignsStore(
    (s) => s.byId[campaignId]?.schedulingNative ?? false,
  );
  const setOwner = useCampaignsStore((s) => s.setOwner);
  const [options, setOptions] = useState<RecruiterOption[] | null>(null);
  const [pending, setPending] = useState<{ id: string | null; impact: TargetImpact } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

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
  const missingLink = !native && selected !== null && !selected.hasCalcomLink;

  /** Demande l'impact puis ouvre le dialog — ou applique directement si nul. */
  async function requestChange(nextId: string | null) {
    setError(null);
    let impact: TargetImpact = { native: false, activeLinks: 0, bookings: [] };
    try {
      const res = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/scheduling`,
        { cache: 'no-store' },
      );
      if (res.ok) impact = (await res.json()) as TargetImpact;
    } catch {
      // Impact indisponible : on ne bloque pas le changement, on le confirme
      // quand même — l'écran dira simplement qu'il ne sait pas.
    }
    const next = (options ?? []).find((o) => o.id === nextId) ?? null;
    const warns = impact.native && next?.hasAvailability === false;
    // Impact nul ET rien à signaler : on applique sans faire cliquer pour rien.
    if (impact.activeLinks === 0 && impact.bookings.length === 0 && !warns) {
      await apply(nextId);
      return;
    }
    setPending({ id: nextId, impact });
  }

  async function apply(nextId: string | null) {
    setPending(null);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUserId: nextId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? 'Le changement de référent n’a pas abouti.');
        return;
      }
      setOwner(campaignId, nextId);
    } catch {
      setError('Erreur réseau — le référent n’a pas été changé.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p className="font-body" style={{ fontSize: 12.5, color: 'var(--dash-text-secondary)' }}>
        {native
          ? 'Les candidats réservent sur les disponibilités du référent. Changer de référent bascule les liens déjà envoyés ; les rendez-vous déjà pris ne bougent pas.'
          : 'Les invitations d’entretien de cette campagne utilisent l’agenda Cal.com personnel du référent. Sans référent (ou sans lien renseigné), le lien global des paramètres s’applique.'}
      </p>
      <select
        value={ownerUserId ?? ''}
        onChange={(e) => void requestChange(e.currentTarget.value || null)}
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
            {native
              ? o.hasAvailability === false
                ? ' (sans disponibilités)'
                : ''
              : o.hasCalcomLink
                ? ''
                : ' (sans lien Cal.com)'}
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
      {native && selected?.hasAvailability === false ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          Ce recruteur n&apos;a aucune disponibilité déclarée : les liens de
          réservation de cette campagne affichent « momentanément indisponible »
          et les prochaines invitations sont bloquées (Paramètres → Agendas
          &amp; disponibilités).
        </p>
      ) : null}
      {ownerUserId && options !== null && selected === null ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          Le référent actuel n&apos;est plus actif — les invitations utilisent
          le lien global. Choisissez un remplaçant.
        </p>
      ) : null}
      {error ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-red)' }}>
          {error}
        </p>
      ) : null}
      {pending ? (
        <OwnerChangeDialog
          impact={pending.impact}
          nextName={
            pending.id
              ? ((options ?? []).find((o) => o.id === pending.id)?.displayName ??
                'ce recruteur')
              : 'personne (aucun référent)'
          }
          nextHasAvailability={
            (options ?? []).find((o) => o.id === pending.id)?.hasAvailability ?? null
          }
          onCancel={() => setPending(null)}
          onConfirm={() => void apply(pending.id)}
        />
      ) : null}
    </div>
  );
}
