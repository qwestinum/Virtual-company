'use client';

/**
 * Répartition des candidatures par zone de décision (Bureau — récit
 * « Process First »). Identité ORQA. Vocabulaire NEUTRE et factuel : le système
 * répartit (auto) et défère la zone grise à l'humain — pas de « repêchage » ni
 * « arbitrage ».
 *
 * Comptage EXHAUSTIF fourni par `DashboardData.zones` (signaux fiables :
 * status + decided_by + file pending_validations — cf. zone-counts.ts ; PAS
 * decision_zone, peu fiable sur l'historique). Affichage propre à 0 : pas de
 * division par zéro, le % n'apparaît QUE si total > 0.
 */

import type { ZoneCounts } from '@/lib/dashboard/derive-metrics';

type ZoneRow = {
  key: keyof Omit<ZoneCounts, 'total'>;
  label: string;
  dot: string;
  text: string;
};

const ZONES: ZoneRow[] = [
  { key: 'autoReject', label: 'Refusés automatiquement', dot: 'bg-orqa-rouge', text: 'text-orqa-rouge' },
  { key: 'autoAccept', label: 'Acceptés automatiquement', dot: 'bg-orqa-vert', text: 'text-orqa-vert' },
  { key: 'humanValidated', label: 'Validés par un humain', dot: 'bg-orqa-ciel', text: 'text-orqa-ciel' },
  { key: 'pending', label: 'En attente de validation', dot: 'bg-orqa-ambre', text: 'text-orqa-ambre' },
];

export function ZoneDistribution({ zones }: { zones: ZoneCounts }) {
  const { total } = zones;
  return (
    <section className="rounded-[14px] border border-orqa-ligne bg-white p-4 shadow-orqa">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <h3 className="font-fraunces text-[16px] font-semibold text-orqa-nuit">
          Répartition
        </h3>
        <span className="font-data text-[11px] text-orqa-gris-clair">
          {total} candidature{total > 1 ? 's' : ''}
        </span>
      </div>
      <p className="mb-3 font-inter text-[11.5px] text-orqa-gris">
        Ce que la solution traite pour vous.
      </p>

      <ul className="flex flex-col gap-2.5">
        {ZONES.map((z) => {
          const n = zones[z.key];
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <li key={z.key}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-inter text-[12.5px] text-orqa-encre">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${z.dot}`} />
                  {z.label}
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span className={`font-data text-[14px] font-medium ${z.text}`}>
                    {n}
                  </span>
                  {total > 0 ? (
                    <span className="font-data text-[10.5px] text-orqa-gris-clair">
                      {pct}%
                    </span>
                  ) : null}
                </span>
              </div>
              {/* Barre de proportion — pleine seulement si total > 0. */}
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-orqa-brume2">
                <div
                  className={`h-full rounded-full ${z.dot}`}
                  style={{ width: total > 0 ? `${pct}%` : '0%' }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {total === 0 ? (
        <p className="mt-3 font-inter text-[11.5px] italic text-orqa-gris-clair">
          Aucune candidature analysée pour l&apos;instant — la répartition
          s&apos;affichera dès les premiers CV traités.
        </p>
      ) : null}
    </section>
  );
}
