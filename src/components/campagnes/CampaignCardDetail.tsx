'use client';

/**
 * Contenu DÉPLIÉ d'une carte campagne — quatre blocs, en TUILES.
 *
 *   ① compteurs-filtres · ② ce qui attend · ③ trouver des candidats · ④ actions
 *
 * La facture est celle de l'ancienne carte (`CampaignStatTile` : fond
 * `--dash-warm`, icône, gros chiffre, libellé) : « zéro invention » veut dire
 * réutiliser ce qui existe, pas le remplacer par des rangées à bordure. Seul
 * le CONTENU change.
 *
 * ⚠️ OPTION A : les compteurs sont des ÉTAPES COURANTES. Avant, « Shortlistés
 * / Invités » comptait tous ceux PASSÉS par l'invitation — mesuré sur
 * CAMP-2026-221, la carte affichait 2 quand la puce « Invité » affichait 0.
 *
 * ⚠️ LATENCE : compteurs et « ce qui attend » arrivent AVEC la liste (appel
 * groupé, une lecture pour toutes les cartes). Seuls les trois états de
 * sourcing se chargent au dépliage, derrière un squelette de MÊME HAUTEUR —
 * un écran qui se réorganise sous le curseur fait rater le clic déjà visé.
 */

import type { ReactNode } from 'react';

import {
  buildCardAwaiting,
  buildCardCounters,
  buildCardSources,
} from '@/lib/campagnes/card-detail';
import type { CandidateStageCounts } from '@/lib/reporting/candidate-stage';

import { ActionButton } from './ActionButton';
import {
  CampaignSourceTile,
  CampaignSourceTileSkeleton,
  CampaignStatTile,
} from './CampaignStatTile';
import { useCampaignCardSources } from './useCampaignCardDetail';

export type CampaignCardCounters = {
  counts: CandidateStageCounts;
  received: number;
  aValiderOldestDays: number | null;
  entretiensAConfirmer: number;
};

const GRILLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 12,
} as const;

export function CampaignCardDetail({
  campaignId,
  expanded,
  counters,
  actions,
}: {
  campaignId: string;
  expanded: boolean;
  /** Livrés AVEC la liste : les chiffres ne clignotent jamais. */
  counters: CampaignCardCounters | null;
  actions: ReactNode;
}) {
  const sources = useCampaignCardSources(campaignId, expanded);

  return (
    <div style={{ padding: '18px 22px 20px', borderTop: '1px solid var(--dash-border)' }}>
      {counters ? (
        <>
          <Bloc titre="Candidatures">
            <div style={GRILLE}>
              {buildCardCounters(campaignId, counters.received, counters.counts).map(
                (c) => (
                  <CampaignStatTile
                    key={c.key}
                    icon={c.icon}
                    color={c.color}
                    value={c.count}
                    label={c.label}
                    href={c.href}
                  />
                ),
              )}
            </div>
          </Bloc>
          <CeQuiAttend
            items={buildCardAwaiting(campaignId, {
              aValider: counters.counts.a_valider,
              aValiderOldestDays: counters.aValiderOldestDays,
              entretiensAConfirmer: counters.entretiensAConfirmer,
            })}
          />
        </>
      ) : null}

      <Bloc titre="Trouver des candidats">
        <div style={GRILLE}>
          {sources.kind === 'ready' ? (
            buildCardSources(campaignId, sources.data).map((s) => (
              <CampaignSourceTile
                key={s.key}
                icon={s.icon}
                color={s.color}
                label={s.label}
                state={s.state}
                href={s.href}
                reason={s.reason}
              />
            ))
          ) : sources.kind === 'error' ? (
            <p
              className="font-body"
              style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
            >
              Ces informations n’ont pas pu être chargées.
            </p>
          ) : (
            <>
              <CampaignSourceTileSkeleton />
              <CampaignSourceTileSkeleton />
              <CampaignSourceTileSkeleton />
            </>
          )}
        </div>
      </Bloc>

      <Bloc titre="Actions">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </Bloc>
    </div>
  );
}

function Bloc({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <p
        className="font-display"
        style={{
          marginBottom: 8,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--dash-text-secondary)',
        }}
      >
        {titre}
      </p>
      {children}
    </section>
  );
}

/**
 * ② DEUX LIGNES MAXIMUM. Rien en attente ⇒ le bloc n'existe pas.
 *
 * C'est la SEULE porte vers Entretiens depuis la carte : un compteur qui
 * changerait d'écran selon l'étape obligerait à deviner où l'on va.
 */
function CeQuiAttend({ items }: { items: ReturnType<typeof buildCardAwaiting> }) {
  if (items.length === 0) return null;
  return (
    <Bloc titre="Ce qui attend">
      <div className="flex flex-col gap-2">
        {items.map((l) => (
          <div
            key={l.key}
            className="flex flex-wrap items-center gap-x-4 gap-y-2"
            style={{
              background: 'var(--dash-warm)',
              borderRadius: 12,
              padding: '10px 14px',
            }}
          >
            <p
              className="font-body min-w-0 flex-1"
              style={{ fontSize: 13, color: 'var(--dash-text)' }}
            >
              {l.text}
            </p>
            <ActionButton href={l.href} label="Voir" />
          </div>
        ))}
      </div>
    </Bloc>
  );
}
