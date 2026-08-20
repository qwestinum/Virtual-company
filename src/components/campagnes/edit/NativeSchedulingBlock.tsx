'use client';

/**
 * Bascule « réservation native » d'une campagne.
 *
 * Le seul interrupteur de la coexistence : OFF, la campagne continue d'envoyer
 * des liens Cal.com exactement comme avant ; ON, chaque invitation porte un
 * lien nominatif sur les disponibilités du référent.
 *
 * L'activation est GARDÉE côté serveur (référent actif avec disponibilités) —
 * l'écran ne fait que rendre lisible le refus. La désactivation, elle, n'est
 * jamais gardée : revenir au régime historique doit rester à un clic.
 */

import { useEffect, useState } from 'react';

import { MeetingLocationField } from '@/components/settings/availability/MeetingLocationField';
import type { MeetingLocation } from '@/lib/scheduling';
import { useCampaignsStore, type ActiveCampaign } from '@/stores/campaigns-store';

export function NativeSchedulingBlock({ campaign }: { campaign: ActiveCampaign }) {
  const patchLocal = useCampaignsStore((s) => s.setSchedulingNative);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Lieu PROPRE à la campagne (vit sur la cible, pas sur la ligne campagne). */
  const [override, setOverride] = useState<MeetingLocation | null>(null);
  const [savedOverride, setSavedOverride] = useState<MeetingLocation | null>(null);

  useEffect(() => {
    if (!campaign.schedulingNative) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/campaigns/${encodeURIComponent(campaign.id)}/scheduling`,
          { cache: 'no-store' },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          meetingLocationOverride: MeetingLocation | null;
        };
        setOverride(data.meetingLocationOverride);
        setSavedOverride(data.meetingLocationOverride);
      } catch {
        // Lecture KO : le champ reste vide, l'enregistrement dira pourquoi.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign.id, campaign.schedulingNative]);

  async function saveOverride() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingLocationOverride: override }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        meetingLocationSaved?: boolean | null;
      };
      // On ne se fie PAS au seul code HTTP : le serveur dit explicitement si
      // le lieu a été écrit. Une réponse 200 sur un lieu non enregistré serait
      // le pire des deux mondes.
      if (!res.ok || data.meetingLocationSaved !== true) {
        setError(
          data.message ?? 'Le lieu de la campagne n’a pas pu être enregistré.',
        );
        return;
      }
      setSavedOverride(override);
      setError(null);
    } catch {
      setError('Erreur réseau — le lieu n’a pas été enregistré.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedulingNative: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? 'Le changement n’a pas abouti.');
        return;
      }
      patchLocal(campaign.id, next);
    } catch {
      setError('Erreur réseau — rien n’a été changé.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="font-body" style={{ fontSize: 12.5, color: 'var(--dash-text-secondary)' }}>
        {campaign.schedulingNative
          ? 'Les candidats retenus reçoivent un lien de réservation ORQA, nominatif et à usage unique, sur les disponibilités du recruteur référent.'
          : 'Les candidats retenus reçoivent le lien Cal.com configuré (référent ou paramètres généraux).'}
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="checkbox"
          checked={campaign.schedulingNative}
          disabled={busy}
          onChange={(e) => void toggle(e.currentTarget.checked)}
          style={{ width: 16, height: 16 }}
        />
        <span className="font-body" style={{ fontSize: 13, fontWeight: 600 }}>
          Réservation native ORQA
        </span>
      </label>

      {error ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          {error}
        </p>
      ) : null}

      {campaign.schedulingNative ? (
        <>
          <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}>
            Les invitations déjà envoyées avec un lien Cal.com restent valables :
            repasser en arrière ne casse rien, seules les PROCHAINES invitations
            changent de régime.
          </p>
          <div style={{ borderTop: '1px solid var(--dash-border)', paddingTop: 10 }}>
            <MeetingLocationField value={override} onChange={setOverride} />
            <p className="font-body" style={{ fontSize: 11.5, color: 'var(--dash-text-secondary)', marginTop: 6 }}>
              Renseigné, ce lieu remplace celui du référent pour CETTE campagne
              (entretien sur site client, par exemple). Les rendez-vous déjà
              pris gardent le lieu qui leur a été annoncé.
            </p>
            <button
              type="button"
              disabled={busy || JSON.stringify(override) === JSON.stringify(savedOverride)}
              onClick={() => void saveOverride()}
              className="font-body"
              style={{
                marginTop: 8,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--dash-border)',
                background: 'white',
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              Enregistrer le lieu de la campagne
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
