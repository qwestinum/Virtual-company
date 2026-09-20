'use client';

/**
 * La VUE d'*Aujourd'hui* — présentationnelle : elle ne lit rien, elle rend.
 *
 * Trois zones, dans cet ordre : qui vous êtes et ce qu'il y a · l'équipe et ce
 * qu'elle a fait · ce qui vous attend. Puis, en pied, la répartition — la
 * preuve chiffrée que l'humain décide.
 *
 * PEAU : celle du produit, pas une nouvelle. Conteneur, polices, palette,
 * carte et bouton viennent de Campagnes, Réglages et Sourcing — cet écran les
 * applique, il n'en invente aucun.
 *
 * Séparée du chargement pour deux raisons, et la seconde compte autant :
 *  1. elle se rend avec des données fixes, donc elle se REGARDE (recette,
 *     capture) sans base ni session ;
 *  2. ce qui reste dans `TodayScreen` est exactement le chargement.
 */

import { formatSmartDate } from '@/components/candidatures/stage-ui';
import { PHRASES } from '@/lib/lexique/phrases-ecran';
import type { TodayBoard } from '@/lib/today/board';

import { RequeueOrphansButton } from './RequeueOrphansButton';
import { TodayCard } from './TodayCard';
import { TodayHeader } from './TodayHeader';
import { TodayNotice } from './TodayNotice';
import { TodayPrimary, TodayRow } from './TodayRow';
import { TodayTeamBand } from './TodayTeamBand';
import { TodayZoneStrip, type TodayZoneCounts } from './TodayZoneStrip';

export type TodayBoardViewProps = {
  board: TodayBoard;
  firstName: string | null;
  /** id d'agent → activité depuis la dernière visite (journal). */
  agentCounts: Record<string, number>;
  /** Répartition des décisions — le pied de page. */
  zones: TodayZoneCounts | null;
  campaignLabel: (id: string | null, jobTitle?: string | null) => string;
  partial: boolean;
  onReload: () => void;
};

export function TodayBoardView({
  board,
  firstName,
  agentCounts,
  zones,
  campaignLabel,
  partial,
  onReload,
}: TodayBoardViewProps) {
  const vides = [
    { id: 'decision', n: board.decide.total, vide: PHRASES.decision.vide },
    { id: 'ecarter', n: board.proposals.total, vide: PHRASES.ecarter.vide },
    { id: 'entretiens', n: board.interviews.total, vide: PHRASES.entretiens.vide },
    { id: 'regler', n: board.verify.total, vide: PHRASES.regler.vide },
  ].filter((s) => s.n === 0);

  return (
    // Conteneur de Campagnes, à l'identique : 1400 px de large, centré,
    // 24/28/60 de marges. La colonne étroite faisait un quatrième gabarit.
    <div className="h-full overflow-auto" style={{ padding: '24px 28px 60px' }}>
      <div
        className="flex flex-col gap-5"
        style={{ maxWidth: 1400, margin: '0 auto' }}
      >
        <TodayHeader
          firstName={firstName}
          chiffres={[
            board.decide.total > 0 ? PHRASES.decision.resume(board.decide.total) : null,
            board.proposals.total > 0 ? PHRASES.ecarter.resume(board.proposals.total) : null,
            board.interviews.total > 0 ? PHRASES.entretiens.resume(board.interviews.total) : null,
            board.verify.total > 0 ? PHRASES.regler.resume(board.verify.total) : null,
          ].filter((x): x is string => x !== null)}
          allClear={board.allClear}
          partial={partial}
          onReload={onReload}
        />

        <TodayTeamBand counts={agentCounts} />

        {board.decide.total > 0 ? (
          <TodayCard
            accent="purple"
            title={PHRASES.decision.titre(board.decide.total)}
            subtitle={PHRASES.decision.sousTitre}
          >
            {board.decide.items.map((item) => (
              <TodayRow
                key={item.id}
                name={item.candidateName}
                campaign={campaignLabel(item.campaignId)}
                state={`note ${item.score ?? '—'} · en attente depuis ${item.waitingDays} jour${item.waitingDays > 1 ? 's' : ''}`}
                action={<TodayPrimary href={item.href} label={PHRASES.decision.action} />}
              />
            ))}
          </TodayCard>
        ) : null}

        {/* UNE ligne, jamais une par candidat : le geste est une revue en
            fournée, pas une suite de décisions. */}
        {board.proposals.total > 0 ? (
          <TodayCard
            accent="purple"
            title={PHRASES.ecarter.titre(board.proposals.total)}
            subtitle={PHRASES.ecarter.sousTitre}
          >
            <TodayNotice
              text={
                board.proposals.oldestDays > 0
                  ? `La plus ancienne attend depuis ${board.proposals.oldestDays} jours.`
                  : 'Elles viennent d’arriver.'
              }
              action={
                <TodayPrimary href={board.proposals.href} label={PHRASES.ecarter.action} />
              }
            />
          </TodayCard>
        ) : null}

        {board.interviews.total > 0 ? (
          <TodayCard
            accent="teal"
            title={PHRASES.entretiens.titre(board.interviews.total)}
            subtitle={PHRASES.entretiens.sousTitre}
          >
            {board.interviews.items.map((item) => (
              <TodayRow
                key={item.id}
                name={item.candidateName}
                campaign={campaignLabel(item.campaignId, item.jobTitle)}
                state={[
                  item.kind === 'a_eu_lieu'
                    ? PHRASES.entretiens.questionEuLieu
                    : PHRASES.entretiens.questionRetenu,
                  item.startAt ? formatSmartDate(item.startAt) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                action={<TodayPrimary href={item.href} label={PHRASES.entretiens.action} />}
              />
            ))}
          </TodayCard>
        ) : null}

        {board.verify.total > 0 ? (
          <TodayCard
            accent="orange"
            title={PHRASES.regler.titre(board.verify.total)}
            subtitle={PHRASES.regler.sousTitre}
          >
            {board.verify.items.map((item) => (
              <TodayNotice
                key={item.key}
                text={item.message}
                action={
                  // Un point qui se RÉPARE porte un bouton qui écrit ; un point
                  // qui se regarde porte un lien. Les confondre ferait cliquer
                  // pour rien, ou écrire sans le savoir.
                  item.action ? (
                    <RequeueOrphansButton label={item.ctaLabel} onDone={onReload} />
                  ) : item.href ? (
                    <TodayPrimary href={item.href} label={item.ctaLabel} />
                  ) : null
                }
              />
            ))}
          </TodayCard>
        ) : null}

        {/* Le vide, en bas, replié. Jamais une carte. */}
        {vides.length > 0 && !board.allClear ? (
          <ul className="flex flex-col gap-1">
            {vides.map((s) => (
              <li
                key={s.id}
                className="font-body"
                style={{ fontSize: 12, color: 'var(--dash-text-secondary)' }}
              >
                {s.vide}
              </li>
            ))}
          </ul>
        ) : null}

        <TodayZoneStrip zones={zones} />
      </div>
    </div>
  );
}
