/**
 * Catalogue des erreurs ADEP → messages français orientés ACTION.
 *
 * Source : `docs/apec/dsiapec-ADEP - Catalogue des erreurs.pdf`.
 *
 * Le principe est celui du Manager RH : on ne montre jamais
 * `API_397_INVALID_CON_AND_DURATION_ERROR` à un recruteur. On lui dit « un CDI
 * ne peut pas avoir de durée de contrat » et on pointe le champ. Le code brut
 * reste au journal, jamais perdu — c'est lui qu'on colle au support Apec.
 *
 * Trois natures d'erreur, et elles n'appellent pas la même phrase :
 *
 *   · `field`  — le recruteur peut corriger, ici, maintenant ;
 *   · `account`— la convention ou l'habilitation Apec est en cause ; personne
 *                dans ORQA n'y peut rien, il faut contacter l'Apec ;
 *   · `apec`   — panne ou incident côté Apec ; on donne le code pour le support.
 *
 * Confondre les trois produit le pire message possible : « corrigez votre
 * saisie » sur un problème d'habilitation fait chercher pendant une heure.
 */

export type AdepErrorNature = 'field' | 'account' | 'apec';

export type AdepErrorEntry = {
  nature: AdepErrorNature;
  /** Phrase montrable telle quelle. */
  message: string;
  /** Champ de l'écran à ouvrir, quand il y en a un. */
  field?: string;
};

