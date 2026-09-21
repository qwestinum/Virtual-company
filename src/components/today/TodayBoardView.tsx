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
import { PageShell } from '@/components/navigation/PageShell';
import { ReferentFilterBar } from '@/components/referent/ReferentFilterBar';
import { ALL_REFERENTS } from '@/lib/referent/filter';
import { applyReferentFilter } from '@/lib/today/referent-view';
import { formatSmartDate } from '@/components/candidatures/stage-ui';
import { PHRASES } from '@/lib/lexique/phrases-ecran';
import type { TodayBoard } from '@/lib/today/board';
import type { TodayPending } from './useTodayBoard';

import { ConfirmInterviewButtons } from './ConfirmInterviewButtons';
import { RequeueOrphansButton } from './RequeueOrphansButton';
import { TodayCard, TodaySubBlock } from './TodayCard';
import { TodayHeader } from './TodayHeader';
import { TodayNotice } from './TodayNotice';
import { TodayRow } from './TodayRow';
import { TodaySkeleton } from './TodaySkeleton';
import { TodayTeamBand } from './TodayTeamBand';
import { TodayZoneStrip, type TodayZoneCounts } from './TodayZoneStrip';
import { useReferentFilter } from '@/components/referent/useReferentFilter';

export type TodayBoardViewProps = {
  board: TodayBoard;
  /** Par carte : sa donnée est-elle encore en route ? */
  pending?: TodayPending;
  currentUserId: string | null;
  firstName: string | null;
  agentCounts: Record<string, number>;
  zones: TodayZoneCounts | null;
  campaignLabel: (id: string | null, jobTitle?: string | null) => string;
  partial: boolean;
  onReload: () => void;
};

/**
 * « 2 à lire et décider » devient « 2 à lire et décider · 3 masqués ».
 *
 * Le total non filtré reste ÉCRIT : un dossier caché reste compté. Sans ça, un
 * filtre oublié ferait croire à une journée vide.
 */
function surTotal(titre: string, masques: number): string {
  return masques > 0 ? `${titre} · ${masques} masqué${masques > 1 ? 's' : ''}` : titre;
}

/** « en attente depuis 0 jour » ne veut rien dire — elle est arrivée ce matin. */
function attente(jours: number): string {
  if (jours <= 0) return 'reçue aujourd’hui';
  return `en attente depuis ${jours} jour${jours > 1 ? 's' : ''}`;
}

