'use client';

/**
 * Pied d'*Aujourd'hui* — la répartition des décisions, sur UNE ligne.
 *
 * C'est la preuve chiffrée que l'humain décide, posée là où on la voit tous
 * les jours plutôt qu'au fond d'un rapport. Elle reprend exactement les
 * catégories et la source de la répartition existante (`ZoneCounts`, servi par
 * `/api/metrics/global`) — aucune seconde comptabilité.
 *
 * ⚠️ Une PARTITION : les cinq catégories somment au total. Une catégorie
 * ajoutée à `ZoneCounts` sans être ajoutée ici ferait un total qui ne tombe
 * plus juste, en silence — d'où le tableau explicite et son test.
 */

import { DASH_COLORS, type DashColor } from '@/components/dashboard/tokens';
import type { ZoneCounts } from '@/lib/dashboard/derive-metrics';

export type TodayZoneCounts = ZoneCounts;

/** ⚠️ TABLEAU, pas un Record : une catégorie omise ne compile PAS en rouge. */
const CATEGORIES: { key: keyof ZoneCounts; label: string; color: DashColor }[] = [
  { key: 'autoAccept', label: 'acceptées selon vos règles', color: 'green' },
  { key: 'humanValidated', label: 'tranchées par vous', color: 'teal' },
  { key: 'pending', label: 'en attente de vous', color: 'yellow' },
  { key: 'autoReject', label: 'refusées', color: 'red' },
  { key: 'sansSuite', label: 'sans suite', color: 'blue' },
];

export function TodayZoneStrip({ zones }: { zones: TodayZoneCounts | null }) {
  if (!zones || zones.total === 0) return null;

  return (
    <section
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
      style={{
        borderTop: '1px solid var(--dash-border)',
        paddingTop: 12,
      }}
    >
      <span
        className="font-display"
        style={{ fontSize: 12, fontWeight: 700, color: 'var(--dash-text)' }}
      >
        {zones.total} candidature{zones.total > 1 ? 's' : ''}
      </span>
      {CATEGORIES.map((c) => (
        <span
          key={c.key}
          className="font-body inline-flex items-center gap-1.5"
          style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: DASH_COLORS[c.color].solid,
            }}
          />
          {zones[c.key]} {c.label}
        </span>
      ))}
    </section>
  );
}

/** Les catégories rendues — exportées pour la garde de partition. */
export const TODAY_ZONE_CATEGORIES = CATEGORIES.map((c) => c.key);
