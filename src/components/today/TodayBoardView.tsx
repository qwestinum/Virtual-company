'use client';

/**
 * La VUE d'*Aujourd'hui* — présentationnelle : elle ne lit rien, elle rend.
 *
 * STRUCTURE (la règle de l'écran, et elle vaut partout) :
 *   LA CARTE PORTE LE SUJET   — une couleur, un titre chiffré
 *   LE SOUS-BLOC PORTE LE VERBE — un sous-titre, un format, un bouton qui
 *                                 nomme le geste
 *
 * PEAU : celle du produit, pas une nouvelle. Conteneur, polices, palette,
 * carte et boutons viennent de Campagnes, Réglages et Sourcing.
 *
 * ⚠️ UN SEUL bouton principal sur la page — « + Nouvelle campagne », dans
 * l'en-tête. Toutes les actions de ligne sont SECONDAIRES : deux styles pleins
 * en concurrence, et le lecteur doit tout relire pour savoir ce qu'on attend
 * de lui.
 */

import { ActionButton } from '@/components/campagnes/ActionButton';
import { formatSmartDate } from '@/components/candidatures/stage-ui';
import { PHRASES } from '@/lib/lexique/phrases-ecran';
import type { TodayBoard } from '@/lib/today/board';

import { ConfirmInterviewButtons } from './ConfirmInterviewButtons';
import { RequeueOrphansButton } from './RequeueOrphansButton';
import { TodayCard, TodaySubBlock } from './TodayCard';
import { TodayHeader } from './TodayHeader';
import { TodayNotice } from './TodayNotice';
import { TodayRow } from './TodayRow';
import { TodayTeamBand } from './TodayTeamBand';
import { TodayZoneStrip, type TodayZoneCounts } from './TodayZoneStrip';

export type TodayBoardViewProps = {
  board: TodayBoard;
  firstName: string | null;
  agentCounts: Record<string, number>;
  zones: TodayZoneCounts | null;
  campaignLabel: (id: string | null, jobTitle?: string | null) => string;
  partial: boolean;
  onReload: () => void;
};

