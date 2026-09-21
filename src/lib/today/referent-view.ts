/**
 * Le filtre par référent posé SUR le tableau d'*Aujourd'hui*. PUR, testé.
 *
 * ⚠️ C'EST UNE LECTURE, JAMAIS UN DROIT. Tout reste consultable et actionnable
 * par tout le monde : le filtre réduit seulement ce qui s'affiche. Trois
 * conséquences qu'on tient, et qui ne sont pas négociables :
 *
 *  1. **Les compteurs disent « n sur N ».** Le total non filtré reste écrit —
 *     un dossier caché reste compté. Sans ça, un filtre oublié ferait croire à
 *     une journée vide.
 *  2. **« À vérifier » N'EST JAMAIS FILTRÉ.** Ce sont des alertes : un agenda
 *     mal réglé ou une campagne muette ne regardent pas un référent en
 *     particulier, et les masquer derrière un filtre de confort éteindrait
 *     précisément ce qui doit rester visible. Même garde que sur les files de
 *     validation et d'entretiens.
 *  3. **Rien n'est persisté** — ni URL ni stockage. Un filtre oublié qui masque
 *     des dossiers est pire que pas de filtre.
 *
 * Le tableau est construit SANS le filtre (`buildTodayBoard`), puis filtré
 * ici : la répartition entre sections ne dépend jamais du filtre, et le calcul
 * reste testable seul.
 */

import {
  buildReferentOptionsBy,
  filterByReferentBy,
  matchesReferentBy,
  type ReferentInfo,
  type ReferentOption,
  type ReferentSelection,
} from '@/lib/referent/filter';
import type { TodayBoard } from '@/lib/today/board';

/** Tout ce qui porte un référent sur cet écran. */
type Porteur = { referent: ReferentInfo | null };

const referentOf = (item: Porteur): ReferentInfo | null => item.referent;

export type TodayReferentView = {
  /** Le tableau tel qu'il doit s'afficher. */
  board: TodayBoard;
  /** Ce que le filtre masque, section par section. 0 quand « Tous ». */
  masked: { validation: number; entretiens: number };
  /** Entrées du sélecteur, comptées sur TOUT ce qui concerne des candidats. */
  options: ReferentOption[];
  /** Dossiers dont le référent est l'utilisateur — 0 ⇒ pas de raccourci. */
  myCount: number;
  /** Le filtre masque-t-il absolument tout ce qui attendait ? */
  emptiedByFilter: boolean;
};

export function applyReferentFilter(
  board: TodayBoard,
  selection: ReferentSelection,
  currentUserId: string | null,
): TodayReferentView {
  // Les options se comptent sur les DOSSIERS, pas sur les alertes : un agenda
  // mal réglé n'appartient à personne, et le faire compter pour un recruteur
  // donnerait un chiffre que rien ne permet de retrouver.
  const dossiers: Porteur[] = [
    ...board.validation.aLire.items,
    ...board.entretiens.aConfirmer.items,
    ...board.entretiens.aDecider.items,
  ];
  const options = buildReferentOptionsBy(dossiers, referentOf);
  const myCount = currentUserId
    ? dossiers.filter((d) =>
        matchesReferentBy(d, referentOf, { kind: 'recruiter', id: currentUserId }),
      ).length
    : 0;

  if (selection.kind === 'all') {
    return {
      board,
      masked: { validation: 0, entretiens: 0 },
      options,
      myCount,
      emptiedByFilter: false,
    };
  }

  const aLire = filterByReferentBy(board.validation.aLire.items, referentOf, selection);
  const aConfirmer = filterByReferentBy(
    board.entretiens.aConfirmer.items,
    referentOf,
    selection,
  );
  const aDecider = filterByReferentBy(
    board.entretiens.aDecider.items,
    referentOf,
    selection,
  );

  // ⚠️ « Passer en revue » est une FOURNÉE, pas une liste de lignes : on ne
  // sait pas, depuis l'écran d'accueil, quels dossiers elle contient. La
  // filtrer sur un référent afficherait un compte qu'on ne peut pas tenir —
  // on la laisse donc entière, et le compte « sur N » le dit.
  const filtre: TodayBoard = {
    ...board,
    validation: {
      ...board.validation,
      aLire: { items: aLire, total: aLire.length },
    },
    entretiens: {
      ...board.entretiens,
      aConfirmer: { items: aConfirmer, total: aConfirmer.length },
      aDecider: { items: aDecider, total: aDecider.length },
    },
  };
  filtre.validation.total = aLire.length + board.validation.aEcarter.total;
  filtre.entretiens.total = aConfirmer.length + aDecider.length;

  const masked = {
    validation: board.validation.aLire.total - aLire.length,
    entretiens:
      board.entretiens.aConfirmer.total -
      aConfirmer.length +
      (board.entretiens.aDecider.total - aDecider.length),
  };

  return {
    board: filtre,
    masked,
    options,
    myCount,
    // Vrai SEULEMENT si quelque chose attendait et que le filtre l'a tout
    // masqué : « il n'y a rien » et « le filtre cache tout » sont deux
    // situations différentes, et les confondre est le défaut qu'on répare.
    emptiedByFilter:
      !board.allClear &&
      filtre.validation.total === 0 &&
      filtre.entretiens.total === 0 &&
      masked.validation + masked.entretiens > 0,
  };
}