export const ADEP_ERROR_CATALOGUE: Record<string, AdepErrorEntry> = {
  // ── Transport et transaction ────────────────────────────────────────────
  '002': { nature: 'apec', message: "L'Apec n'a pas su lire le flux envoyé (erreur interne de son côté)." },
  '023': { nature: 'apec', message: "Le flux envoyé n'est pas conforme au schéma attendu par l'Apec." },
  '100': { nature: 'apec', message: "Erreur interne de l'Apec à l'initialisation du traitement." },
  '102': { nature: 'account', message: "La clé d'authentification ADEP est refusée. Elle doit être régénérée." },
  '103': { nature: 'account', message: "Le recruteur n'est pas connu de l'Apec." },
  '105': { nature: 'apec', message: "L'identifiant de transaction a été refusé." },
  '106': { nature: 'account', message: "Aucun moyen d'authentification n'a été transmis." },
  '108': { nature: 'apec', message: "L'identifiant de transaction a déjà été utilisé." },

  // ── Candidature ─────────────────────────────────────────────────────────
  '303': { nature: 'field', field: 'applicationEmail', message: 'Il faut une adresse ou une URL pour recevoir les candidatures.' },
  '304': { nature: 'field', field: 'applicationUrl', message: "Le format de l'URL de candidature n'est pas accepté." },
  '308': { nature: 'field', field: 'applicationEmail', message: "L'adresse de réception des candidatures est absente ou mal formée." },
  '378': { nature: 'field', field: 'applicationEmail', message: 'Aucune adresse de réception des candidatures.' },
  '379': { nature: 'field', field: 'applicationEmail', message: "L'adresse de réception dépasse 240 caractères." },
  '1336': { nature: 'field', field: 'applicationUrl', message: "Une offre confidentielle n'accepte pas d'URL de candidature." },

  // ── Identité de l'offre ─────────────────────────────────────────────────
  '309': { nature: 'field', field: 'clientPositionId', message: 'La référence de l’offre est absente ou dépasse 20 caractères.' },
  '390': { nature: 'field', field: 'clientPositionId', message: "Cette référence est déjà utilisée par une offre chez l'Apec." },
  '391': { nature: 'field', field: 'clientPositionId', message: "L'Apec ne connaît pas cette référence d'offre." },
  '392': { nature: 'field', field: 'apecPositionNumero', message: "Aucune offre ne correspond à ce numéro Apec." },
  '393': { nature: 'field', message: "Aucun identifiant d'offre n'a été fourni." },

  // ── Entreprise ──────────────────────────────────────────────────────────
  '310': { nature: 'field', field: 'finalClient.siret', message: 'Le numéro SIRET du client est absent ou invalide.' },
  '311': { nature: 'field', field: 'nafCode', message: 'Le code NAF est absent ou invalide.' },
  '312': { nature: 'apec', message: "L'entreprise rattachée à l'offre est introuvable dans la base Apec." },
  '329': { nature: 'account', message: "Votre convention Apec n'autorise pas le mode « client direct »." },
  '330': { nature: 'account', message: "Votre convention Apec n'autorise pas le mode « client indirect » (réservé aux cabinets, ETT et PRISME)." },
  '375': { nature: 'field', field: 'finalClient.organizationName', message: 'La raison sociale du client est invalide (38 caractères maximum).' },
  '387': { nature: 'field', field: 'finalClient.nafCode', message: "Le secteur d'activité du client (code NAF) est absent." },
  '1371': { nature: 'apec', message: "L'entreprise du recruteur est introuvable dans la base Apec." },
  '1372': { nature: 'apec', message: "L'entreprise qui diffuse l'offre est introuvable dans la base Apec." },
  '1373': { nature: 'apec', message: "Plusieurs entreprises correspondent aux données fournies ; l'Apec doit trancher." },
  '1398': { nature: 'field', field: 'jobType', message: "Le mode « client indirect » est incompatible avec ce type de contrat (notamment l'intérim)." },
  '1400': { nature: 'field', field: 'nafCode', message: 'Aucun code NAF trouvé.' },

  // ── Le poste ────────────────────────────────────────────────────────────
  '315': { nature: 'field', field: 'positionTitle', message: "La fonction du poste n'est pas reconnue." },
  '316': { nature: 'field', field: 'positionTitle', message: "L'intitulé dépasse la limite (76 caractères sans la mention H/F, 80 avec)." },
  '319': { nature: 'field', field: 'experienceLevel', message: "Le niveau d'expérience n'est pas une valeur acceptée." },
  '413': { nature: 'field', field: 'experienceLevel', message: "Le niveau d'expérience n'a pas été fourni." },
  '320': { nature: 'field', field: 'jobType', message: "Ce type de contrat n'est pas accepté (vérifiez aussi ce que votre convention Apec autorise)." },
  '321': { nature: 'field', field: 'numberToFill', message: 'Le nombre de postes doit être compris entre 1 et 10.' },
  '322': { nature: 'field', field: 'positionType', message: "Le type d'offre est invalide." },
  '363': { nature: 'field', field: 'statusJob', message: 'Le statut du poste est invalide.' },
  '394': { nature: 'field', field: 'durationMonths', message: 'La durée du contrat doit être un nombre de mois entre 1 et 99.' },
  '395': { nature: 'account', message: "Ce statut de poste est incompatible avec votre convention (une SSII ne peut pas publier de poste « cadre public »)." },
  '396': { nature: 'field', field: 'statusJob', message: 'Le statut du poste doit être « cadre privé », « cadre public » ou « agent de maîtrise ».' },
  '397': { nature: 'field', field: 'durationMonths', message: 'Un CDI ne peut pas porter de durée de contrat.' },
  '1385': { nature: 'field', field: 'experienceLevel', message: "Le niveau d'expérience global est absent du flux." },
  '1389': { nature: 'field', field: 'numberToFill', message: "Le nombre de postes à pourvoir n'a pas été fourni." },

  // ── Rémunération et temps de travail ────────────────────────────────────
  '317': { nature: 'field', field: 'salaryMin', message: "Le salaire minimum n'est pas valide." },
  '318': { nature: 'field', field: 'salaryMax', message: "Le salaire maximum n'est pas valide." },
  '333': { nature: 'field', field: 'displayedPay', message: "L'affichage du salaire est absent ou invalide." },
  '412': { nature: 'field', field: 'displayedPay', message: "Le mode d'affichage du salaire est obligatoire." },
  '400': { nature: 'field', field: 'partTimeDuration', message: 'Un poste à temps partiel doit préciser sa modalité (4/5, mi-temps…).' },
  '405': { nature: 'field', field: 'partTime', message: "L'indicateur de temps partiel est obligatoire." },
  '417': { nature: 'field', field: 'displayedPay', message: "Le mode d'affichage du salaire est obligatoire pour une offre de stage." },
  // ⚠️ Seul code du catalogue à ne PAS porter le préfixe `API_` :
  // `ERECRUT_STAGE_418_EDUCATION_LEVEL_ERROR`. C'est pour lui que
  // `extractErrorCode` accepte deux formes de nom.
  '418': { nature: 'field', field: 'educationLevel', message: "Le niveau d'étude est obligatoire pour une offre de stage." },

  // ── Lieux ───────────────────────────────────────────────────────────────
  '323': { nature: 'field', field: 'inseeCode', message: 'Aucun lieu de poste valide.' },
  '324': { nature: 'field', field: 'numberToFill', message: 'Il y a plus de lieux que de postes à pourvoir.' },
  '326': { nature: 'field', field: 'inseeCode', message: 'Une offre qui porte une région ne peut porter aucun autre lieu.' },
  '327': { nature: 'field', field: 'inseeCode', message: "L'adresse du poste est vide." },
  '336': { nature: 'field', field: 'inseeCode', message: 'Le libellé du lieu dépasse 18 caractères.' },
  '354': { nature: 'field', field: 'inseeCode', message: 'Le type de lieu est absent ou invalide.' },
  '355': { nature: 'field', field: 'travelZone', message: 'La zone de déplacement est absente ou invalide.' },
  '356': { nature: 'field', field: 'inseeCode', message: 'Cette commune est refusée par l’Apec — Paris, Lyon et Marseille se publient par arrondissement.' },
  '364': { nature: 'field', field: 'inseeCode', message: "L'Apec ne diffuse pas d'offre en Suisse." },
  '365': { nature: 'field', field: 'inseeCode', message: "L'Apec ne diffuse pas d'offre en Suisse." },
  '1374': { nature: 'apec', message: "Aucun lieu n'a pu être rattaché à l'offre dans la base Apec." },

  // ── Textes ──────────────────────────────────────────────────────────────
  '331': { nature: 'field', field: 'positionDescription', message: 'Le descriptif du poste dépasse 3 000 caractères.' },
  '332': { nature: 'field', field: 'positionDescription', message: 'Le descriptif du poste est vide.' },
  '337': { nature: 'field', field: 'positionDescription', message: 'Le descriptif du poste doit faire au moins 200 caractères.' },
  '338': { nature: 'field', field: 'positionDescription', message: 'Le texte contient des balises non autorisées.' },
  '406': { nature: 'field', field: 'organizationName', message: "L'enseigne affichée est obligatoire (255 caractères maximum)." },
  '407': { nature: 'field', field: 'organizationDescription', message: "La description de l'entreprise doit faire entre 100 et 3 000 caractères." },
  '408': { nature: 'field', field: 'profileDescription', message: 'La description du profil doit faire entre 100 et 3 000 caractères.' },
  '409': { nature: 'field', field: 'presentationDescription', message: 'Les conseils aux candidats dépassent 500 caractères.' },
  '410': { nature: 'field', field: 'recruitmentDescription', message: 'Le processus de recrutement dépasse 500 caractères.' },
  '411': { nature: 'field', field: 'videoUrl', message: "L'URL de la vidéo n'est pas acceptée (YouTube, Vimeo ou Dailymotion)." },
  '1379': { nature: 'field', field: 'positionDescription', message: 'Aucun contenu trouvé pour le corps de l’offre.' },
  '1408': { nature: 'field', field: 'organizationDescription', message: "La description de l'entreprise est présente en double dans le flux." },
  '1409': { nature: 'field', field: 'profileDescription', message: 'La description du profil est présente en double dans le flux.' },
  '1410': { nature: 'field', field: 'presentationDescription', message: 'Les conseils aux candidats sont présents en double dans le flux.' },
  '1411': { nature: 'field', field: 'recruitmentDescription', message: 'Le processus de recrutement est présent en double dans le flux.' },
  '1412': { nature: 'field', field: 'organizationName', message: "L'enseigne affichée est présente en double dans le flux." },

  // ── Logo et confidentialité ─────────────────────────────────────────────
  '366': { nature: 'field', field: 'displayLogo', message: "L'affichage du logo n'est pas renseigné." },
  '369': { nature: 'field', field: 'displayLogo', message: "L'information sur le logo est invalide." },
  '388': { nature: 'field', field: 'positionType', message: "Les réglages de confidentialité de l'offre sont invalides." },
  '1378': { nature: 'field', field: 'displayLogo', message: "L'information sur le logo est invalide." },
  '1388': { nature: 'field', field: 'displayLogo', message: "L'affichage du logo est vide ou invalide." },

  // ── Contact de suivi ────────────────────────────────────────────────────
  '313': { nature: 'field', field: 'applyContact.civility', message: 'La civilité du contact ne fait pas partie des valeurs attendues.' },
  '370': { nature: 'field', field: 'applyContact.givenName', message: 'Le prénom du contact est invalide.' },
  '371': { nature: 'field', field: 'applyContact.familyName', message: 'Le nom du contact est invalide.' },
  '382': { nature: 'field', field: 'applyContact.givenName', message: 'Le prénom du contact dépasse 30 caractères.' },
  '383': { nature: 'field', field: 'applyContact.familyName', message: 'Le nom du contact dépasse 30 caractères.' },
  '404': { nature: 'field', field: 'applyContact', message: 'Le contact de suivi doit être complet : civilité, prénom, nom et fonction.' },
  '372': { nature: 'field', message: 'Le code postal du client est invalide.' },
  '373': { nature: 'field', message: 'La ville du client est invalide.' },
  '374': { nature: 'field', message: "Une ligne d'adresse du client est invalide." },
  '376': { nature: 'field', message: 'Le téléphone du contact client est invalide.' },

  // ── Dates ───────────────────────────────────────────────────────────────
  '402': { nature: 'field', field: 'datePositionTaken', message: 'La date de prise de poste doit être aujourd’hui ou plus tard.' },
  '403': { nature: 'field', field: 'releaseDate', message: 'La date de publication doit être comprise entre aujourd’hui et J+60, et précéder la prise de poste.' },

  // ── Cycle de vie ────────────────────────────────────────────────────────
  '340': { nature: 'field', message: "Le statut demandé n'est pas valide." },
  '350': { nature: 'field', message: "Aucun nouveau statut n'a été précisé." },
  '351': { nature: 'field', message: "Le statut demandé n'est pas reconnu par l'Apec." },
  '352': { nature: 'field', message: "Ce changement de statut n'est pas autorisé depuis l'état actuel de l'offre." },
  '353': { nature: 'field', message: "L'offre est déjà dans cet état ; rien n'a été changé." },
  '361': { nature: 'field', message: 'Cette offre a été publiée il y a plus de 30 jours : l’Apec n’autorise plus sa republication. Il faut créer une nouvelle offre.' },
  '362': { nature: 'field', message: "Les offres cadre du secteur public ne peuvent pas être republiées." },
  '398': { nature: 'apec', message: "La modification d'une offre publiée n'est plus possible via ADEP — passez par apec.fr ou le support Apec." },
  '399': { nature: 'apec', message: "L'offre a bien été créée mais l'Apec n'a pas pu la publier ; un consultant va la reprendre." },
  '367': { nature: 'apec', message: "La condition de validation de l'offre n'est pas renseignée." },
  '368': { nature: 'apec', message: "La condition de validation de l'offre n'est pas remplie." },

  // ── Structure du flux ───────────────────────────────────────────────────
  '335': { nature: 'field', message: "L'indicateur de profil international est invalide." },
  '1376': { nature: 'field', message: "La langue de l'offre est incorrecte (seul le français est accepté)." },
  '1377': { nature: 'field', field: 'positionDescription', message: "Le corps de l'offre est mal renseigné, ou la balise d'offre apparaît plusieurs fois." },
  '1380': { nature: 'apec', message: "Structure invalide dans le bloc « fournisseur d'offre » (attribut relationship)." },
  '1381': { nature: 'apec', message: 'Structure invalide dans le bloc « profil de poste ».' },
  '1382': { nature: 'apec', message: 'Structure invalide dans le bloc « organisation ».' },
  '1383': { nature: 'apec', message: 'Structure invalide dans le bloc « détail du poste ».' },
  '1384': { nature: 'field', field: 'jobType', message: 'La classification du poste est incorrecte.' },
  '1386': { nature: 'field', field: 'positionType', message: "Le type d'offre (ODD ou ODC) est absent du flux." },
  '1390': { nature: 'apec', message: 'Structure invalide dans le bloc « contact de l’organisation ».' },
  '1391': { nature: 'apec', message: 'Structure invalide : nom du contact de l’organisation.' },
  '1392': { nature: 'apec', message: 'Structure invalide : méthode de contact de l’organisation.' },
  '1393': { nature: 'apec', message: 'Structure invalide : adresse postale de l’organisation.' },
  '1397': { nature: 'apec', message: 'Structure invalide dans le bloc « comment postuler ».' },
  '1399': { nature: 'field', field: 'finalClient.organizationName', message: "L'organisation ou sa raison sociale n'a pas été fournie." },
};

