'use client';

/**
 * DIFFUSION — toutes les annonces publiées, tous canaux, toutes campagnes.
 *
 * ⚠️ Pourquoi cette page existe : l'état d'une annonce ne se voyait QUE dans sa
 * campagne. Personne ne pouvait répondre à « laquelle va basculer ? » sans
 * ouvrir les campagnes une par une — et l'Apec refuse une republication
 * au-delà de 30 jours, donc la question a une date de péremption.
 *
 * ⚠️ L'ÉTAT DISTANT EST UN CACHE. Un consultant Apec peut valider, un recruteur
 * peut modifier sur apec.fr : ORQA ne l'apprend qu'en demandant. Chaque ligne
 * dit donc QUAND l'état a été lu. Afficher l'état nu serait affirmer une
 * fraîcheur qu'on n'a pas.
 *
 * Chaque ligne mène à la campagne : c'est là qu'on republie, suspend ou
 * réécrit. Cette page CONSTATE, elle n'agit pas.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { CounterRibbon } from '@/components/ui/CounterRibbon';
import { ListRow } from '@/components/ui/ListRow';
import {
  LIBELLE_ETAT,
  SEUIL_ALERTE_JOURS,
  type EtatDiffusion,
  type LigneDiffusion,
} from '@/lib/diffusion/rows';
import { dedupeFetch } from '@/lib/net/dedupe-fetch';

type Ligne = LigneDiffusion & { campaignName: string | null };

const TEINTE: Record<EtatDiffusion, string> = {
  publiee: 'var(--dash-green)',
  suspendue: 'var(--dash-yellow)',
  a_republier: 'var(--dash-orange)',
  brouillon: 'var(--dash-text-tertiary)',
};

const jour = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : null;

/** Ce que les jours restants veulent dire, en une phrase de recruteur. */
function mentionEcheance(restant: number | null): string | null {
  if (restant === null) return null;
  if (restant <= 0) return 'republication refusée passé 30 jours';
  if (restant <= SEUIL_ALERTE_JOURS)
    return `${restant} jour${restant > 1 ? 's' : ''} pour republier`;
  return null;
}

type Vue = 'a_traiter' | 'toutes';

export function DiffusionOverview() {
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [manquantes, setManquantes] = useState<string[]>([]);
  const [charge, setCharge] = useState(false);
  const [vue, setVue] = useState<Vue>('a_traiter');

  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const res = await dedupeFetch('/api/diffusion');
        const data = (await res.json()) as {
          lignes?: Ligne[];
          sourcesManquantes?: string[];
        };
        if (!vivant) return;
        setLignes(data.lignes ?? []);
        setManquantes(data.sourcesManquantes ?? []);
      } catch {
        if (vivant) setManquantes(['tout']);
      } finally {
        if (vivant) setCharge(true);
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const aTraiter = lignes.filter(
    (l) =>
      l.etat === 'a_republier' ||
      l.etat === 'suspendue' ||
      (l.joursAvantRefus !== null && l.joursAvantRefus <= SEUIL_ALERTE_JOURS),
  );
  const visibles = vue === 'toutes' ? lignes : aTraiter;

  return (
    <>
      <div className="mb-4">
        <CounterRibbon
          active={vue}
          onSelect={(k) => setVue((k ?? 'a_traiter') as Vue)}
          items={[
            {
              key: 'a_traiter',
              label: 'Annonces à reprendre',
              count: aTraiter.length,
              color: 'var(--dash-orange)',
            },
            {
              key: 'toutes',
              label: 'Toutes les annonces',
              count: lignes.length,
              color: 'var(--dash-blue)',
            },
          ]}
        />
      </div>

      {manquantes.length > 0 ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12.5px] text-amber-900">
          {/* Une page vide qui ne dit pas pourquoi se lit « il n'y a rien à
              diffuser ». Ici, on dit laquelle des sources a manqué. */}
          Une source n’a pas pu être lue ({manquantes.join(', ')}) : cette liste
          est incomplète.
        </p>
      ) : null}

      {!charge ? (
        <p className="font-body text-[13px] text-stone-400">Chargement…</p>
      ) : visibles.length === 0 ? (
        <p
          className="rounded-lg border px-4 py-6 text-center font-body text-[13px]"
          style={{ borderColor: 'var(--dash-border)', color: 'var(--dash-text-secondary)' }}
        >
          {vue === 'a_traiter'
            ? 'Aucune annonce n’appelle de geste : rien n’approche des 30 jours, rien n’est suspendu.'
            : 'Aucune annonce diffusée pour l’instant.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibles.map((l) => {
            const echeance = mentionEcheance(l.joursAvantRefus);
            return (
              <li key={l.cle}>
                <ListRow
                  testId={l.cle}
                  avatar={
                    <span
                      aria-hidden
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border"
                      style={{
                        borderColor: `color-mix(in srgb, ${TEINTE[l.etat]} 35%, transparent)`,
                        background: 'var(--dash-warm)',
                      }}
                    >
                      <span
                        className="h-[9px] w-[9px] rounded-full"
                        style={{ background: TEINTE[l.etat] }}
                      />
                    </span>
                  }
                  title={l.campaignName ?? l.campaignId}
                  pill={l.canal}
                  reference={l.campaignId}
                  meta={[
                    LIBELLE_ETAT[l.etat],
                    l.publieeLe ? `depuis le ${jour(l.publieeLe)}` : null,
                    echeance,
                    // ⚠️ La fraîcheur du cache, TOUJOURS dite quand elle existe.
                    l.statutLuLe ? `état lu le ${jour(l.statutLuLe)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  right={
                    <>
                      {l.url ? (
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border px-2.5 py-1.5 font-body text-[12px] font-semibold"
                          style={{
                            borderColor: 'var(--dash-border-strong)',
                            color: 'var(--dash-text-secondary)',
                          }}
                        >
                          Voir l’annonce
                        </a>
                      ) : null}
                      {/* Le geste vit dans la campagne — republier, suspendre,
                          réécrire y ont leur contexte. */}
                      <Link
                        href={`/campagnes?campagne=${encodeURIComponent(l.campaignId)}`}
                        className="rounded-lg border px-2.5 py-1.5 font-body text-[12px] font-semibold"
                        style={{
                          borderColor: 'var(--dash-border-strong)',
                          color: 'var(--dash-text-secondary)',
                        }}
                      >
                        Ouvrir la campagne
                      </Link>
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