export function TodayBoardView({
  board: brut,
  pending = { validation: false, entretiens: false, verify: false },
  currentUserId,
  firstName,
  agentCounts,
  zones,
  campaignLabel,
  partial,
  onReload,
}: TodayBoardViewProps) {
  // Filtre de LECTURE, volontairement NON persisté (ni URL, ni stockage) : un
  // filtre oublié qui masque des dossiers est pire que pas de filtre.
  // ⚠️ UN SEUL ÉTAT pour tout le produit, mémorisé par recruteur : cocher
  // « Mes campagnes » ici, c'est le retrouver coché sur les autres écrans.
  const [referentFilter, setReferentFilter] = useReferentFilter(currentUserId);
  const vue = applyReferentFilter(brut, referentFilter, currentUserId);
  const board = vue.board;

  const enRoute = pending.validation || pending.entretiens || pending.verify;
  const vides = enRoute
    ? []
    : [
    { id: 'validation', n: board.validation.total, vide: PHRASES.validation.vide },
    { id: 'entretiens', n: board.entretiens.total, vide: PHRASES.entretiens.vide },
    { id: 'regler', n: board.verify.total, vide: PHRASES.regler.vide },
      ].filter((s) => s.n === 0);

  return (
    // ⚠️ GABARIT COMMUN : l'écran posait sa propre marge et son propre
    // conteneur. Mêmes valeurs qu'ici, mais écrites à un second endroit — et
    // le titre finissait 20 px plus à gauche que sur Campagnes.
    <PageShell>
      <div className="flex flex-col gap-5">
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
          // ⚠️ « Tout est fait » ne s'affiche JAMAIS pendant qu'une lecture
          // est en route : sur un écran qui compte ce qui attend, l'annoncer
          // trop tôt est le seul mensonge qu'il ne peut pas se permettre.
          allClear={!enRoute && board.allClear}
          partial={partial}
          onReload={onReload}
        />

        {/* ⚠️ Une LECTURE, jamais un droit : tout reste consultable et
            actionnable par tout le monde. Les compteurs disent « n sur N », et
            « À vérifier » n'est JAMAIS filtré — ce sont des alertes. */}
        <ReferentFilterBar
          options={vue.options}
          selection={referentFilter}
          onChange={setReferentFilter}
          myCount={vue.myCount}
          currentUserId={currentUserId}
        />

        <TodayTeamBand counts={agentCounts} />

        {vue.emptiedByFilter ? (
          <p
            className="font-body"
            style={{ fontSize: 13, color: 'var(--dash-text-secondary)' }}
          >
            Rien ne vous attend pour ce référent —{' '}
            {vue.masked.validation + vue.masked.entretiens} dossier
            {vue.masked.validation + vue.masked.entretiens > 1 ? 's' : ''}{' '}
            attend{vue.masked.validation + vue.masked.entretiens > 1 ? 'ent' : ''}{' '}
            ailleurs.{' '}
            <button
              type="button"
              onClick={() => setReferentFilter(ALL_REFERENTS)}
              className="font-semibold underline"
            >
              Voir tout
            </button>
          </p>
        ) : null}

        {/* SUJET : les candidatures qui attendent une validation.
            Deux verbes en dessous — lire et décider · passer en revue. */}
        {pending.validation ? (
          <TodaySkeleton titre="Candidatures à valider" />
        ) : board.validation.total > 0 ? (
          // ⚠️ TEINTE INVERSÉE sur les DEUX PREMIERS blocs : l'en-tête porte
          // la teinte dense, le corps redevient blanc, les sous-blocs prennent
          // la nuance légère. Le troisième bloc (« à régler ») garde la teinte
          // normale — il n'a pas de sous-bloc, l'inversion n'y dirait rien.
          <TodayCard
            accent="purple"
            teinte="inversee"
            title={PHRASES.validation.titre(board.validation.total)}
          >
            <TodaySubBlock
              accent="purple"
              teinte="inversee"
              id="validation.aLire"
              count={board.validation.aLire.total}
              title={surTotal(
              PHRASES.aLire.titre(board.validation.aLire.total),
              vue.masked.validation,
            )}
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

            {/* Le bouton est dans l'EN-TÊTE du sous-bloc : il porte sur tout
                le groupe, pas sur une ligne. Une revue en fournée n'a pas de
                ligne à laquelle s'accrocher. */}
            <TodaySubBlock
              accent="purple"
              teinte="inversee"
              id="validation.aEcarter"
              count={board.validation.aEcarter.total}
              title={PHRASES.aEcarter.titre(board.validation.aEcarter.total)}
              subtitle={PHRASES.aEcarter.sousTitre}
              action={
                board.validation.aEcarter.total > 0 ? (
                  <ActionButton
                    href={board.validation.aEcarter.href}
                    label={PHRASES.aEcarter.action}
                  />
                ) : null
              }
            >
              <TodayNotice
                text={
                  board.validation.aEcarter.oldestDays > 0
                    ? `La plus ancienne attend depuis ${board.validation.aEcarter.oldestDays} jours.`
                    : 'Elles viennent d’arriver.'
                }
              />
            </TodaySubBlock>
          </TodayCard>
        ) : null}

        {/* SUJET : les entretiens. Deux verbes, dans l'ordre où ils se posent —
            on confirme qu'il a eu lieu AVANT de décider du candidat. */}
        {pending.entretiens ? (
          <TodaySkeleton titre="Entretiens" />
        ) : board.entretiens.total > 0 ? (
          <TodayCard
            accent="teal"
            teinte="inversee"
            title={PHRASES.entretiens.titre(board.entretiens.total)}
          >
            <TodaySubBlock
              accent="teal"
              teinte="inversee"
              id="entretiens.aConfirmer"
              count={board.entretiens.aConfirmer.total}
              title={surTotal(
                PHRASES.aConfirmer.titre(board.entretiens.aConfirmer.total),
                brut.entretiens.aConfirmer.total - board.entretiens.aConfirmer.total,
              )}
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

            <TodaySubBlock
              accent="teal"
              teinte="inversee"
              id="entretiens.aDecider"
              count={board.entretiens.aDecider.total}
              title={surTotal(
                PHRASES.aDecider.titre(board.entretiens.aDecider.total),
                brut.entretiens.aDecider.total - board.entretiens.aDecider.total,
              )}
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
          </TodayCard>
        ) : null}

        {/* SUJET : les réglages. Un seul verbe, donc pas de sous-bloc. */}
        {pending.verify ? (
          <TodaySkeleton titre="À vérifier" />
        ) : board.verify.total > 0 ? (
          <TodayCard
            accent="orange"
            title={PHRASES.regler.titre(board.verify.total)}
            subtitle={PHRASES.regler.sousTitre}
          >
            {/* Un seul verbe : pas de sous-bloc. Les rangées blanches, si —
                c'est le relief qui dit « une ligne, une décision ». */}
            <>
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
            </>
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
    </PageShell>
  );
}
