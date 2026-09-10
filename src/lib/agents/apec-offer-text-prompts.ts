/**
 * Cadrage du rédacteur des DEUX textes d'une offre APEC — descriptif du poste
 * et profil recherché. PUR : aucun appel réseau, aucune dépendance au
 * fournisseur de modèle (l'exécution vit dans
 * `server/apec-offer-text-write.ts`, la convention du projet).
 *
 * ── POURQUOI UN RÉDACTEUR, ET PAS UN REPORT ─────────────────────────────────
 *
 * Les deux champs étaient remplis par un REPORT de listes de la fiche de poste :
 * « Missions principales : - … » pour le descriptif, « Compétences recherchées :
 * - … » pour le profil. C'est exact, c'est traçable, et ça ne fait ni un
 * descriptif ni un profil : un candidat qui lit une offre attend de la prose
 * qui lui dit ce qu'il fera et s'il est concerné. Le report est donc rétrogradé
 * en REPLI, et les deux textes sont RÉDIGÉS.
 *
 * ── UN SEUL APPEL POUR LES DEUX ─────────────────────────────────────────────
 *
 * Le profil se déduit du descriptif : les écrire séparément, c'est risquer un
 * profil qui parle d'autre chose que le poste. Un appel, deux textes, cohérents
 * entre eux.
 *
 * ── CE QUE LE MODÈLE N'A PAS LE DROIT DE FAIRE ──────────────────────────────
 *
 * Inventer. Ni diplôme, ni nombre d'années, ni outil, ni mission absente des
 * éléments fournis. Il MET EN FORME le matériau du poste, il ne le complète
 * pas. C'est la règle de l'analyse de CV
 * (`feedback_cv_analysis_no_extrapolation`) prise par l'autre bout : une
 * exigence inventée ici écarterait de vrais candidats.
 *
 * ── LONGUEUR ────────────────────────────────────────────────────────────────
 *
 * Cible ~150 MOTS par texte, et la seule contrainte DURE est celle de l'Apec
 * (`ADEP_LIMITS` : descriptif 200-3000 caractères, profil 100-3000). On
 * n'invente aucune borne maison : le schéma de sortie porte les bornes du
 * canal, et `chatCompleteJson` re-demande au modèle avec l'erreur en clair
 * quand il déborde — plutôt que de nous laisser tronquer, ce que ce projet ne
 * fait jamais en silence.
 *
 * Seule soustraction admise : la place de la mention RGPD, apposée APRÈS le
 * modèle de façon déterministe. Le plafond du descriptif est donc réduit
 * d'autant, sinon un texte accepté par le schéma dépasserait la borne de l'Apec
 * une fois la mention ajoutée — et le compteur du formulaire passerait au rouge
 * sur un texte que personne n'a écrit trop long.
 */

/** Cible annoncée à l'humain et demandée au modèle, pour chaque texte. */
export const APEC_TEXT_TARGET_WORDS = 150;

export type ApecTextBounds = {
  descriptionMin: number;
  descriptionMax: number;
  profileMin: number;
  profileMax: number;
};

/**
 * Les bornes EFFECTIVES : celles de l'Apec, moins la place réservée à la
 * mention RGPD dans le descriptif. Calculées ICI et nulle part ailleurs — le
 * cadrage annoncé au modèle et le schéma qui le valide doivent porter les
 * mêmes nombres, sinon on lui reproche de déborder d'une borne qu'on ne lui a
 * pas dite. PURE — testée.
 */
export function apecTextBounds(
  limits: {
    positionDescriptionMin: number;
    positionDescriptionMax: number;
    profileDescriptionMin: number;
    profileDescriptionMax: number;
  },
  reservedForMention = 0,
): ApecTextBounds {
  return {
    descriptionMin: limits.positionDescriptionMin,
    descriptionMax: Math.max(
      limits.positionDescriptionMin,
      limits.positionDescriptionMax - Math.max(0, reservedForMention),
    ),
    profileMin: limits.profileDescriptionMin,
    profileMax: limits.profileDescriptionMax,
  };
}

/**
 * Met un texte du modèle en forme d'un champ APEC. PUR — testé.
 *
 * L'Apec affiche du texte brut : une marque Markdown, un tiret de liste ou un
 * retour à la ligne y arriveraient tels quels. On les retire ICI plutôt que de
 * les signaler, parce que le texte vient d'être fabriqué — il n'y a aucune
 * saisie humaine à respecter, contrairement à un descriptif repris d'une
 * annonce relue (cf. `prefill.ts`, qui ne reformate JAMAIS).
 *
 * Les paragraphes, eux, sont CONSERVÉS (une ligne vide) : 150 mots d'un seul
 * bloc se lisent mal, et l'Apec rend les sauts de ligne.
 *
 * Ne tronque rien : la longueur est tenue par le schéma de sortie du modèle,
 * qui la redemande plutôt que de laisser couper une phrase en deux.
 */
