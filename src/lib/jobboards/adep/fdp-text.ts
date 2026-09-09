/**
 * Missions et compétences de la fiche de poste → texte proposé à l'Apec. PUR.
 *
 * ── CE QUE C'EST, ET CE QUE CE N'EST PAS ────────────────────────────────────
 *
 * Ce n'est PAS une rédaction. Le module ne fabrique aucune phrase : il REPORTE
 * des listes déjà validées dans une mise en forme lisible, et cela se voit à
 * l'écran (une liste reste une liste). Écrire « Vous rejoindrez une équipe
 * dynamique… » à partir de trois missions serait inventer du contenu que
 * personne n'a relu — c'est le travail du Job Writer, sur demande explicite.
 *
 * ── POURQUOI ÇA EXISTE ──────────────────────────────────────────────────────
 *
 * L'Apec EXIGE une description du profil (100 caractères minimum, API_408) et
 * ORQA la présentait vide, alors que les compétences clés sont validées dans la
 * fiche de poste, à deux écrans de là. Faire retaper ce qui est déjà saisi est
 * la définition même de la redondance — et deux textes saisis séparément pour
 * un même poste finissent par se contredire.
 *
 * ⚠️ Le texte proposé est souvent PLUS COURT que le minimum de l'Apec : trois
 * missions font rarement 200 caractères. C'est assumé — le compteur du
 * formulaire dit ce qui manque, et partir d'une base vaut mieux qu'une page
 * blanche. On ne rallonge pas artificiellement pour passer un seuil.
 */

/** Une liste de la FDP, lue défensivement. Vide ⇒ `[]`, jamais une exception. */
function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

/**
 * « Titre :\n- item\n- item ». Le tiret plutôt qu'une puce Markdown : l'Apec
 * rend du texte brut, et un `-` se lit correctement partout — c'est déjà ce que
 * verra le candidat, sans surprise à la publication.
 */
function bulletList(title: string, items: string[]): string | null {
  if (items.length === 0) return null;
  return `${title} :\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** Descriptif du poste proposé depuis les missions. `null` si la FDP est vide. */
export function composeMissionsText(value: unknown): string | null {
  return bulletList('Missions principales', asList(value));
}

/** Description du profil proposée depuis les compétences clés. */
export function composeSkillsText(value: unknown): string | null {
  return bulletList('Compétences recherchées', asList(value));
}
