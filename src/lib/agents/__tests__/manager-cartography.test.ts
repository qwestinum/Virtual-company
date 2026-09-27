import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MANAGER_CARTOGRAPHY } from '../manager-cartography';
import { MOTS_BANNIS_A_L_ECRAN } from '@/lib/lexique/phrases-ecran';

/**
 * LE MANAGER NE PEUT PLUS NOMMER UN ÉCRAN QUI N'EXISTE PAS.
 *
 * La cartographie est la SEULE autorité de navigation du Manager : il en tire
 * ses orientations et, s'il n'y trouve rien, il avoue son incertitude plutôt
 * que d'inventer un menu. Elle est donc du texte, et rien dans le code ne la
 * rattachait à l'interface — un onglet renommé ou disparu la laissait affirmer
 * l'ancien nom, en toute confiance, pendant des mois.
 *
 * Deux gardes, et elles disent deux choses différentes :
 *
 *  1. **La PROSE parle la langue du lexique.** Les mots du modèle interne
 *     (« seuil », « zone », « dossier », « arbitrer »…) décrivent fidèlement le
 *     code et ne décrivent rien de ce que la personne cherche à faire.
 *  2. **Chaque libellé cité EXISTE VERBATIM dans l'UI.** C'est la garde
 *     anti-hallucination : elle ne dit pas que le chemin est bon, elle dit que
 *     le mot sur lequel on envoie cliquer se trouve quelque part à l'écran.
 *
 * ⚠️ Un mot banni reste licite DANS un libellé cité. « Seuils de décision » est
 * le nom de la section à l'écran : l'interdire empêcherait le Manager de
 * désigner l'endroit où aller, ce qui est exactement son travail.
 */

const RACINE = process.cwd();

/** Le texte hors des libellés cités — ce que le Manager RÉDIGE. */
const PROSE = MANAGER_CARTOGRAPHY.replace(/«[^»]*»/g, ' ');

/** Les libellés cités, normalisés (apostrophes et espaces varient). */
const norm = (s: string) => s.replace(/['’]/g, "'").replace(/\s+/g, ' ').toLowerCase();

const LIBELLES = [
  ...new Set(
    [...MANAGER_CARTOGRAPHY.matchAll(/«\s*([^»]+?)\s*»/g)].map((m) =>
      m[1]!.replace(/\s+/g, ' '),
    ),
  ),
];

function sources(dir: string, out: string[] = []): string[] {
  for (const nom of readdirSync(resolve(RACINE, dir))) {
    const chemin = join(dir, nom);
    if (statSync(resolve(RACINE, chemin)).isDirectory()) {
      if (nom === '__tests__') continue;
      sources(chemin, out);
    } else if (/\.tsx?$/.test(nom) && !chemin.includes('manager-cartography')) {
      out.push(chemin);
    }
  }
  return out;
}

/** Le code de l'UI, en un seul texte : on cherche une CHAÎNE, pas un symbole. */
const CORPUS = norm(
  ['src/components', 'src/app', 'src/lib', 'src/types']
    .flatMap((d) => sources(d))
    .map((f) => readFileSync(resolve(RACINE, f), 'utf-8'))
    .join('\n'),
);

describe('cartographie du Manager', () => {
  it('sa prose ne porte aucun mot banni du lexique', () => {
    const fautifs: string[] = [];
    for (const mot of MOTS_BANNIS_A_L_ECRAN) {
      // Frontière de mot : « file » ne doit pas accuser « fichier ».
      const re = new RegExp(`\\b${mot}`, 'gi');
      for (const m of PROSE.matchAll(re)) {
        const i = m.index ?? 0;
        fautifs.push(
          `« ${mot} » — …${PROSE.slice(Math.max(0, i - 50), i + 50).replace(/\s+/g, ' ')}…`,
        );
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('chaque libellé cité existe VERBATIM dans l’interface', () => {
    expect(LIBELLES.length, 'aucun libellé cité — la garde ne garde rien').toBeGreaterThan(
      50,
    );
    const absents = LIBELLES.filter((l) => !CORPUS.includes(norm(l)));
    expect(
      absents,
      `Libellés introuvables dans le code de l'UI :\n${absents
        .map((a) => `  • « ${a} »`)
        .join('\n')}\n` +
        'Soit l’écran a changé de nom et la cartographie ment, soit le libellé ' +
        'est composé dynamiquement — dans ce cas, cite la partie fixe.',
    ).toEqual([]);
  });

  it('elle nomme les cinq entrées, et aucune entrée disparue', () => {
    // ⚠️ Comparaison NORMALISÉE : l'apostrophe typographique et l'apostrophe
    // droite se ressemblent à l'œil et ne sont pas le même caractère. Une
    // première version accusait « Aujourd'hui » d'être absente alors qu'elle
    // était là — une garde qui se trompe de caractère finit désactivée.
    const carte = norm(MANAGER_CARTOGRAPHY);
    for (const entree of [
      'Aujourd’hui',
      'Campagnes',
      'Candidatures',
      'Entretiens',
      'Pilotage',
    ]) {
      expect(carte, `entrée « ${entree} » absente`).toContain(norm(entree));
    }
    // Les anciens noms n'ont le droit d'apparaître que pour DIRE qu'ils ont
    // changé de porte — jamais comme destination. On vérifie donc qu'ils
    // vivent dans le paragraphe « Ce qui a changé de porte » et nulle part
    // ailleurs.
    const repere = MANAGER_CARTOGRAPHY.indexOf('Ce qui a changé de porte');
    const finRepere = MANAGER_CARTOGRAPHY.indexOf('\n\n', repere);
    const ailleurs = norm(
      MANAGER_CARTOGRAPHY.slice(0, repere) + MANAGER_CARTOGRAPHY.slice(finRepere),
    );
    for (const disparu of ['Reporting', 'Bureau', 'Validations vivier']) {
      expect(ailleurs, `« ${disparu} » cité hors du paragraphe des portes`).not.toContain(
        norm(disparu),
      );
    }
  });
});
