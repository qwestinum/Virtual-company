'use client';

/**
 * Contenu DÉPLIÉ d'une carte campagne — quatre blocs.
 *
 *   ① compteurs-filtres · ② ce qui attend · ③ trouver des candidats · ④ actions
 *
 * ⚠️ OPTION A : les compteurs sont des ÉTAPES COURANTES. Avant, « Shortlistés
 * / Invités » comptait tous ceux PASSÉS par l'invitation — mesuré sur
 * CAMP-2026-221, la carte affichait 2 quand la puce « Invité » affichait 0,
 * les deux candidats ayant avancé depuis. Cliquer un chiffre et atterrir sur
 * une liste vide est pire que deux mots différents.
 *
 * Chaque compteur porte LE MÊME MOT que sa destination et le MÊME nombre,
 * parce qu'il vient de la MÊME source (`computeStageCounts`, celle du ruban) :
 * il n'y a qu'une comptabilité, donc aucun invariant à maintenir.
 *
 * Taux, conversion et détails ont quitté la carte pour Pilotage : ce sont des
 * mesures de performance, pas ce qu'on vient faire ici.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  buildCardAwaiting,
  buildCardCounters,
  buildCardSources,
} from '@/lib/campagnes/card-detail';

import { ActionButton } from './ActionButton';
import { useCampaignCardDetail } from './useCampaignCardDetail';

export function CampaignCardDetail({
  campaignId,
  expanded,
  actions,
}: {
  campaignId: string;
  /** La lecture ne part QUE si la carte est ouverte. */
  expanded: boolean;
  actions: ReactNode;
}) {
  const state = useCampaignCardDetail(campaignId, expanded);

  return (
    <div style={{ padding: '18px 22px 20px', borderTop: '1px solid var(--dash-border)' }}>
      {state.kind === 'ready' ? (
        <>
          <Compteurs
            items={buildCardCounters(campaignId, state.data.received, state.data.counts)}
          />
          <CeQuiAttend items={buildCardAwaiting(campaignId, state.data.awaiting)} />
          <Sources items={buildCardSources(campaignId, state.data.sources)} />
        </>
      ) : (
        <p
          className="font-body"
          style={{ fontSize: 12, color: 'var(--dash-text-secondary)', marginBottom: 14 }}
        >
          {state.kind === 'error'
            ? 'Le détail de cette campagne n’a pas pu être chargé.'
            : 'Chargement…'}
        </p>
      )}

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

/** ① Chaque chiffre est un lien, et porte le mot de sa destination. */
function Compteurs({ items }: { items: ReturnType<typeof buildCardCounters> }) {
  return (
    <Bloc titre="Candidatures">
      <div className="flex flex-wrap gap-2">
        {items.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="rounded-md border bg-white px-3 py-2"
            style={{ borderColor: 'var(--dash-border)', minWidth: 96 }}
          >
            <span
              className="font-display block"
              style={{ fontSize: 20, fontWeight: 800, color: 'var(--dash-text)', lineHeight: 1.1 }}
            >
              {c.count}
            </span>
            <span
              className="font-body block"
              style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
            >
              {c.label}
            </span>
          </Link>
        ))}
      </div>
    </Bloc>
  );
}

/** ② DEUX LIGNES MAXIMUM. Rien en attente ⇒ le bloc n'existe pas. */
function CeQuiAttend({ items }: { items: ReturnType<typeof buildCardAwaiting> }) {
  if (items.length === 0) return null;
  return (
    <Bloc titre="Ce qui attend">
      <div className="flex flex-col gap-2">
        {items.map((l) => (
          <div
            key={l.key}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-white px-3 py-2"
            style={{ borderColor: 'var(--dash-border)' }}
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

/**
 * ③ Les trois portes d'entrée de candidatures.
 *
 * ⚠️ FERMÉES SUR UN BROUILLON, et la raison est ÉCRITE à côté. Diffuser depuis
 * un brouillon fait arriver des candidatures que le chemin email n'analysera
 * pas — il ne traite que les campagnes actives. Un bouton grisé sans un mot ne
 * déplace pas le besoin, il le supprime.
 */
function Sources({ items }: { items: ReturnType<typeof buildCardSources> }) {
  return (
    <Bloc titre="Trouver des candidats">
      <div className="flex flex-col gap-2">
        {items.map((s) => (
          <div
            key={s.key}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-white px-3 py-2"
            style={{ borderColor: 'var(--dash-border)' }}
          >
            <span className="shrink-0">
              {s.href ? (
                <ActionButton href={s.href} label={s.label} />
              ) : (
                <ActionButton label={s.label} onClick={() => {}} disabled />
              )}
            </span>
            <p
              className="font-body min-w-0 flex-1"
              style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
            >
              {s.href ? s.state : (s.reason ?? s.state)}
            </p>
          </div>
        ))}
      </div>
    </Bloc>
  );
}
