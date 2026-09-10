/**
 * Cadrage du rédacteur de « profil recherché » d'une offre APEC. PUR — aucun
 * appel réseau, aucune dépendance au fournisseur de modèle (l'exécution vit
 * dans `server/apec-profile-write.ts`, la convention du projet).
 *
 * ── POURQUOI UN RÉDACTEUR, ET PAS UN REPORT ─────────────────────────────────
 *
 * Le champ était rempli par la LISTE des compétences clés de la fiche
 * (« Compétences recherchées : - Sage - fiscalité… »). C'est exact, c'est
 * traçable, et ça ne dresse aucun profil : un candidat qui lit une offre attend
 * une ou deux phrases qui lui disent s'il est concerné. Le report est donc
 * rétrogradé en REPLI, et le profil est RÉDIGÉ à partir de la fiche de poste et
 * du descriptif de l'offre.
 *
 * ── CE QUE LE MODÈLE N'A PAS LE DROIT DE FAIRE ──────────────────────────────
 *
 * Inventer. Ni diplôme, ni nombre d'années, ni outil, ni « équipe dynamique » :
 * il REFORMULE ce qui est fourni, il ne complète pas le poste. C'est la règle
 * de l'analyse de CV (`feedback_cv_analysis_no_extrapolation`) prise par
 * l'autre bout — une exigence inventée ici écarterait de vrais candidats.
 *
 * ── LONGUEUR ────────────────────────────────────────────────────────────────
 *
 * Cible ~150 caractères, bornes 120-260, portées par le SCHÉMA de sortie :
 * `chatCompleteJson` re-demande au modèle avec l'erreur en clair quand il
 * déborde, plutôt que de nous laisser tronquer (le projet ne tronque jamais en
 * silence). Le plancher de 120 tient l'exigence APEC des 100 caractères
 * (API_408) même après normalisation, qui ne peut que raccourcir.
 */

/** Cible annoncée à l'humain et demandée au modèle. */
export const APEC_PROFILE_TARGET_CHARS = 150;
/** Plancher : au-dessus des 100 caractères exigés par l'Apec, marge comprise. */
export const APEC_PROFILE_MIN_CHARS = 120;
export const APEC_PROFILE_MAX_CHARS = 260;

/**
 * Met le texte du modèle en forme d'un champ APEC. PUR — testé.
 *
 * L'Apec affiche du texte brut : une marque Markdown, un tiret de liste ou un
 * retour à la ligne y arriveraient tels quels. On les retire ICI plutôt que de
 * les signaler, parce que le texte vient d'être fabriqué — il n'y a aucune
 * saisie humaine à respecter, contrairement à un descriptif repris d'une
 * annonce relue (cf. `prefill.ts`, qui ne reformate JAMAIS).
 *
 * Ne tronque rien : la longueur est tenue par le schéma de sortie du modèle,
 * qui la redemande plutôt que de laisser couper une phrase en deux.
 */
export function normalizeApecProfile(raw: string): string {
  return raw
    .replace(/\r/g, '')
    // Puces et tirets de liste en début de ligne : le profil est du texte suivi.
    .replace(/^\s*[-*+•]\s+/gm, '')
    // Titres Markdown, gras, italique.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^\n*]+)\*\*/g, '$1')
    .replace(/\*([^\n*]+)\*/g, '$1')
    // Un profil est une à deux phrases : tout blanc devient une espace simple.
    .replace(/\s+/g, ' ')
    .trim();
}

export type ApecProfileInput = {
  jobTitle: string;
  /** Le descriptif du poste TEL QU'IL EST à l'écran — la source principale. */
  positionDescription: string;
  seniority: string;
  keySkills: string[];
  contractType: string;
};

export function buildApecProfileSystemPrompt(): string {
  return [
    "Tu rédiges la rubrique « Profil recherché » d'une offre d'emploi publiée sur l'Apec, à partir des éléments d'un poste.",
    '',
    'RÈGLES ABSOLUES :',
    "- Tu n'INVENTES rien. Aucun diplôme, aucun nombre d'années, aucun outil, aucune certification qui ne figure pas dans les éléments fournis. Tu reformules ce qui est donné, tu ne complètes pas le poste.",
    "- Si les éléments sont maigres, tu écris un profil court et général plutôt que d'ajouter des exigences : une exigence inventée écarterait de vrais candidats.",
    "- Tu t'adresses au candidat au vouvoiement (« Vous justifiez… », « Vous maîtrisez… »), sans le tutoyer et sans parler de l'entreprise.",
    '- Pas de titre, pas de liste à tirets, pas de mise en forme : une à deux phrases en texte courant.',
    "- Aucune formule creuse (« équipe dynamique », « environnement stimulant ») : elles ne disent rien du profil.",
    "- Pas de mention de rémunération, de lieu, ni du nom de l'organisation : ces informations vivent dans d'autres champs de l'offre.",
    '',
    `LONGUEUR : environ ${APEC_PROFILE_TARGET_CHARS} caractères, et impérativement entre ${APEC_PROFILE_MIN_CHARS} et ${APEC_PROFILE_MAX_CHARS} caractères.`,
    '',
    'FORMAT DE SORTIE — un objet JSON, exactement cette clé, aucun texte autour :',
    JSON.stringify({ profil: 'string' }, null, 2),
  ].join('\n');
}

/** Borne le descriptif envoyé (le maximum APEC, largement suffisant). */
const MAX_DESCRIPTION_CHARS = 3_000;

export function buildApecProfileUserPrompt(input: ApecProfileInput): string {
  const lines: string[] = ['Éléments du poste :'];
  if (input.jobTitle.trim()) lines.push(`- Intitulé : ${input.jobTitle.trim()}`);
  if (input.contractType.trim()) lines.push(`- Contrat : ${input.contractType.trim()}`);
  if (input.seniority.trim()) lines.push(`- Séniorité attendue : ${input.seniority.trim()}`);
  const skills = input.keySkills.map((s) => s.trim()).filter(Boolean);
  if (skills.length > 0) lines.push(`- Compétences clés : ${skills.join(', ')}`);
  const description = input.positionDescription.trim().slice(0, MAX_DESCRIPTION_CHARS);
  if (description) {
    lines.push('', 'Descriptif du poste tel qu’il sera publié :', '"""', description, '"""');
  }
  lines.push(
    '',
    'Rédige la rubrique « Profil recherché » de cette offre, en respectant les règles.',
  );
  return lines.join('\n');
}

