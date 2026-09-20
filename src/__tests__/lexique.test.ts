import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CANDIDATE_STAGE_LABELS } from '@/lib/reporting/candidate-stage';

/**
 * LEXIQUE UNIQUE — test NÉGATIF sur ce qui est RENDU.
 *
 * Un même objet portait jusqu'à cinq noms selon l'écran (audit du 20/09/2026,
 * constat E). Le lexique arrêté est celui des étapes de candidature, plus
 * « Propositions de refus » pour la file sous le seuil bas.
 *
 * ⚠️ Ce test porte sur le RENDU, pas sur le code : les commentaires sont
 * retirés avant l'analyse. Un commentaire a le droit — et même le devoir — de
 * RACONTER le mot qu'on vient de retirer et pourquoi ; c'est l'afficher qui
 * est interdit. Les identifiants techniques (`refus_auto`, `shortlisted`,
 * `ShortlistEntry`, `goCount`) ne sont pas du vocabulaire d'écran : les
 * renommer ferait une migration de données pour un problème d'affichage.
 */

const ROOT = resolve(process.cwd(), 'src');

/** Termes BANNIS de tout ce qui s'affiche, et ce par quoi on les remplace. */
const BANNIS: { terme: string; remplacé_par: string }[] = [
  { terme: 'Validation suspendue', remplacé_par: '« À valider » (Candidatures)' },
  { terme: 'validation suspendue', remplacé_par: '« à valider »' },
  { terme: 'Refus auto', remplacé_par: '« Refusé (historique) » ou « Proposé au refus »' },
  { terme: 'refus auto', remplacé_par: '« proposé au refus »' },
  { terme: 'Taux GO', remplacé_par: '« Taux de retenus »' },
  { terme: 'GO définitif', remplacé_par: '« Retenu »' },
  { terme: 'Shortlistés', remplacé_par: '« Invité » ou « Passés par l’invitation »' },
  { terme: 'shortlistés', remplacé_par: '« passés par l’invitation »' },
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      sources(full, out);
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Retire commentaires de bloc et de ligne — seul le rendu nous intéresse. */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FICHIERS = sources(ROOT).map((f) => ({
  chemin: relative(process.cwd(), f),
  code: sansCommentaires(readFileSync(f, 'utf-8')),
}));

describe('lexique unique — aucun résidu à l’écran', () => {
  it('le corpus analysé est réel (garde anti-test-creux)', () => {
    expect(FICHIERS.length).toBeGreaterThan(300);
  });

  it.each(BANNIS)('« $terme » n’apparaît plus nulle part', ({ terme, remplacé_par }) => {
    const coupables = FICHIERS.filter((f) => f.code.includes(terme)).map(
      (f) => f.chemin,
    );
    expect(
      coupables,
      `« ${terme} » est encore affiché. Employer ${remplacé_par}.\n  ${coupables.join('\n  ')}`,
    ).toEqual([]);
  });

  it('la sonde : le test SAIT détecter un résidu', () => {
    // Sans ça, un jour où le balayage ne lirait plus rien, tout passerait vert.
    const faux = sansCommentaires("const x = 'Validation suspendue';");
    expect(faux).toContain('Validation suspendue');
    // Et il ignore bien le même mot en commentaire.
    expect(sansCommentaires('// Validation suspendue')).not.toContain(
      'Validation suspendue',
    );
  });
});

describe('les étapes portent les mots du lexique', () => {
  it('libellés exacts, dans l’ordre du pipeline puis des terminaux', () => {
    expect(CANDIDATE_STAGE_LABELS).toEqual({
      a_valider: 'À valider',
      invite: 'Invité',
      rdv_pris: 'RDV pris',
      entretien_fait: 'Entretien fait',
      retenu: 'Retenu',
      non_retenu: 'Non retenu',
      sans_suite: 'Sans suite',
      refus_auto: 'Refusé (historique)',
    });
  });
});
