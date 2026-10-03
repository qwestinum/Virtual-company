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
import { oldestWaiting, type TodayBoard } from '@/lib/today/board';

/** Tout ce qui porte un référent sur cet écran. */
type Porteur = { referent: ReferentInfo | null; campaignId?: string | null };

const referentOf = (item: Porteur): ReferentInfo | null => item.referent;

export type TodayReferentView = {
  /** Le tableau tel qu'il doit s'afficher. */
  board: TodayBoard;
  /**
   * Ce que le filtre masque. `validation` = à lire + propositions ; le détail
   * sert l'annonce « · N masqués » de chaque sous-bloc. 0 quand rien ne filtre.
   */
  masked: { validation: number; aLire: number; aEcarter: number; entretiens: number };
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
  /**
   * Filtre d'ÉTAT de campagne, cumulé au référent (fix/vivier-replanif-
   * filtres, point 3). Absent : aucun filtre d'état. Un dossier sans campagne
   * n'est jamais masqué.
   */
  keepCampaign?: (campaignId: string) => boolean,
): TodayReferentView {
  // Les options se comptent sur les DOSSIERS, pas sur les alertes : un agenda
  // mal réglé n'appartient à personne, et le faire compter pour un recruteur
  // donnerait un chiffre que rien ne permet de retrouver.
  const dossiers: Porteur[] = [
    ...board.validation.aLire.items,
    ...board.validation.aEcarter.items,
    ...board.entretiens.aConfirmer.items,
    ...board.entretiens.aDecider.items,
  ];
  const options = buildReferentOptionsBy(dossiers, referentOf);
  const myCount = currentUserId
    ? dossiers.filter((d) =>
        matchesReferentBy(d, referentOf, { kind: 'recruiter', id: currentUserId }),
      ).length
    : 0;

  if (selection.kind === 'all' && !keepCampaign) {
    return {
      board,
      masked: { validation: 0, aLire: 0, aEcarter: 0, entretiens: 0 },
      options,
      myCount,
      emptiedByFilter: false,
    };
  }

  const garde = <T extends Porteur>(items: T[]): T[] =>
    filterByReferentBy(items, referentOf, selection).filter(
      (i) => !keepCampaign || !i.campaignId || keepCampaign(i.campaignId),
    );
  const aLire = garde(board.validation.aLire.items);
  const aConfirmer = garde(board.entretiens.aConfirmer.items);
  const aDecider = garde(board.entretiens.aDecider.items);

  // « Passer en revue » est une FOURNÉE, mais ses fiches sont connues (avec
  // leur campagne) : elle se filtre COMME le reste de la carte (03/10/2026).
  // La laisser entière faisait masquer les deux « à examiner » d'un référent
  // pendant que ses treize propositions restaient affichées. La revue groupée
  // porte le même filtre partagé : on y retrouve ce que l'accueil annonçait.
  const aEcarter = garde(board.validation.aEcarter.items);
  const filtre: TodayBoard = {
    ...board,
    validation: {
      ...board.validation,
      aLire: { items: aLire, total: aLire.length },
      aEcarter: {
        ...board.validation.aEcarter,
        items: aEcarter,
        total: aEcarter.length,
        oldestDays: oldestWaiting(aEcarter),
      },
    },
    entretiens: {
      ...board.entretiens,
      aConfirmer: { items: aConfirmer, total: aConfirmer.length },
      aDecider: { items: aDecider, total: aDecider.length },
    },
  };
  // ⚠️ LE TOTAL DU SUJET N'EST PAS FILTRÉ (03/10/2026). Le titre de la carte
  // est une affirmation — « 12 candidatures attendent votre validation » — et
  // elle doit rester vraie quel que soit le filtre : retirer du total ce que
  // le filtre masque (dont, par défaut, les campagnes non actives) faisait
  // annoncer un chiffre faux. Les LIGNES sont filtrées ; les sous-blocs
  // disent « · N masqués ». Un dossier caché reste compté.
  filtre.validation.total = board.validation.total;
  filtre.entretiens.total = board.entretiens.total;
  const shownValidation = aLire.length + aEcarter.length;
  const shownEntretiens = aConfirmer.length + aDecider.length;

  const maskedALire = board.validation.aLire.total - aLire.length;
  const maskedAEcarter = board.validation.aEcarter.total - aEcarter.length;
  const masked = {
    validation: maskedALire + maskedAEcarter,
    aLire: maskedALire,
    aEcarter: maskedAEcarter,
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
      shownValidation === 0 &&
      shownEntretiens === 0 &&
      masked.validation + masked.entretiens > 0,
  };
}