/**
 * Le code numérique d'un message d'exception. Les deux formes existent dans
 * les flux : `ExceptionIdentifier` seul (`330`), ou seulement le nom
 * (`API_330_CLIENT_INDIRECT_ACCESS_ERROR`) quand l'identifiant est omis — il
 * est `minOccurs="0"` au schéma. On sait donc lire les deux. PUR.
 */
export function extractErrorCode(input: {
  code?: string | null;
  message?: string | null;
}): string | null {
  const direct = input.code?.trim();
  if (direct) return direct;
  // Deux préfixes existent : `API_<code>_…` partout, et
  // `ERECRUT_STAGE_418_…` pour le seul code du volet stage. Ne lire que
  // le premier rendrait ce code introuvable au catalogue.
  const fromName = /^(?:API|ERECRUT_STAGE)_(\d+)_/.exec(input.message?.trim() ?? '');
  return fromName?.[1] ?? null;
}

/**
 * Traduit une exception en phrase montrable. Un code INCONNU n'est jamais
 * escamoté : on rend le nom brut, parce qu'un message vide devant un rejet est
 * pire qu'un message technique.
 */
export function describeAdepError(input: {
  code?: string | null;
  message?: string | null;
}): AdepErrorEntry {
  const code = extractErrorCode(input);
  const known = code ? ADEP_ERROR_CATALOGUE[code] : undefined;
  if (known) return known;
  const label = input.message?.trim() || code || 'erreur inconnue';
  return {
    nature: 'apec',
    message: `L'Apec a refusé l'offre pour une raison non répertoriée (${label}). Transmettez ce code au support ADEP.`,
  };
}
