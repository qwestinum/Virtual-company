/**
 * Réécriture d'un rapport d'analyse GROUPÉ — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §6.2.
 *
 * Un dépôt de plusieurs CV dans le chat produit UN rapport contenant TOUS les
 * candidats du lot (`rapport-cv-<campagne>-<horodatage>.md`), et son nom de
 * fichier ne dit pas lesquels. Le supprimer effacerait les données de personnes
 * qui n'ont rien demandé — et les priverait de l'analyse qui justifie la
 * décision les concernant.
 *
 * On retire donc la SECTION du candidat. Format produit par
 * `src/lib/agents/cv-report-render.ts` : un en-tête de lot, puis une section
 * par candidat introduite par un titre de niveau 2 :
 *
 *     ## Jean Dupont — 72/100 — Retenu
 *     Fichier : `cv-dupont.pdf`
 *     Email : jean@… · Téléphone : …
 *     ### Évaluation par critère        ← niveau 3 : reste DANS la section
 *
 * D'où le découpage sur `^## ` et jamais sur `^#+ `.
 */

import { isContaminated, redactString, type SubjectFingerprint } from '@/lib/gdpr/payload-pseudonymize';

export type ReportRewrite = {
  content: string;
  /** Nombre de sections candidat retirées. */
  removed: number;
  /** Nombre de sections candidat restantes (d'AUTRES personnes). */
  remaining: number;
};

const SECTION_START = /^## /u;

/**
 * Retire les sections du candidat et caviarde ce qui subsiste ailleurs
 * (en-tête de lot, ligne de synthèse). `remaining === 0` ⇒ l'appelant supprime
 * le fichier au lieu de le réécrire : un rapport sans plus aucun candidat n'a
 * pas d'objet.
 */
export function stripCandidateSections(
  markdown: string,
  fp: SubjectFingerprint,
  marker: string,
): ReportRewrite {
  const lines = markdown.split('\n');

  // Découpage : en-tête (avant le premier `## `) puis une entrée par section.
  const head: string[] = [];
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (SECTION_START.test(line)) {
      current = [line];
      sections.push(current);
      continue;
    }
    if (current) current.push(line);
    else head.push(line);
  }

  const kept: string[][] = [];
  let removed = 0;
  for (const section of sections) {
    if (isContaminated(section.join('\n'), fp)) removed += 1;
    else kept.push(section);
  }

  // L'en-tête peut nommer le candidat (récapitulatif de lot) : on le caviarde
  // plutôt que de le jeter — il porte les compteurs du lot, qui restent vrais.
  const headOut = head.map((l) => redactString(l, fp, marker));

  const content = [...headOut, ...kept.flat()].join('\n').replace(/\n{4,}/gu, '\n\n\n');
  return { content, removed, remaining: kept.length };
}

/**
 * Un texte quelconque (brouillon de message, trame d'entretien) contient-il
 * encore le candidat ? Sert au tri des fichiers du stockage : un `.md` dont le
 * nom ne dit rien se juge sur son CONTENU, jamais sur son intitulé.
 */
export function textMentionsSubject(text: string, fp: SubjectFingerprint): boolean {
  return isContaminated(text, fp);
}
