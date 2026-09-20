import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MOTS_BANNIS_A_L_ECRAN,
  PHRASES,
} from '@/lib/lexique/phrases-ecran';

/**
 * Test NÉGATIF sur la langue du RENDU.
 *
 * Le lexique du lot 1 tenait les STATUTS ; celui-ci tient les ACTIONS et les
 * TITRES. Il porte sur les écrans DÉJÀ convertis — la liste ci-dessous est le
 * périmètre, et elle s'allonge à mesure que les lots convertissent les écrans.
 *
 * Pourquoi un périmètre plutôt que « tout le produit » : la mesure a été faite
 * — 203 fichiers portent au moins un de ces mots dans une chaîne. Les bannir
 * partout d'un coup serait un balayage aveugle sur des textes qu'aucun lot n'a
 * encore réécrits. Une règle qu'on ne peut pas appliquer se désactive toute
 * seule ; celle-ci mord sur ce qui est fait, et refuse toute régression.
 */

const PERIMETRE = [
  'src/components/today',
  'src/lib/today',
  'src/lib/lexique',
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      sources(full, out);
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Le rendu seul : un commentaire DOIT pouvoir nommer le mécanisme. */
const sansCommentaires = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Ne garde que ce qui peut ATTEINDRE un écran : chaînes de caractères et
 * texte JSX. Les identifiants en sont exclus — `zoneByValidation` et
 * `DecisionZone` nomment le modèle, et les renommer serait une migration de
 * données pour un problème d'affichage. C'est la même règle qu'au lexique des
 * statuts (lot 1) : on juge ce qui se lit, pas ce qui se compile.
 */
function texteRendu(code: string): string {
  const morceaux: string[] = [];
  const motif =
    /'([^'\\\n]{3,})'|"([^"\\\n]{3,})"|`([^`\\]{3,})`|>\s*([^<>{}\n]{3,})\s*</g;
  for (const m of code.matchAll(motif)) {
    const texte = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (texte) morceaux.push(texte);
  }
  return morceaux.join('\n');
}

const FICHIERS = PERIMETRE.flatMap((dir) =>
  sources(resolve(process.cwd(), dir)).map((f) => ({
    chemin: relative(process.cwd(), f),
    code: texteRendu(sansCommentaires(readFileSync(f, 'utf-8'))),
  })),
);

describe('les écrans convertis ne parlent pas la langue du code', () => {
  it('le périmètre analysé est réel (garde anti-test-creux)', () => {
    expect(FICHIERS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(MOTS_BANNIS_A_L_ECRAN)('« %s » n’est rendu nulle part', (mot) => {
    // Frontière de MOT : « file » ne doit pas accuser « fichier », ni
    // « zone » accuser « horizon ».
    const motif = new RegExp(`\\b${mot.replace(/ /g, '\\s+')}`, 'i');
    const coupables = FICHIERS.filter(
      (f) =>
        motif.test(f.code) &&
        // La liste elle-même DOIT contenir les mots qu'elle bannit.
        !f.chemin.endsWith('phrases-ecran.ts'),
    ).map((f) => f.chemin);
    expect(coupables, `« ${mot} » apparaît encore :\n  ${coupables.join('\n  ')}`)
      .toEqual([]);
  });

  it('la sonde : le test SAIT détecter un mot banni', () => {
    const motif = new RegExp('\\bseuil', 'i');
    expect(motif.test(sansCommentaires("const t = 'sous le seuil bas';"))).toBe(true);
    expect(motif.test(sansCommentaires('// sous le seuil bas'))).toBe(false);
    // Et il ne se déclenche pas sur un mot qui en CONTIENT un autre.
    expect(new RegExp('\\bfile', 'i').test('fichier.pdf')).toBe(false);
    // Ni sur un IDENTIFIANT : `texteRendu` ne garde que ce qui se lit.
    expect(texteRendu('const zoneByValidation = {};')).not.toContain('zone');
    expect(texteRendu("const t = 'hors zone';")).toContain('zone');
  });
});

describe('chaque titre est une phrase complète, du point de vue du recruteur', () => {
  const titres = [
    PHRASES.decision.titre(2),
    PHRASES.ecarter.titre(2),
    PHRASES.entretiens.titre(2),
    PHRASES.regler.titre(2),
  ];

  it('un titre porte un VERBE conjugué — « À décider » n’est pas une phrase', () => {
    for (const titre of titres) {
      expect(
        /(attendent|attend|propose|à conclure|à régler)/.test(titre),
        `« ${titre} » ne porte aucun verbe`,
      ).toBe(true);
    }
  });

  it('un titre commence par le CHIFFRE : on sait combien avant de lire', () => {
    for (const titre of titres) expect(titre).toMatch(/^\d/);
  });

  it('le rôle de l’outil est dit quand il intervient', () => {
    // « L'outil vous propose de… », « l'outil ne tranche pas » : le produit
    // dit ce qu'il fait au lieu de le laisser deviner.
    expect(PHRASES.ecarter.titre(2)).toContain('l’outil vous propose');
    expect(PHRASES.decision.sousTitre).toContain('L’outil ne tranche pas');
  });

  it('les états vides sont des phrases, pas des étiquettes', () => {
    for (const vide of [
      PHRASES.decision.vide,
      PHRASES.ecarter.vide,
      PHRASES.entretiens.vide,
      PHRASES.regler.vide,
    ]) {
      expect(vide.split(' ').length).toBeGreaterThanOrEqual(3);
    }
  });

  it('les deux questions d’entretien se posent dans l’ordre', () => {
    expect(PHRASES.entretiens.questionEuLieu).toBe('A-t-il eu lieu ?');
    expect(PHRASES.entretiens.questionRetenu).toBe(
      'Retenez-vous ce candidat ?',
    );
  });

  it('singulier et pluriel sont accordés', () => {
    expect(PHRASES.decision.titre(1)).toBe('1 candidature attend votre décision');
    expect(PHRASES.decision.titre(3)).toBe('3 candidatures attendent votre décision');
    expect(PHRASES.regler.titre(1)).toBe('1 point à régler');
  });
});
