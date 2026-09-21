'use client';

/**
 * SOURCING — vue TRANSVERSE, toutes campagnes.
 *
 * ⚠️ AUCUN LANCEMENT DE RECHERCHE ICI, et ce n'est pas un oubli. Le gate du
 * module reste la CAMPAGNE : c'est elle qui porte la fiche de poste, les
 * critères et le budget. Une recherche lancée hors campagne n'aurait ni barème
 * ni destination — et le coût, lui, partirait quand même.
 *
 * Cette page répond à « où en sont mes approches ? », jamais à « trouve-moi
 * quelqu'un ». Chaque ligne mène à la campagne, qui est l'endroit où l'on agit.
 *
 * ⚠️ AUCUNE DONNÉE PERSONNELLE. Une approche est une empreinte, un canal, des
 * dates. Le nom n'existe qu'après manifestation, et il vit alors dans la
 * CANDIDATURE — pas ici.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SourcingCostsCard } from '@/components/dashboard/SourcingCostsCard';
import { CounterRibbon } from '@/components/ui/CounterRibbon';
import { ListRow } from '@/components/ui/ListRow';
import { dedupeFetch } from '@/lib/net/dedupe-fetch';

type Approche = {
  id: string;
  campaignId: string;
  campaignName: string | null;
  canal: string;
  statut: string;
  envoyeeLe: string;
  ouverteLe: string | null;
  repondueLe: string | null;
};

const LIBELLE_CANAL: Record<string, string> = {
  linkedin: 'LinkedIn',
  email: 'Message direct',
};

const jour = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : null;

type Vue = 'en_cours' | 'repondues' | 'toutes';

export function SourcingOverview() {
  const [approches, setApproches] = useState<Approche[]>([]);
  const [oppositions, setOppositions] = useState(0);
  const [indisponible, setIndisponible] = useState(false);
  const [charge, setCharge] = useState(false);
  const [vue, setVue] = useState<Vue>('en_cours');

  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const res = await dedupeFetch('/api/sourcing/overview');
        const data = (await res.json()) as {
          approches?: Approche[];
          oppositions?: number;
          indisponible?: boolean;
        };
        if (!vivant) return;
        setApproches(data.approches ?? []);
        setOppositions(data.oppositions ?? 0);
        setIndisponible(data.indisponible === true);
      } catch {
        if (vivant) setIndisponible(true);
      } finally {
        if (vivant) setCharge(true);
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const repondues = approches.filter((a) => a.repondueLe !== null);
  const enCours = approches.filter((a) => a.repondueLe === null && a.statut === 'active');
  const visibles =
    vue === 'repondues' ? repondues : vue === 'toutes' ? approches : enCours;

  return (
    <>
      <div className="mb-4">
        <CounterRibbon
          active={vue}
          onSelect={(k) => setVue((k ?? 'en_cours') as Vue)}
          items={[
            {
              key: 'en_cours',
              label: 'Approches en cours',
              count: enCours.length,
              color: 'var(--dash-blue)',
            },
            {
              key: 'repondues',
              label: 'Réponses reçues',
              count: repondues.length,
              color: 'var(--dash-green)',
            },
            {
              key: 'toutes',
              label: 'Toutes les approches',
              count: approches.length,
              color: 'var(--dash-purple)',
            },
          ]}
        />
      </div>

      {/* L'opposition n'est pas une ligne de liste : c'est un compte, et le
          dire autrement ferait circuler des empreintes sans usage. */}
      <p className="mb-4 font-body text-[12.5px]" style={{ color: 'var(--dash-text-secondary)' }}>
        {oppositions === 0
          ? 'Aucune personne ne s’est opposée à être approchée.'
          : `${oppositions} personne${oppositions > 1 ? 's se sont opposées' : ' s’est opposée'} à être approchée — elle${oppositions > 1 ? 's ne seront plus proposées' : ' ne sera plus proposée'}, sur aucune campagne.`}
      </p>

      {indisponible ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12.5px] text-amber-900">
          Le sourcing n’est pas activé sur cette installation, ou ses données
          n’ont pas pu être lues. Cette page ne montre donc rien — ce n’est pas
          qu’il n’y a rien.
        </p>
      ) : null}

      {!charge ? (
        <p className="font-body text-[13px] text-stone-400">Chargement…</p>
      ) : visibles.length === 0 ? (
        <p className="rounded-lg border px-4 py-6 text-center font-body text-[13px]"
           style={{ borderColor: 'var(--dash-border)', color: 'var(--dash-text-secondary)' }}>
          {vue === 'repondues'
            ? 'Aucune réponse pour l’instant.'
            : 'Aucune approche en cours. Une recherche se lance depuis une campagne.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibles.map((a) => (
            <li key={a.id}>
              {/* ⚠️ Pas de pavé d'initiales : on ne connaît PAS la personne.
                  Une approche est une empreinte — lui fabriquer des initiales
                  serait inventer une identité qu'on s'interdit d'avoir. */}
              <ListRow
                testId={a.id}
                title={a.campaignName ?? a.campaignId}
                pill={LIBELLE_CANAL[a.canal] ?? a.canal}
                reference={a.campaignId}
                meta={[
                  `approchée le ${jour(a.envoyeeLe)}`,
                  a.ouverteLe ? `ouverte le ${jour(a.ouverteLe)}` : null,
                  a.repondueLe ? `a répondu le ${jour(a.repondueLe)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Link
                    href={`/campagnes/${encodeURIComponent(a.campaignId)}/sourcing`}
                    className="rounded-lg border px-2.5 py-1.5 font-body text-[12px] font-semibold"
                    style={{
                      borderColor: 'var(--dash-border-strong)',
                      color: 'var(--dash-text-secondary)',
                    }}
                  >
                    Ouvrir la campagne
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {/* Le coût vit dans une carte ADMIN : la route qui le sert est réservée,
          et elle rend un écran vide à un membre — il n'a pas à connaître le
          budget pour faire son travail. */}
      <div className="mt-6">
        <SourcingCostsCard />
      </div>
    </>
  );
}
