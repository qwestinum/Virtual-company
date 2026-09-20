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
  // ⚠️ Les blocs `style={{…}}` sont retirés AVANT extraction : ils contiennent
  // des mots-clés CSS (`cursor: 'pointer'`, `textAlign: 'center'`) qui sont
  // du vocabulaire de mise en page, pas du texte lu. Sans ça, `pointer`
  // faisait échouer un composant qui n'affiche nulle part ce mot — un test qui
  // accuse à tort finit par être désactivé, et c'est pire que pas de test.
  const sansStyle = code.replace(/style=\{\{[\s\S]*?\}\}/g, '');
  const morceaux: string[] = [];
  const motif =
    /'([^'\\\n]{3,})'|"([^"\\\n]{3,})"|`([^`\\]{3,})`|>\s*([^<>{}\n]{3,})\s*</g;
  for (const m of sansStyle.matchAll(motif)) {
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
    // Ni sur un mot-clé CSS, qui n'est pas du texte.
    expect(texteRendu("<b style={{ cursor: 'pointer' }}>Voir</b>")).not.toContain(
      'pointer',
    );
    expect(texteRendu('<b>à pointer</b>')).toContain('à pointer');
  });
});

describe('chaque titre est une phrase complète, du point de vue du recruteur', () => {
  const sujets = [
    PHRASES.validation.titre(2),
    PHRASES.entretiens.titre(2),
    PHRASES.regler.titre(2),
  ];
  const verbes = [
    PHRASES.aLire.titre(2),
    PHRASES.aEcarter.titre(2),
    PHRASES.aConfirmer.titre(2),
    PHRASES.aDecider.titre(2),
  ];

  it('un titre de SUJET porte un verbe conjugué', () => {
    for (const titre of sujets) {
      expect(
        /(attendent|attend|à conclure|à régler)/.test(titre),
        `« ${titre} » ne porte aucun verbe`,
      ).toBe(true);
    }
  });

  it('un titre de SOUS-BLOC nomme le GESTE, pas l’état', () => {
    // C'est la raison d'être du sous-bloc : « Répondre » servait à confirmer
    // ET à décider, deux gestes sous un même mot.
    for (const titre of verbes) {
      expect(
        /(à lire et décider|propose de les écarter|à confirmer|à donner)/.test(titre),
        `« ${titre} » ne nomme aucun geste`,
      ).toBe(true);
    }
  });

  it('tous commencent par le CHIFFRE : on sait combien avant de lire', () => {
    for (const titre of [...sujets, ...verbes]) expect(titre).toMatch(/^\d/);
  });

  it('le rôle de l’outil est dit quand il intervient', () => {
    expect(PHRASES.aEcarter.titre(2)).toContain('l’outil vous propose');
    expect(PHRASES.aLire.sousTitre).toContain('L’outil ne tranche pas');
  });

  it('les deux réponses de confirmation sont EXPLICITES', () => {
    // « Répondre » ne disait pas ce qu'on allait répondre.
    expect(PHRASES.aConfirmer.oui).toBe('Oui, il a eu lieu');
    expect(PHRASES.aConfirmer.non).toBe('Non');
    expect(PHRASES.aDecider.action).toBe('Donner ma décision');
  });

  it('les états vides sont des phrases, pas des étiquettes', () => {
    for (const vide of [
      PHRASES.validation.vide,
      PHRASES.entretiens.vide,
      PHRASES.regler.vide,
    ]) {
      expect(vide.split(' ').length).toBeGreaterThanOrEqual(3);
    }
  });

  it('singulier et pluriel sont accordés', () => {
    expect(PHRASES.validation.titre(1)).toBe(
      '1 candidature attend votre validation',
    );
    expect(PHRASES.validation.titre(3)).toBe(
      '3 candidatures attendent votre validation',
    );
    expect(PHRASES.regler.titre(1)).toBe('1 point à régler');
  });

  it('la fenêtre de l’équipe est FIXE et dite', () => {
    // Plus de « depuis votre dernière visite » : une fenêtre qui change d'un
    // jour à l'autre rend deux chiffres incomparables sans qu'on sache pourquoi.
    expect(PHRASES.equipe.fenetre).toBe('cette semaine');
  });
});
