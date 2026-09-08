/**
 * Domaines de valeurs ADEP (`docs/apec/apec-adep-nomenclature.xlsx`).
 *
 * Recopiés ici parce qu'ils sont la CONDITION de validité d'un flux : un code
 * hors domaine rend une erreur (319, 320, 396, 412, 400…) après coup, devant un
 * client. Les valider en local est gratuit.
 *
 * ⚠️ Le service `listDomainValues` du WSDL permet de LIRE ces domaines chez
 * l'Apec. On ne s'en sert pas pour l'instant — un domaine chargé au vol serait
 * une dépendance réseau sur le chemin d'un formulaire — mais `adep:probe` est
 * l'endroit naturel pour comparer la nomenclature ci-dessous à celle servie, le
 * jour où l'on soupçonne une dérive.
 */

/** `NIVEAU_EXPERIENCE_DOMAIN` — `Competency[GLOBAL_EXPERIENCE_LEVEL]`. */
export const NIVEAU_EXPERIENCE_CODES = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
] as const;
export const NIVEAU_EXPERIENCE_LABELS: Record<string, string> = {
  '1': "Tous niveaux d'expériences acceptés",
  '2': 'Aucune expérience exigée',
  '3': 'Minimum 1 an',
  '4': 'Minimum 2 ans',
  '5': 'Minimum 3 ans',
  '6': 'Minimum 4 ans',
  '7': 'Minimum 5 ans',
  '8': 'Minimum 6 ans',
  '9': 'Minimum 7 ans',
  '10': 'Minimum 8 ans',
  '11': 'Minimum 9 ans',
  '12': 'Minimum 10 ans',
};

/** `SALAIRE_TEXTE_DOMAIN` — `UserArea/DisplayedPay`. */
export const SALAIRE_TEXTE_CODES = ['1', '2', '3', '4', '5', '6'] as const;
export const SALAIRE_TEXTE_LABELS: Record<string, string> = {
  '1': 'À partir de X k€ brut annuel',
  '2': 'X – Y k€ brut annuel',
  '3': 'À négocier',
  '4': 'X € net mensuel',
  '5': 'Minimum légal',
  '6': 'Non renseignée',
};

/** `TEMPS_PARTIEL_DUREE_DOMAIN` — `UserArea/PartTimeDuration`. */
export const TEMPS_PARTIEL_DUREE_CODES = ['1', '2', '3', '4', '5'] as const;
export const TEMPS_PARTIEL_DUREE_LABELS: Record<string, string> = {
  '1': '4/5',
  '2': '3/5',
  '3': 'Mi-temps',
  '4': '2/5',
  '5': '1/5',
};

/** `CIVILITE_DOMAIN` — `HowToApply/PersonName/Affix[formOfAdress]`. */
export const CIVILITE_CODES = ['1', '2'] as const;
export const CIVILITE_LABELS: Record<string, string> = {
  '1': 'Madame',
  '2': 'Monsieur',
};

/** `TYPE_CONTRAT_DOMAIN` — `UserArea/JobType`. */
export const TYPE_CONTRAT_CODES = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
] as const;
export const TYPE_CONTRAT_LABELS: Record<string, string> = {
  '1': 'CDI',
  '2': "CDI - Alternance - Contrat d'apprentissage",
  '3': 'CDI - Alternance - Contrat de professionnalisation',
  '4': 'CDI intérimaire',
  '5': 'CDD',
  '6': "CDD - Alternance - Contrat d'apprentissage",
  '7': 'CDD - Alternance - Contrat de professionnalisation',
  '8': "Mission d'intérim",
  '9': 'Stage',
};

/**
 * Contrats qui EXIGENT une durée, et ceux qui l'INTERDISENT (API_397).
 *
 * La règle est portée par le type de contrat, jamais devinée du libellé : un
 * « CDI intérimaire » (4) est un CDI, et un « CDD - Alternance » (6, 7) est un
 * CDD. La lire dans le nom serait exactement la classe d'erreur que le
 * catalogue punit.
 */
export const JOB_TYPES_WITHOUT_DURATION = new Set(['1', '2', '3', '4']);
export const JOB_TYPES_WITH_DURATION = new Set(['5', '6', '7', '8', '9']);

/** `STATUT_OFFRE_DOMAIN` — `updatePositionStatus/newPositionStatus`. */
export const STATUT_OFFRE_CODES = [
  'PUBLIEE', 'SUSPENDUE', 'AMODIFIER', 'AVALIDER', 'FERMEE',
] as const;

/** `TYPE_OFFRE_DOMAIN` — `FormattedPositionDescription[POSITION_TYPE]`. */
export const POSITION_TYPES = ['ODD', 'ODC'] as const;
export const POSITION_TYPE_LABELS: Record<string, string> = {
  ODD: 'Offre domiciliée directe',
  ODC: 'Offre domiciliée directe confidentielle',
};

/** `TYPE_POSTE` — `UserArea/StatusJob`. */
export const STATUT_POSTE_CODES = [
  'CADRE_PRIVE', 'CADRE_PUBLIC', 'AGENT_DE_MAITRISE', 'STAGE',
] as const;
export const STATUT_POSTE_LABELS: Record<string, string> = {
  CADRE_PRIVE: 'Cadre privé',
  CADRE_PUBLIC: 'Cadre public',
  AGENT_DE_MAITRISE: 'Agent de maîtrise',
  STAGE: 'Stage',
};

/** `NIVEAU_ETUDE_DOMAIN` — offre de stage uniquement. */
export const NIVEAU_ETUDE_CODES = ['1', '2', '3', '4'] as const;
export const NIVEAU_ETUDE_LABELS: Record<string, string> = {
  '1': 'Bac+3',
  '2': 'Bac+4',
  '3': 'Bac+5',
  '4': '> Bac+5',
};

/** Zone de déplacement — `PhysicalLocation[LOCATION_ZONE_DEPLACEMENT]`. */
export const ZONE_DEPLACEMENT_CODES = [
  'AUCUN', 'DEPARTEMENT', 'REGIONAL', 'NATIONAL', 'UE', 'HORS_UE',
] as const;
export const ZONE_DEPLACEMENT_LABELS: Record<string, string> = {
  AUCUN: 'Aucun déplacement',
  DEPARTEMENT: 'Départemental',
  REGIONAL: 'Régional',
  NATIONAL: 'National',
  UE: 'Union européenne',
  HORS_UE: 'Hors Union européenne',
};

/** Types de télétravail — `UserArea/RemoteWork`. */
export const TELETRAVAIL_CODES = [
  'PONCTUEL_AUTORISE', 'PARTIEL_POSSIBLE', 'TOTAL_POSSIBLE',
] as const;
export const TELETRAVAIL_LABELS: Record<string, string> = {
  PONCTUEL_AUTORISE: 'Ponctuel autorisé',
  PARTIEL_POSSIBLE: 'Partiel possible',
  TOTAL_POSSIBLE: 'Total possible',
};

/**
 * Communes INTERDITES par l'Apec (API_356) : il faut l'arrondissement.
 *
 * Le message d'erreur qui accompagne cette règle doit dire quoi faire, pas
 * seulement que c'est refusé — d'où la table de correspondance.
 */
export const FORBIDDEN_INSEE_COMMUNES: Record<string, string> = {
  '75056': 'Paris — utiliser un arrondissement (75101 à 75120)',
  '69123': 'Lyon — utiliser un arrondissement (69381 à 69389)',
  '13055': 'Marseille — utiliser un arrondissement (13201 à 13216)',
};
