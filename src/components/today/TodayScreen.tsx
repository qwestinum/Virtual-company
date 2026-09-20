'use client';

/**
 * *Aujourd'hui* — l'écran d'arrivée : ce qui attend une action, rien d'autre.
 *
 * Il remplace le « Bureau », qui montrait l'organigramme des agents : une
 * image du SYSTÈME, là où le recruteur vient chercher son TRAVAIL. L'équipe
 * d'agents et la répartition par zone ont rejoint « Pilotage », où se regarde
 * la mesure.
 *
 * Quatre sections, dans l'ordre où le travail se fait, et aucune ne mélange
 * deux natures de geste (maquette v2 §A.2). La répartition, les compteurs et
 * les destinations viennent de `lib/today/board.ts` — pur et testé ; il ne
 * reste ici que du rendu.
 */

import Link from 'next/link';

import { formatSmartDate } from '@/components/candidatures/stage-ui';

import { TodayAction, TodayRow, TodaySection } from './TodaySection';
import { TodayHeader } from './TodayHeader';
import { useTodayBoard } from './useTodayBoard';

export function TodayScreen() {
  const state = useTodayBoard();

  if (state.kind === 'loading') {
    return (
      <div className="h-full overflow-auto px-6 py-6">
        <p className="font-body text-[13px] text-stone-500">Chargement…</p>
      </div>
    );
  }

  const { board } = state;
  const enAttente =
    board.decide.total +
    board.proposals.total +
    board.interviews.total +
    board.verify.total;

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
        <TodayHeader
          waiting={enAttente}
          allClear={board.allClear}
          partial={state.partial}
          onReload={state.reload}
        />

        {board.allClear && !state.partial ? (
          <p className="font-body text-[14px] text-stone-600">
            Aucun dossier n&apos;attend d&apos;arbitrage, aucun entretien à
            pointer, aucun réglage à vérifier. Bonne journée.
          </p>
        ) : (
          <>
            <TodaySection
              title="À décider"
              count={board.decide.total}
              verb="Arbitrer une candidature dont le score est dans la bande de validation."
              emptyLabel="Aucune candidature à arbitrer."
              seeAll={
                board.decide.total > board.decide.items.length
                  ? {
                      label: `Voir les ${board.decide.total - board.decide.items.length} autres`,
                      href: '/candidatures?statut=a_valider',
                    }
                  : null
              }
            >
              {board.decide.items.map((item) => (
                <TodayRow
                  key={item.id}
                  age={`${item.waitingDays} j`}
                  title={item.candidateName}
                  detail={`${item.score ?? '—'} · ${item.campaignId}`}
                  actions={
                    <TodayAction href={item.href} label="Voir le dossier" />
                  }
                />
              ))}
            </TodaySection>

            {/* UNE ligne agrégée, jamais une ligne par candidat : le geste est
                une revue en fournée, pas une suite d'arbitrages. */}
            <TodaySection
              title="Propositions de refus"
              count={board.proposals.total}
              verb="Passer en revue en une fois les dossiers sous le seuil bas."
              emptyLabel="Aucune proposition de refus en attente."
            >
              <TodayRow
                age={null}
                title={`${board.proposals.total} candidature${board.proposals.total > 1 ? 's' : ''} à passer en revue`}
                detail={
                  board.proposals.oldestDays > 0
                    ? `la plus ancienne depuis ${board.proposals.oldestDays} jours`
                    : ''
                }
                actions={
                  <TodayAction
                    href={board.proposals.href}
                    label="Ouvrir la revue groupée"
                  />
                }
              />
            </TodaySection>

            <TodaySection
              title="Entretiens"
              count={board.interviews.total}
              verb="Pointer ce qui s'est passé, puis donner le verdict."
              emptyLabel="Aucun entretien à pointer ni verdict à donner."
              seeAll={
                board.interviews.total > board.interviews.items.length
                  ? {
                      label: `Voir les ${board.interviews.total - board.interviews.items.length} autres`,
                      href: '/entretiens',
                    }
                  : null
              }
            >
              {board.interviews.items.map((item) => (
                <TodayRow
                  key={item.id}
                  age={
                    item.startAt ? formatSmartDate(item.startAt) : null
                  }
                  title={item.candidateName}
                  detail={
                    item.kind === 'a_pointer'
                      ? 'entretien non pointé'
                      : 'entretien réalisé — verdict attendu'
                  }
                  actions={
                    <TodayAction
                      href={item.href}
                      label={
                        item.kind === 'a_pointer'
                          ? 'Pointer'
                          : 'Donner le verdict'
                      }
                    />
                  }
                />
              ))}
            </TodaySection>

            {/* JAMAIS un candidat : la frontière est portée par le registre
                des signaux (`BUSINESS_SIGNAL_SURFACES`), pas par une liste
                tenue ici — un signal ajouté demain choisit sa surface à sa
                déclaration. */}
            <TodaySection
              title="À vérifier"
              count={board.verify.total}
              verb="Des réglages ou des campagnes qui vont poser problème."
              emptyLabel="Rien à vérifier."
            >
              {board.verify.items.map((item) => (
                <TodayRow
                  key={item.key}
                  age={null}
                  title={item.message}
                  detail=""
                  actions={
                    <TodayAction href={item.href} label={item.ctaLabel} />
                  }
                />
              ))}
            </TodaySection>
          </>
        )}

        <footer className="border-t border-stone-200 pt-3">
          <Link
            href="/pilotage"
            className="inline-flex min-h-6 items-center font-body text-[12px] font-semibold text-stone-500 hover:text-stone-900"
          >
            Indicateurs, équipe d&apos;agents et répartition → Pilotage
          </Link>
        </footer>
      </div>
    </div>
  );
}
