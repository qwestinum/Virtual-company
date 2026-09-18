/**
 * Le commentaire du recruteur a-t-il un minimum de SENS ? — PUR, CLIENT-SAFE.
 * Spec : docs/specs/compte-rendu-entretien.md §14.1.
 *
 * Le commentaire justifie un verdict (GO définitif / non retenu). Il est
 * obligatoire pour tout NOUVEAU verdict, et c'est la route de verdict — pas
 * l'écran — qui l'exige. L'écran appelle la MÊME fonction pour afficher le
 * compteur et la raison du refus : une règle recopiée dans deux endroits
 * finirait par dire deux choses.
 *
 * Pourquoi des MOTS et pas des caractères : « ok pour moi, bon profil » fait
 * 24 caractères et ne dit rien. L'objectif n'est pas la longueur, c'est
 * qu'on ne puisse pas cocher une case déguisée en commentaire.
 *
 *   - un MOT = une suite de lettres (apostrophes et traits d'union internes
 *     admis : « qu'il », « peut-être ») portant au moins 2 lettres. Chiffres,
 *     ponctuation, émojis, lettres isolées ne comptent pas ;
 *   - au moins 15 mots, dont 10 DISTINCTS (casse et accents ignorés) :
 *     « bla bla bla… » ×15 ne passe pas.
 *
 * « Une phrase complète » n'est PAS un critère alternatif : « Ok pour moi. »
 * en est une. Quinze mots distincts forment de fait une phrase, et se
 * mesurent sans ambiguïté.
 *
 * ⚠️ Aucune règle mécanique n'empêche d'écrire quinze mots creux. Celle-ci
 * empêche la case cochée ; la qualité du motif relève de l'encadrement, et le
 * commentaire, signé et daté, est relu dans le PDF d'audit.
 *
 * ⚠️ Couplage avec la base : `verdict_comments_body_chk` pose un PLANCHER en
 * caractères, qui doit rester SOUS le plus court texte que cette règle
 * accepte (`MIN_ACCEPTED_CHARS`). Sinon la base refuse ce que la route a
 * accepté — un 500 à la place d'un 400 lisible. Test dédié.
 */

export const MIN_COMMENT_WORDS = 15;
export const MIN_COMMENT_DISTINCT_WORDS = 10;
/** Lettres minimales d'un mot compté. */
export const MIN_WORD_LETTERS = 2;

/**
 * Le plus court texte que la règle accepte : 15 mots de 2 lettres, séparés
 * par un caractère. C'est la borne haute du plancher posé en base.
 */
export const MIN_ACCEPTED_CHARS =
  MIN_COMMENT_WORDS * MIN_WORD_LETTERS + (MIN_COMMENT_WORDS - 1);

export type CommentShortfall = 'too_few_words' | 'too_repetitive';

export type CommentSubstance = {
  ok: boolean;
  /** Mots comptés (au sens ci-dessus). */
  words: number;
  distinctWords: number;
  /** Mots encore nécessaires pour atteindre le seuil (0 si atteint). */
  missingWords: number;
  shortfall: CommentShortfall | null;
};

// Une lettre, puis des lettres ; apostrophe ou trait d'union seulement ENTRE
// deux lettres. Appliqué sur du texte NFC : en NFD, un « é » se décompose en
// « e » + accent combinant, qui n'est pas une lettre — le mot serait coupé.
const WORD_RE = /\p{L}+(?:['’\-]\p{L}+)*/gu;
const LETTER_RE = /\p{L}/gu;

function letterCount(token: string): number {
  return token.match(LETTER_RE)?.length ?? 0;
}

/** Forme de comparaison : minuscules, sans accent, apostrophe unifiée. */
function comparable(token: string): string {
  return token
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/’/gu, "'");
}

export function countedWords(text: string): string[] {
  const tokens = text.normalize('NFC').match(WORD_RE) ?? [];
  return tokens.filter((t) => letterCount(t) >= MIN_WORD_LETTERS);
}

export function assessCommentSubstance(text: string): CommentSubstance {
  const words = countedWords(text);
  const distinctWords = new Set(words.map(comparable)).size;
  const missingWords = Math.max(0, MIN_COMMENT_WORDS - words.length);

  let shortfall: CommentShortfall | null = null;
  if (words.length < MIN_COMMENT_WORDS) shortfall = 'too_few_words';
  else if (distinctWords < MIN_COMMENT_DISTINCT_WORDS) shortfall = 'too_repetitive';

  return {
    ok: shortfall === null,
    words: words.length,
    distinctWords,
    missingWords,
    shortfall,
  };
}

/**
 * Phrase montrée sous le champ et renvoyée par la route (400). Métier, jamais
 * technique : elle dit ce qui manque, pas le nom d'une règle.
 */
export function describeCommentShortfall(s: CommentSubstance): string | null {
  switch (s.shortfall) {
    case null:
      return null;
    case 'too_few_words':
      return s.missingWords === 1
        ? 'Encore un mot : expliquez ce qui motive votre décision.'
        : `Encore ${s.missingWords} mots : expliquez ce qui motive votre décision.`;
    case 'too_repetitive':
      return 'Le commentaire se répète : dites avec vos mots ce qui motive votre décision.';
    default: {
      const never: never = s.shortfall;
      throw new Error(`Manque non traité : ${String(never)}`);
    }
  }
}
