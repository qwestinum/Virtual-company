import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Le champ de saisie du produit — ce qu'aucun rendu ne dirait tout seul.
 *
 * ⚠️ Ce fichier ne prouve PAS qu'un champ se clique : vitest tourne en
 * environnement `node`. Le clic sur le libellé est dans S31 (`tests/e2e/`).
 * Ce qui est ici est ce qu'un clic ne voit pas : un ratio de contraste, et
 * l'ABSENCE d'un libellé orphelin — on ne peut pas cliquer ce qui n'existe
 * pas, donc aucun test de comportement n'attrapera un libellé détaché.
 */

const RACINE = process.cwd();
const CSS = readFileSync(resolve(RACINE, 'src/app/globals.css'), 'utf-8');

/**
 * ⚠️ LÈVE si le jeton disparaît, et c'est le point. Un `var()` qui ne
 * résout rien fait jeter la déclaration ENTIÈRE par le navigateur : le champ
 * perd sa bordure, sans une erreur ni un avertissement. Renommer ou retirer
 * `--dash-field-border` ramènerait le défaut d'origine en silence.
 */
function jeton(nom: string): string {
  const m = CSS.match(new RegExp(`--dash-${nom}:\\s*(#[0-9a-f]{3,8})`, 'i'));
  if (!m) throw new Error(`jeton --dash-${nom} introuvable`);
  return m[1]!.toLowerCase();
}

const luminance = (hex: string): number => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

const ratio = (a: string, b: string): number => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('la bordure d’un champ se VOIT', () => {
  /**
   * WCAG 1.4.11 : un élément non textuel qui porte de l'information demande
   * 3:1. Le contour d'une zone de saisie EST cette information — sans lui, le
   * libellé devient le seul repère, donc la chose qu'on clique.
   */
  it('tient 3:1 sur les trois fonds où un champ se pose', () => {
    const bordure = jeton('field-border');
    for (const fond of ['surface', 'bg', 'warm']) {
      expect(ratio(bordure, jeton(fond)), `champ sur --dash-${fond}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('les jetons de CARTE restent sous le seuil — c’est pour ça qu’un rôle à part existe', () => {
    // Si un jour ils passaient 3:1, ce test tomberait et on se demanderait
    // pourquoi deux rôles coexistent. La réponse est ici.
    expect(ratio(jeton('border'), jeton('surface'))).toBeLessThan(3);
    expect(ratio(jeton('border-strong'), jeton('surface'))).toBeLessThan(3);
  });

  it('le libellé d’un champ passe AA (4,5:1) — il n’est plus un gris décoratif', () => {
    expect(ratio(jeton('text'), jeton('surface'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(jeton('text'), jeton('bg'))).toBeGreaterThanOrEqual(4.5);
  });
});

/** Tous les .tsx d'un dossier, récursivement. */
function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(resolve(RACINE, dir))) {
    const chemin = join(dir, nom);
    if (statSync(resolve(RACINE, chemin)).isDirectory()) {
      if (nom === '__tests__') continue;
      out.push(...fichiers(chemin));
    } else if (nom.endsWith('.tsx')) {
      out.push(chemin);
    }
  }
  return out;
}

/**
 * Un `<label>` est-il RELIÉ ? Trois façons valables :
 *   ① `htmlFor` pointant un identifiant ;
 *   ② il enveloppe le contrôle (association implicite) ;
 *   ③ il enveloppe `{children}` — un composant de LIGNE qui délègue le
 *      contrôle à son appelant ; le champ se retrouve bien dans le libellé.
 *
 * Tout le reste est un mot posé au-dessus d'une zone, qui ne réagit pas au
 * clic — le défaut qu'on répare. La troisième forme est la plus permissive :
 * elle suppose qu'une ligne de formulaire reçoit un contrôle. C'est son
 * contrat ; un test ne peut pas le vérifier sans rendre la page, et le rendu
 * est justement ce qu'un environnement `node` ne fait pas.
 */
function labelsOrphelins(brut: string): string[] {
  // ⚠️ Les COMMENTAIRES d'abord : ce fichier-ci en contient un qui cite
  // « <label htmlFor> », et un scanner qui lit les commentaires se dénonce
  // lui-même. Un test qui échoue sur sa propre documentation n'apprend rien.
  const source = brut
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const orphelins: string[] = [];
  const re = /<label\b([^>]*)>([\s\S]*?)<\/label>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const attributs = m[1]!;
    const corps = m[2]!;
    const relie =
      /htmlFor[=\s]/.test(attributs) ||
      /<(input|select|textarea)\b/.test(corps) ||
      /\{\s*children\s*\}/.test(corps);
    if (!relie) orphelins.push(m[0]!.slice(0, 90).replace(/\s+/g, ' '));
  }
  return orphelins;
}

describe('aucun libellé orphelin dans les formulaires de campagne', () => {
  const SURVEILLÉS = [
    'src/components/campagnes',
    'src/components/ui',
  ];

  it('chaque <label> pointe un champ ou l’enveloppe', () => {
    const fautifs: string[] = [];
    for (const dossier of SURVEILLÉS) {
      for (const f of fichiers(dossier)) {
        for (const orphelin of labelsOrphelins(readFileSync(resolve(RACINE, f), 'utf-8'))) {
          fautifs.push(`${relative(RACINE, f)} — ${orphelin}`);
        }
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });
});