/** « en attente depuis 0 jour » ne veut rien dire — elle est arrivée ce matin. */
function attente(jours: number): string {
  if (jours <= 0) return 'reçue aujourd’hui';
  return `en attente depuis ${jours} jour${jours > 1 ? 's' : ''}`;
}

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
    { id: 'validation', n: board.validation.total, vide: PHRASES.validation.vide },
    { id: 'entretiens', n: board.entretiens.total, vide: PHRASES.entretiens.vide },
    { id: 'regler', n: board.verify.total, vide: PHRASES.regler.vide },
  ].filter((s) => s.n === 0);

  return (
    <div className="h-full overflow-auto" style={{ padding: '24px 28px 60px' }}>
      <div
        className="flex flex-col gap-5"
        style={{ maxWidth: 1400, margin: '0 auto' }}
      >
        <TodayHeader
          firstName={firstName}
          chiffres={[
            board.validation.total > 0
              ? PHRASES.validation.resume(board.validation.total)
              : null,
            board.entretiens.total > 0
              ? PHRASES.entretiens.resume(board.entretiens.total)
              : null,
            board.verify.total > 0 ? PHRASES.regler.resume(board.verify.total) : null,
          ].filter((x): x is string => x !== null)}
          allClear={board.allClear}
          partial={partial}
          onReload={onReload}
        />

        <TodayTeamBand counts={agentCounts} />

        {/* SUJET : les candidatures qui attendent une validation.
            Deux verbes en dessous — lire et décider · passer en revue. */}
        {board.validation.total > 0 ? (
          <TodayCard
            accent="purple"
            title={PHRASES.validation.titre(board.validation.total)}
          >
            {board.validation.aLire.total > 0 ? (
              <TodaySubBlock
                title={PHRASES.aLire.titre(board.validation.aLire.total)}
                subtitle={PHRASES.aLire.sousTitre}
              >
                {board.validation.aLire.items.map((item) => (
                  <TodayRow
                    key={item.id}
                    name={item.candidateName}
                    campaign={campaignLabel(item.campaignId)}
                    state={`note ${item.score ?? '—'} · ${attente(item.waitingDays)}`}
                    action={
                      <ActionButton href={item.href} label={PHRASES.aLire.action} />
                    }
                  />
                ))}
              </TodaySubBlock>
            ) : null}

            {/* UNE ligne, jamais une par candidat : le geste est une revue en
                fournée, pas une suite de décisions. */}
            {board.validation.aEcarter.total > 0 ? (
              <TodaySubBlock
                title={PHRASES.aEcarter.titre(board.validation.aEcarter.total)}
                subtitle={PHRASES.aEcarter.sousTitre}
              >
                <TodayNotice
                  text={
                    board.validation.aEcarter.oldestDays > 0
                      ? `La plus ancienne attend depuis ${board.validation.aEcarter.oldestDays} jours.`
                      : 'Elles viennent d’arriver.'
                  }
                  action={
                    <ActionButton
                      href={board.validation.aEcarter.href}
                      label={PHRASES.aEcarter.action}
                    />
                  }
                />
              </TodaySubBlock>
            ) : null}
          </TodayCard>
        ) : null}

        {/* SUJET : les entretiens. Deux verbes, dans l'ordre où ils se posent —
            on confirme qu'il a eu lieu AVANT de décider du candidat. */}
        {board.entretiens.total > 0 ? (
          <TodayCard
            accent="teal"
            title={PHRASES.entretiens.titre(board.entretiens.total)}
          >
            {board.entretiens.aConfirmer.total > 0 ? (
              <TodaySubBlock
                title={PHRASES.aConfirmer.titre(board.entretiens.aConfirmer.total)}
                subtitle={PHRASES.aConfirmer.sousTitre}
              >
                {board.entretiens.aConfirmer.items.map((item) => (
                  <TodayRow
                    key={item.id}
                    name={item.candidateName}
                    campaign={campaignLabel(item.campaignId, item.jobTitle)}
                    state={item.startAt ? formatSmartDate(item.startAt) : ''}
                    action={
                      <ConfirmInterviewButtons
                        uid={item.uid}
                        candidateName={item.candidateName}
                        campaignId={item.campaignId}
                        href={item.href}
                        onDone={onReload}
                      />
                    }
                  />
                ))}
              </TodaySubBlock>
            ) : null}

            {board.entretiens.aDecider.total > 0 ? (
              <TodaySubBlock
                title={PHRASES.aDecider.titre(board.entretiens.aDecider.total)}
                subtitle={PHRASES.aDecider.sousTitre}
              >
                {board.entretiens.aDecider.items.map((item) => (
                  <TodayRow
                    key={item.id}
                    name={item.candidateName}
                    campaign={campaignLabel(item.campaignId, item.jobTitle)}
                    state={item.startAt ? formatSmartDate(item.startAt) : ''}
                    action={
                      <ActionButton href={item.href} label={PHRASES.aDecider.action} />
                    }
                  />
                ))}
              </TodaySubBlock>
            ) : null}
          </TodayCard>
        ) : null}

        {/* SUJET : les réglages. Un seul verbe, donc pas de sous-bloc. */}
        {board.verify.total > 0 ? (
          <TodayCard
            accent="orange"
            title={PHRASES.regler.titre(board.verify.total)}
            subtitle={PHRASES.regler.sousTitre}
          >
            <div className="px-4">
              {board.verify.items.map((item) => (
                <TodayNotice
                  key={item.key}
                  text={item.message}
                  action={
                    // Un point qui se RÉPARE porte un bouton qui écrit ; un
                    // point qui se regarde porte un lien. Les confondre ferait
                    // cliquer pour rien, ou écrire sans le savoir.
                    item.action ? (
                      <RequeueOrphansButton label={item.ctaLabel} onDone={onReload} />
                    ) : item.href ? (
                      <ActionButton href={item.href} label={item.ctaLabel} />
                    ) : null
                  }
                />
              ))}
            </div>
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
