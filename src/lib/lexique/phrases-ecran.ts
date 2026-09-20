/**
 * PHRASES D'ÉCRAN — le lexique, étendu des statuts aux ACTIONS et aux TITRES.
 *
 * Le lexique du lot 1 fixait les mots des ÉTATS (« À valider », « Invité »,
 * « Sans suite »…). Il ne disait rien de la façon dont un écran s'adresse à
 * son lecteur, et l'écran d'accueil parlait donc la langue du code : on y
 * « arbitrait » des « dossiers » dans une « zone », entre deux « seuils ».
 *
 * DEUX RÈGLES, et elles ne sont pas négociables :
 *
 *  1. **Un titre est une phrase complète** — sujet, verbe, objet — que le
 *     recruteur pourrait dire lui-même. « À décider » n'est pas une phrase,
 *     c'est une étiquette de tiroir.
 *  2. **Du point de vue du recruteur, jamais de l'outil.** Et quand l'outil
 *     intervient, on le DIT (« l'outil vous propose de… », « l'outil ne
 *     tranche pas »). Un produit qui décrit ses propres mécanismes comme s'ils
 *     allaient de soi oblige son lecteur à apprendre sa plomberie.
 *
 * Test de recevabilité : la phrase lue à quelqu'un qui ne connaît pas ORQA
 * doit être comprise sans question.
 *
 * ⚠️ Ces phrases sont la SOURCE : elles se réutilisent telles quelles partout
 * (écrans, Manager, mails de synthèse, documentation). Une phrase recopiée
 * ailleurs finirait par diverger, et personne ne verrait la divergence.
 */

/** Accord singulier/pluriel sans répéter la condition dans chaque phrase. */
const s = (n: number): string => (n > 1 ? 's' : '');

export const PHRASES = {
  /** Candidatures dont la note tombe entre les deux repères de la campagne. */
  decision: {
    titre: (n: number) =>
      `${n} candidature${s(n)} attend${n > 1 ? 'ent' : ''} votre décision`,
    /** Ce que fait l'outil, dit explicitement. */
    sousTitre:
      'L’outil ne tranche pas : leur note se situe entre vos deux repères.',
    vide: 'Aucune candidature n’attend votre décision',
    action: 'Voir la candidature',
    resume: (n: number) => `${n} décision${s(n)} à prendre`,
  },

  /** Candidatures sous le repère bas : l'outil propose de les écarter. */
  ecarter: {
    /**
     * « en dessous de VOS critères », pas « trop faibles » : le barème est
     * celui du cabinet, pas un jugement que l'outil porterait sur des gens.
     */
    titre: (n: number) =>
      `${n} candidature${s(n)} en dessous de vos critères — l’outil vous propose de les écarter`,
    sousTitre:
      'Rien n’est envoyé sans vous : vous relisez la liste, puis vous décidez.',
    vide: 'Aucune candidature à écarter',
    action: 'Les passer en revue',
    resume: (n: number) => `${n} candidature${s(n)} en dessous de vos critères`,
  },

  /** Entretiens qui attendent qu'on dise ce qui s'est passé, puis le verdict. */
  entretiens: {
    titre: (n: number) => `${n} entretien${s(n)} à conclure`,
    sousTitre:
      'Dites ce qui s’est passé, puis si vous retenez le candidat.',
    vide: 'Aucun entretien à conclure',
    /** Deux questions, dans l'ordre où elles se posent. */
    questionEuLieu: 'A-t-il eu lieu ?',
    questionRetenu: 'Retenez-vous ce candidat ?',
    action: 'Répondre',
    resume: (n: number) => `${n} entretien${s(n)} à conclure`,
  },

  /**
   * Réglages et campagnes qui vont poser problème. Jamais un candidat.
   *
   * ⚠️ Le titre ne dit PAS « sur vos campagnes » : la section recueille aussi
   * des réglages personnels (un agenda qui propose un jour férié, un lieu de
   * rencontre manquant). Un titre qui promet « vos campagnes » et montre votre
   * agenda se corrige tout seul dans la tête du lecteur — au prix d'une
   * hésitation à chaque lecture.
   */
  regler: {
    titre: (n: number) => `${n} point${s(n)} à régler`,
    sousTitre:
      'Vos campagnes et vos réglages — rien ici ne concerne un candidat en particulier.',
    vide: 'Rien à régler',
    resume: (n: number) => `${n} point${s(n)} à régler`,
  },

  /** Rien nulle part. Une phrase, centrée, et on s'arrête là. */
  toutEstFait: 'Rien ne vous attend aujourd’hui.',

  /** Une lecture n'a pas abouti : ne jamais laisser croire que tout est fait. */
  lectureIncomplete:
    'Une partie de vos informations n’a pas pu être chargée — cette page est peut-être incomplète.',
  reessayer: 'Réessayer',
} as const;

/**
 * Mots BANNIS de tout texte lu par un utilisateur.
 *
 * Ce sont les mots du modèle interne. Ils décrivent fidèlement le code et ne
 * décrivent rien de ce que la personne devant l'écran essaie de faire.
 *
 * Le test négatif porte sur le RENDU, commentaires retirés : un commentaire a
 * le devoir d'expliquer un mécanisme avec ses vrais mots — c'est à l'écran que
 * ces mots n'ont rien à faire.
 *
 * Correspondance par FRONTIÈRE DE MOT : « file » ne doit pas accuser
 * « fichier », ni « zone » accuser « horizon ».
 */
export const MOTS_BANNIS_A_L_ECRAN = [
  'seuil',
  'bande de validation',
  'pointer',
  'pointage',
  'arbitrer',
  'arbitrage',
  'fiche de validation',
  'file',
  'non décidable',
  'non décidables',
  'cohérent',
  'cohérente',
  'incohérent',
  'dossier',
  'zone',
] as const;

/**
 * ⚠️ « ANALYSE » n'est pas dans la liste, et c'est une décision, pas un oubli.
 *
 * Le mot est banni AU SENS INTERNE — « l'analyse » comme objet de base, celui
 * qui porte un uid et une zone. Il reste juste quand il décrit ce que la
 * personne demande : « relancer l'analyse de ce CV » se comprend sans rien
 * connaître d'ORQA, et le proscrire obligerait à dire moins bien.
 *
 * Aucune règle automatique ne sépare les deux : les deux emplois s'écrivent
 * pareil. Il se tient donc À LA RELECTURE, et pas par un test — inscrire une
 * règle qu'on ne peut pas faire respecter reviendrait à la désactiver.
 */
export const ANALYSE_SE_TIENT_A_LA_RELECTURE = true;
