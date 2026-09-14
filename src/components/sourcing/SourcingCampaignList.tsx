'use client';

import { ReferentMention } from '@/components/referent/ReferentMention';
import type { SourcingCampaignSummary } from '@/types/sourcing';

function lastSearchLabel(iso: string | null): string {
  if (!iso) return 'jamais sourcée';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'dernière recherche aujourd’hui';
  return `dernière recherche il y a ${days} j`;
}

export function SourcingCampaignList({
  campaigns,
  myApproachesThisMonth,
  onSource,
}: {
  campaigns: SourcingCampaignSummary[];
  myApproachesThisMonth: number;
  onSource: (campaignId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="font-body text-[13px] text-stone-600">
        Mes approches ce mois :{' '}
        <span className="font-data font-semibold text-stone-800">{myApproachesThisMonth}</span>
      </p>

      {campaigns.length === 0 ? (
        <p className="font-body text-[13px] italic text-stone-400">
          Aucune campagne active. Le sourcing s’ouvre sur une campagne activée : c’est elle qui
          recevra et traitera les candidatures.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {campaigns.map((c) => {
            // Déjà sourcée (au moins une recherche) : on y revient pour le DÉTAIL, pas pour relancer.
            const sourced = c.lastSearchAt !== null;
            return (
            <li
              key={c.campaignId}
              data-sourced={sourced}
              className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5"
              style={
                sourced
                  ? { backgroundColor: 'var(--dash-orange-light)', borderColor: 'var(--dash-border)', borderLeft: '3px solid var(--dash-orange)' }
                  : { backgroundColor: 'white', borderColor: 'var(--dash-border)' }
              }
            >
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 font-body text-[13.5px] font-semibold text-stone-800">
                  <span className="truncate">
                    <span className="font-data text-stone-600">{c.campaignId}</span> · {c.name}
                  </span>
                  {sourced ? (
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold" style={{ color: 'var(--dash-orange)' }}>
                      Sourcée
                    </span>
                  ) : null}
                </p>
                <p className="truncate font-body text-[12px] text-stone-500">
                  <ReferentMention referent={c.referent} />
                  {' · '}
                  {c.seen} vu{c.seen > 1 ? 's' : ''} · {c.approached} approché{c.approached > 1 ? 's' : ''} ·{' '}
                  {c.manifested} manifesté{c.manifested > 1 ? 's' : ''} · {lastSearchLabel(c.lastSearchAt)}
                </p>
              </div>
              {sourced ? (
                <button
                  type="button"
                  onClick={() => onSource(c.campaignId)}
                  className="rounded-md border border-stone-400 bg-white px-3 py-1 font-body text-[12px] font-semibold text-stone-800 hover:bg-stone-50"
                >
                  Détail
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSource(c.campaignId)}
                  className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1 font-body text-[12px] font-semibold text-white hover:bg-stone-800"
                >
                  Sourcer
                </button>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
