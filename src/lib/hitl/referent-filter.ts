/**
 * Filtre « Référent » de la file des validations suspendues.
 *
 * Le référent d'une validation est celui de sa CAMPAGNE
 * (`campaigns.owner_user_id` → `recruiters`), jamais une assignation portée par
 * la validation : il n'en existe aucune dans le modèle, et on n'en introduit
 * pas. Le filtre est une commodité de LECTURE — il ne restreint aucun accès,
 * tout reste consultable et actionnable par tous.
 *
 * ⚠️ Un référent DÉSACTIVÉ compte comme « non défini » (le cas transitoire du
 * recruteur sorti de l'espace) : il n'apparaît pas dans les entrées du filtre,
 * mais ses dossiers restent joignables par l'entrée « Référent non défini » —
 * une catégorie sans porte d'entrée masquerait des dossiers, ce qui est
 * exactement ce qu'un filtre ne doit jamais faire.
 *
 * Fonctions PURES (aucun accès base, aucun rendu).
 */

/** Projection minimale d'un référent, servie par `/api/validations`. */
export type ReferentInfo = {
  id: string;
  displayName: string;
  isActive: boolean;
};

/** Référent par identifiant de campagne. Absent/`null` = aucun référent. */
export type ReferentByCampaign = Readonly<
  Record<string, ReferentInfo | null | undefined>
>;

/**
 * Sélection courante. « Tous » est l'état par défaut ET l'état de réinit ;
 * `none` cible les campagnes sans référent actif.
 */
export type ReferentSelection =
  { kind: 'all' } | { kind: 'recruiter'; id: string } | { kind: 'none' };

export const ALL_REFERENTS: ReferentSelection = { kind: 'all' };

/** Clé stable d'une sélection — dépendance d'effet, jamais un identifiant. */
export function referentSelectionKey(selection: ReferentSelection): string {
  return selection.kind === 'recruiter'
    ? `recruiter:${selection.id}`
    : selection.kind;
}

/**
 * Référent ACTIF d'une campagne, ou `null` (pas de référent, campagne inconnue,
 * ou recruteur désactivé). POINT UNIQUE : le filtre et la mention portée par la
 * carte lisent tous deux cette fonction, pour qu'un dossier ne puisse pas
 * s'afficher « Réf. X » tout en étant classé ailleurs par le filtre.
 */
export function activeReferentOf(
  campaignId: string,
  referentByCampaign: ReferentByCampaign,
): ReferentInfo | null {
  const referent = referentByCampaign[campaignId];
  if (!referent || !referent.isActive) return null;
  return referent;
}

/** « Sarah Dupont » → « Sarah D. ». Un nom d'un seul mot est rendu tel quel. */
export function shortRecruiterName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return displayName.trim();
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(' ')} ${last.charAt(0).toUpperCase()}.`;
}

/** Initiales pour la pastille (1 à 2 lettres, jamais vide si le nom ne l'est pas). */
export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

type WithCampaign = { campaignId: string };

/**
 * Une validation entre-t-elle dans la sélection ? `all` laisse tout passer.
 */
export function matchesReferent(
  item: WithCampaign,
  referentByCampaign: ReferentByCampaign,
  selection: ReferentSelection,
): boolean {
  if (selection.kind === 'all') return true;
  const referent = activeReferentOf(item.campaignId, referentByCampaign);
  if (selection.kind === 'none') return referent === null;
  return referent?.id === selection.id;
}

export function filterByReferent<V extends WithCampaign>(
  items: readonly V[],
  referentByCampaign: ReferentByCampaign,
  selection: ReferentSelection,
): V[] {
  if (selection.kind === 'all') return [...items];
  return items.filter((item) =>
    matchesReferent(item, referentByCampaign, selection),
  );
}

export type ReferentOption = {
  selection: ReferentSelection;
  label: string;
  count: number;
};

/**
 * Entrées du sélecteur, comptées sur la file ENTIÈRE (les deux sous-onglets) :
 * le filtre s'applique aux deux, son compte doit donc parler des deux.
 *
 * Ordre : « Tous », puis les recruteurs ACTIFS ayant au moins un dossier
 * (compte décroissant, puis nom), puis « Référent non défini » — présent
 * seulement s'il y a quelque chose dedans.
 */
export function buildReferentOptions(
  items: readonly WithCampaign[],
  referentByCampaign: ReferentByCampaign,
): ReferentOption[] {
  const byRecruiter = new Map<string, { name: string; count: number }>();
  let none = 0;
  for (const item of items) {
    const referent = activeReferentOf(item.campaignId, referentByCampaign);
    if (!referent) {
      none += 1;
      continue;
    }
    const entry = byRecruiter.get(referent.id);
    if (entry) entry.count += 1;
    else byRecruiter.set(referent.id, { name: referent.displayName, count: 1 });
  }

  const recruiters: ReferentOption[] = [...byRecruiter.entries()]
    .map(([id, { name, count }]) => ({
      selection: { kind: 'recruiter' as const, id },
      label: shortRecruiterName(name),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));

  return [
    { selection: ALL_REFERENTS, label: 'Tous', count: items.length },
    ...recruiters,
    ...(none > 0
      ? [
          {
            selection: { kind: 'none' as const },
            label: 'Référent non défini',
            count: none,
          },
        ]
      : []),
  ];
}

/**
 * Compte du raccourci « Mes campagnes ». `null` (pas de session résolue) ⇒ 0 :
 * le raccourci se retire plutôt que de promettre une liste vide.
 */
export function myCampaignsCount(
  items: readonly WithCampaign[],
  referentByCampaign: ReferentByCampaign,
  currentUserId: string | null,
): number {
  if (!currentUserId) return 0;
  return items.filter(
    (item) =>
      activeReferentOf(item.campaignId, referentByCampaign)?.id ===
      currentUserId,
  ).length;
}
