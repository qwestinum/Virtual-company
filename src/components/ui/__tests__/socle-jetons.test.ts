import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BORDURE, COULEUR, ESPACE, ETAPE, TAILLE, TYPO } from '../tokens';

/**
 * LE SOCLE EST LE SEUL ENDROIT OÙ UNE VALEUR S'ÉCRIT.
 *
 * L'audit du 20/09/2026 a mesuré, sur un seul écran, 22 à 25 niveaux
 * typographiques (cible : 3), 27 tailles arbitraires et 52 valeurs de padding
 * en ligne. Le socle (`tokens.ts`) ne dessine rien : il NOMME ce que les
 * écrans sains employaient déjà. Cette garde empêche le prochain écran d'en
 * réinventer un.
 *
 * ⚠️ CE QU'ELLE INTERDIT, et pourquoi c'est CELA et pas « toute valeur en
 * ligne ». Un `style={{ color: 'var(--dash-text)' }}` EST un jeton : le
 * bannir obligerait à passer par une classe Tailwind pour des variables CSS
 * qui n'en ont pas, et ferait inventer une couche de plus. Ce qui crée une
 * palette parallèle, c'est une VALEUR BRUTE — un `#hex`, un `rgb(…)`, une
 * famille de police déclarée à la main. C'est cela qu'on refuse.
 *
 * Deux exceptions, nommées : `#fff` (le blanc d'un texte sur bouton plein) et
 * `rgba(` (les ombres des couches flottantes, qui n'ont pas de jeton).
 */

const RACINE = process.cwd();

/** Les écrans. Pas `src/components/ui` : c'est là que les jetons s'appliquent. */
const ECRANS = [
  'src/components/today',
  'src/components/campagnes',
  'src/components/candidatures',
  'src/components/interviews',
  'src/components/reporting',
];

function fichiers(dir: string, out: string[] = []): string[] {
  for (const nom of readdirSync(resolve(RACINE, dir))) {
    const chemin = join(dir, nom);
    if (statSync(resolve(RACINE, chemin)).isDirectory()) {
      if (nom !== '__tests__') fichiers(chemin, out);
    } else if (/\.tsx?$/.test(nom)) out.push(chemin);
  }
  return out;
}

const SOURCES = ECRANS.flatMap((d) => fichiers(d)).map((f) => ({
  chemin: relative(RACINE, f),
  code: readFileSync(resolve(RACINE, f), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, ''),
}));

describe('le socle de jetons', () => {
  it('expose trois niveaux typographiques, et trois seulement', () => {
    expect(Object.keys(TYPO).sort()).toEqual(['corps', 'donnee', 'titre']);
    // Le quatrième n'en est pas un : la chasse fixe ne sert QUE les chiffres
    // et les identifiants.
    expect(TYPO.donnee).toBe('font-data');
  });

  it('son échelle d’espacement est en multiples de 4', () => {
    for (const [nom, valeur] of Object.entries(ESPACE)) {
      expect(valeur % 4, `ESPACE.${nom} = ${valeur}`).toBe(0);
    }
  });

  it('ses couleurs sont des variables CSS, jamais des valeurs', () => {
    for (const jeu of [COULEUR, BORDURE, ETAPE]) {
      for (const [nom, valeur] of Object.entries(jeu)) {
        expect(valeur, nom).toMatch(/^var\(--/);
      }
    }
  });

  it('ses tailles couvrent les trois niveaux sans en inventer un quatrième', () => {
    // Deux tailles de titre (page et carte), deux de corps, une de mention,
    // plus le grand chiffre d'un compteur. Au-delà, un niveau ne se distingue
    // plus de son voisin.
    expect(Object.keys(TAILLE).length).toBeLessThanOrEqual(6);
    expect(TAILLE.titrePage).toBeGreaterThan(TAILLE.titreCarte);
    expect(TAILLE.corps).toBeGreaterThan(TAILLE.petit);
    expect(TAILLE.petit).toBeGreaterThan(TAILLE.minuscule);
  });
});

describe('aucun écran n’invente sa propre palette', () => {
  it('le périmètre analysé est réel', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it('aucune couleur écrite en dur', () => {
    const fautifs: string[] = [];
    for (const f of SOURCES) {
      const durs = [
        ...f.code.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
        ...f.code.matchAll(/\brgba?\(/g),
      ].map((m) => m[0]);
      const inattendus = durs.filter(
        (d) => d !== '#fff' && d !== '#ffffff' && d !== 'rgba(',
      );
      for (const d of inattendus) fautifs.push(`${f.chemin} — ${d}`);
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('aucune famille de police déclarée à la main', () => {
    const fautifs: string[] = [];
    for (const f of SOURCES) {
      if (/fontFamily/.test(f.code)) fautifs.push(`${f.chemin} — fontFamily`);
      // Les deux familles de l'ancienne peau de Candidatures : retirées le
      // 21/09/2026, et rien ne doit les ramener.
      if (/font-fraunces|font-inter/.test(f.code)) {
        fautifs.push(`${f.chemin} — police retirée`);
      }
      if (/\bserif\b/.test(f.code)) fautifs.push(`${f.chemin} — serif`);
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('la palette retirée ne revient pas', () => {
    const fautifs = SOURCES.filter((f) => /\borqa-(?!field)/.test(f.code)).map(
      (f) => f.chemin,
    );
    expect(
      fautifs,
      `Palette \`orqa-*\` (marine, bleu-gris, brume) réintroduite dans :\n${fautifs.join('\n')}`,
    ).toEqual([]);
  });
});