export function normalizeApecText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    // Puces et tirets de liste en début de ligne : les champs sont de la prose.
    .replace(/^[ \t]*[-*+•][ \t]+/gm, '')
    // Titres Markdown, gras, italique.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^\n*]+)\*\*/g, '$1')
    .replace(/\*([^\n*]+)\*/g, '$1')
    // Espaces multiples et tabulations, sans toucher aux retours à la ligne.
    .replace(/[ \t]+/g, ' ')
    // Trois lignes vides ou plus ⇒ une seule séparation de paragraphe.
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

export type ApecOfferTextInput = {
  jobTitle: string;
  /**
   * Le matériau à mettre en forme : le descriptif TEL QU'IL EST à l'écran
   * (annonce reprise, brouillon, report des missions) ou, à défaut, les
   * missions de la fiche. Le modèle reformule ceci — il n'écrit pas à côté.
   */
  sourceText: string;
  seniority: string;
  keySkills: string[];
  contractType: string;
};

export function buildApecOfferTextSystemPrompt(bounds: ApecTextBounds): string {
  return [
    "Tu rédiges les deux textes d'une offre d'emploi publiée sur l'Apec, à partir des éléments d'un poste : le DESCRIPTIF DU POSTE et le PROFIL RECHERCHÉ.",
    '',
    'RÈGLES ABSOLUES :',
    "- Tu n'INVENTES rien. Aucun diplôme, aucun nombre d'années, aucun outil, aucune certification, aucune mission qui ne figure pas dans les éléments fournis. Tu mets en forme le matériau donné, tu ne complètes pas le poste.",
    "- Si les éléments sont maigres, tu écris court et général plutôt que d'ajouter des exigences : une exigence inventée écarterait de vrais candidats.",
    "- Pas de titre, pas de liste à tirets, pas de mise en forme Markdown : de la prose. Deux ou trois paragraphes séparés par une ligne vide sont bienvenus.",
    "- Aucune formule creuse (« équipe dynamique », « environnement stimulant ») : elles ne disent rien du poste.",
    "- Pas de mention de rémunération, de lieu, ni du nom de l'organisation : ces informations vivent dans d'autres champs de l'offre.",
    "- N'écris AUCUNE mention de protection des données ou de conservation des candidatures : elle est ajoutée automatiquement après toi, à l'identique pour toutes les offres.",
    '',
    'DESCRIPTIF DU POSTE — ce que la personne fera : contexte, missions, responsabilités. Tu ne t’adresses pas encore au candidat comme à un profil, tu décris le travail.',
    "PROFIL RECHERCHÉ — à qui l'offre s'adresse : expérience attendue, compétences, savoir-être, au vouvoiement (« Vous justifiez… », « Vous maîtrisez… »). Il doit correspondre au descriptif que tu viens d'écrire, sans le répéter.",
    '',
    `LONGUEUR : environ ${APEC_TEXT_TARGET_WORDS} mots par texte. Contraintes DURES de l'Apec, à respecter impérativement : descriptif entre ${bounds.descriptionMin} et ${bounds.descriptionMax} caractères, profil entre ${bounds.profileMin} et ${bounds.profileMax} caractères.`,
    '',
    'FORMAT DE SORTIE — un objet JSON, exactement ces deux clés, aucun texte autour :',
    JSON.stringify({ descriptif: 'string', profil: 'string' }, null, 2),
  ].join('\n');
}

/** Borne le matériau envoyé (le maximum APEC, largement suffisant). */
const MAX_SOURCE_CHARS = 6_000;

export function buildApecOfferTextUserPrompt(input: ApecOfferTextInput): string {
  const lines: string[] = ['Éléments du poste :'];
  if (input.jobTitle.trim()) lines.push(`- Intitulé : ${input.jobTitle.trim()}`);
  if (input.contractType.trim()) lines.push(`- Contrat : ${input.contractType.trim()}`);
  if (input.seniority.trim()) lines.push(`- Séniorité attendue : ${input.seniority.trim()}`);
  const skills = input.keySkills.map((s) => s.trim()).filter(Boolean);
  if (skills.length > 0) lines.push(`- Compétences clés : ${skills.join(', ')}`);
  const source = input.sourceText.trim().slice(0, MAX_SOURCE_CHARS);
  if (source) {
    lines.push(
      '',
      'Matériau à mettre en forme (descriptif existant du poste, ou missions de la fiche) :',
      '"""',
      source,
      '"""',
    );
  }
  lines.push(
    '',
    "Rédige le descriptif du poste et le profil recherché de cette offre, en respectant les règles.",
  );
  return lines.join('\n');
}
