'use client';

/**
 * Bloc « Flux » — sources de réception des CV pour une campagne
 * (Session 6 v3).
 *
 * Distinct des canaux de diffusion d'annonces : ici on configure d'où
 * arrivent les candidatures. Chaque toggle est appliqué immédiatement
 * via `setSources`. Le DRH voit aussi un état « opérationnel /
 * placeholder » pour chaque source pour ne pas se faire surprendre par
 * un canal qui n'est pas encore branché côté serveur.
 *
 * Cas particulier — flux email : il **exige** au moins une boîte mail
 * associée (configurée dans /settings/mailboxes). Le picker apparaît
 * sous le toggle dès qu'il est activé, et un avertissement reste
 * affiché tant qu'aucune mailbox n'est cochée.
 */

import { useEffect, useState } from 'react';

import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import {
  CV_SOURCES,
  CV_SOURCE_HINTS,
  CV_SOURCE_LABELS,
  CV_SOURCE_OPERATIONAL,
  type CVSource,
} from '@/types/cv-source';

import { MailboxPicker } from './MailboxPicker';
import { SaveBanner } from './SaveBanner';

const FLASH_MS = 3000;

export type FluxEditBlockProps = {
  campaign: ActiveCampaign;
};

export function FluxEditBlock({ campaign }: FluxEditBlockProps) {
  const setSources = useCampaignsStore((s) => s.setSources);
  const [flash, setFlash] = useState<string | null>(null);

  // Mailboxes associées à la campagne (chargées au mount).
  const [mailboxIds, setMailboxIds] = useState<string[]>([]);
  const [mailboxesLoaded, setMailboxesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/campaigns/${encodeURIComponent(campaign.id)}/mailboxes`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setMailboxesLoaded(true);
          return;
        }
        const json = (await res.json()) as { mailboxIds?: string[] };
        if (!cancelled) {
          setMailboxIds(json.mailboxIds ?? []);
          setMailboxesLoaded(true);
        }
      } catch {
        if (!cancelled) setMailboxesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign.id]);

  const isActive = (source: CVSource) => campaign.sources.includes(source);

  const toggle = (source: CVSource) => {
    const enabled = !isActive(source);
    const next = enabled
      ? [...campaign.sources, source]
      : campaign.sources.filter((s) => s !== source);
    setSources(campaign.id, next);
    pushManagerAcknowledgment({
      kind: 'channel_toggled',
      campaignId: campaign.id,
      campaignName: campaign.name,
      channel: `flux ${CV_SOURCE_LABELS[source]}`,
      enabled,
    });
    setFlash(
      enabled
        ? `Flux ${CV_SOURCE_LABELS[source]} activé — les nouveaux CV arrivés par ce canal seront traités.`
        : `Flux ${CV_SOURCE_LABELS[source]} désactivé — les CV reçus via ce canal ne seront plus traités automatiquement.`,
    );
    window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  const onMailboxesChange = async (next: string[]) => {
    const previous = mailboxIds;
    setMailboxIds(next); // optimiste
    const toAdd = next.filter((id) => !previous.includes(id));
    const toRemove = previous.filter((id) => !next.includes(id));
    try {
      await Promise.all([
        ...toAdd.map((id) =>
          fetch(`/api/mailboxes/${encodeURIComponent(id)}/associate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaignId: campaign.id }),
          }),
        ),
        ...toRemove.map((id) =>
          fetch(
            `/api/mailboxes/${encodeURIComponent(id)}/associate?campaign_id=${encodeURIComponent(campaign.id)}`,
            { method: 'DELETE' },
          ),
        ),
      ]);
      const added = toAdd.length;
      const removed = toRemove.length;
      if (added > 0 || removed > 0) {
        const parts: string[] = [];
        if (added > 0)
          parts.push(`${added} boîte${added > 1 ? 's' : ''} associée${added > 1 ? 's' : ''}`);
        if (removed > 0)
          parts.push(
            `${removed} boîte${removed > 1 ? 's' : ''} retirée${removed > 1 ? 's' : ''}`,
          );
        setFlash(`Mailboxes mises à jour : ${parts.join(', ')}.`);
        window.setTimeout(() => setFlash(null), FLASH_MS);
      }
    } catch {
      // En cas d'échec, on revient à l'état précédent côté UI.
      setMailboxIds(previous);
    }
  };

  return (
    <div>
      <SaveBanner message={flash} />
      <p
        className="font-body"
        style={{
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          marginBottom: 10,
        }}
      >
        Sélectionnez les canaux par lesquels les CV peuvent arriver pour cette
        campagne. Distinct de la diffusion d&apos;annonce — ici, c&apos;est
        l&apos;entrée.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CV_SOURCES.map((source) => {
          const enabled = isActive(source);
          const operational = CV_SOURCE_OPERATIONAL[source];
          return (
            <div key={source}>
              <button
                type="button"
                onClick={() => toggle(source)}
                aria-pressed={enabled}
                className="font-body"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1px solid ${enabled ? 'var(--dash-green)' : 'var(--dash-border)'}`,
                  background: enabled
                    ? 'var(--dash-green-light)'
                    : 'var(--dash-warm)',
                  color: enabled
                    ? 'var(--dash-green)'
                    : 'var(--dash-text-secondary)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span
                  style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  <span>
                    {CV_SOURCE_LABELS[source]}
                    {!operational ? (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          color: 'var(--dash-text-tertiary)',
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        à brancher
                      </span>
                    ) : null}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: enabled
                        ? 'var(--dash-green)'
                        : 'var(--dash-text-tertiary)',
                    }}
                  >
                    {CV_SOURCE_HINTS[source]}
                  </span>
                </span>
                <ToggleSwitch on={enabled} />
              </button>
              {source === 'email' && enabled && mailboxesLoaded ? (
                <div
                  style={{
                    margin: '8px 0 4px',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px dashed var(--dash-border-strong)',
                    background: 'var(--dash-surface)',
                  }}
                >
                  <p
                    className="font-body"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--dash-text-secondary)',
                      margin: '0 0 8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Boîtes mail associées
                  </p>
                  <MailboxPicker
                    selectedIds={mailboxIds}
                    onChange={onMailboxesChange}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        width: 34,
        height: 18,
        borderRadius: 999,
        background: on ? 'var(--dash-green)' : 'var(--dash-border-strong)',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </span>
  );
}
