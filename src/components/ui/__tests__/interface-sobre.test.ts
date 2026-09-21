import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * DEUX INTERDITS D'INTERFACE, et ils viennent d'une livraison rejetée.
 *
 * Entretiens et Pilotage avaient reçu de grandes tuiles à ICÔNES EMOJI, OMBRE
 * PORTÉE et bordure de sélection épaisse. Elles n'existaient sur aucun autre
 * écran : elles fabriquaient du vide et un relief que rien ne porte ailleurs.
 *
 * ⚠️ Ce test lit des fichiers — il ne dit rien de ce que l'écran RESSEMBLE. Il
 * dit ce qu'un clic ne voit pas : qu'aucun écran ne s'est remis à inventer son
 * relief. Le rendu, lui, se juge sur capture.
 *
 * Les exemptions sont NOMMÉES, jamais un dossier entier : une exemption large
 * finit par couvrir ce qu'elle devait surveiller.
 */

const RACINE = process.cwd();

/**
 * Surfaces surveillées — les DEUX écrans réalignés, et les briques partagées.
 *
 * ⚠️ Campagnes n'y est PAS, et c'est délibéré : ses icônes emoji (tuiles de
 * carte, boutons d'action) sont la charte du produit, celle qu'on est venu
 * COPIER. Les interdire ici reviendrait à condamner la référence au nom de
 * l'alignement sur elle. Ce qu'on surveille, c'est qu'on ne réinvente pas un
 * relief sur les écrans qu'on vient d'aligner.
 */
const DOSSIERS = [
  'src/components/interviews',
  'src/components/reporting',
  'src/components/ui',
];

/**
 * Exemptions — nommées une par une, avec leur raison.
 *
 * `CampaignIcon` vient de `CampaignCard`, dans Campagnes, que cette garde
 * exclut délibérément : son glyphe et son ombre SONT la charte du produit,
 * celle qu'on est venu copier. L'extraire pour la partager ne doit pas la
 * condamner d'un coup — ce serait punir la mutualisation.
 */
const EXEMPTS = new Set<string>(['src/components/ui/CampaignIcon.tsx']);

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

/** Commentaires retirés : ils CITENT les interdits pour les expliquer. */
const sansCommentaires = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Un PICTOGRAMME employé comme élément d'interface.
 *
 * ⚠️ Volontairement étroit. Une première version prenait aussi les flèches
 * (`→`, `←`) et la coche `✓` : ce sont des caractères TYPOGRAPHIQUES, qui
 * remplacent un mot dans une phrase, pas des icônes qui remplacent une image.
 * Les confondre faisait rougir « Suivant → » et « ⚠️ » dans un avertissement,
 * et une garde qui crie sur ce qu'elle ne devrait pas finit désarmée.
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2728}\u{2B50}\u{2B55}]/u;

describe('aucune icône emoji dans les composants de page', () => {
  it('les écrans n’en portent aucun', () => {
    const fautifs: string[] = [];
    for (const dossier of DOSSIERS) {
      for (const f of fichiers(dossier)) {
        if (EXEMPTS.has(f)) continue;
        const src = sansCommentaires(readFileSync(resolve(RACINE, f), 'utf-8'));
        for (const ligne of src.split('\n')) {
          if (EMOJI.test(ligne)) fautifs.push(`${f} — ${ligne.trim().slice(0, 70)}`);
        }
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });
});

/**
 * Une ombre portée sur une COUCHE FLOTTANTE (boîte de dialogue, liste
 * déroulante) dit « ceci passe au-dessus » : c'est le seul emploi où l'ombre
 * informe. Sur un élément DANS le flux — une tuile, une carte de liste — elle
 * ne dit rien, elle fabrique du relief. C'est cette seconde forme qui a été
 * rejetée, et c'est elle seule qu'on interdit.
 *
 * Reconnaissance : l'élément, ou le conteneur qui l'ouvre juste au-dessus,
 * se déclare `fixed`, `absolute` ou `z-`.
 */
const PORTEE = 6;
const flottant = (lignes: string[], n: number) =>
  lignes
    .slice(Math.max(0, n - PORTEE), n + 1)
    .some((l) => /\b(fixed|absolute)\b|\bz-\d/.test(l));

/**
 * LES DEUX COMPOSANTS PARTAGÉS, et pas un troisième.
 *
 * ⚠️ Règle du 21/09/2026 : un écran ne crée JAMAIS son composant de
 * navigation ni son compteur. Il prend l'un des deux existants — les puces à
 * point coloré (`DotTabs`) ou les cartes-compteurs soulignées
 * (`CounterRibbon`). Pilotage s'était fabriqué une barre segmentée, le Vivier
 * une barre soulignée, Entretiens une rangée d'onglets : trois façons de faire
 * la même chose, et plus aucun repère d'un écran à l'autre.
 */
const BASCULE = 'src/components/ui/DotTabs.tsx';

describe('une seule bascule de vue', () => {
  it('aucune page ne définit la sienne', () => {
    const fautifs: string[] = [];
    for (const dossier of ['src/components', 'src/app']) {
      for (const f of fichiers(dossier)) {
        if (f === BASCULE) continue;
        const src = sansCommentaires(readFileSync(resolve(RACINE, f), 'utf-8'));
        if (/role="tablist"/.test(src)) fautifs.push(`${f} — role="tablist"`);
        if (/aria-selected/.test(src)) fautifs.push(`${f} — aria-selected`);
        // La barre d'onglets soulignée, l'autre forme maison.
        if (/-mb-px border-b-2/.test(src)) fautifs.push(`${f} — onglets soulignés`);
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });
});

describe('une carte-compteur n’a que deux rangs', () => {
  it('un chiffre, une ligne de libellé — jamais une troisième', () => {
    const src = sansCommentaires(
      readFileSync(resolve(RACINE, 'src/components/ui/CounterRibbon.tsx'), 'utf-8'),
    );
    // Le type de l'item borne ce qu'une carte PEUT porter : si un champ de
    // texte supplémentaire y entre, la carte grandira.
    const bloc = src.slice(
      src.indexOf('export type CounterItem'),
      src.indexOf('export function CounterRibbon'),
    );
    const champs = [...bloc.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(
      champs.sort(),
      `champs de CounterItem : ${champs.join(', ')}`,
    ).toEqual([
      'alert',
      'alertLabel',
      'color',
      'count',
      'dotClass',
      'key',
      'label',
      'total',
    ]);
    // La précision vit DANS la deuxième ligne, poussée à droite — jamais en
    // sous-texte, qui ferait une carte plus haute que ses voisines.
    expect(src, 'sous-texte dans la carte').not.toMatch(/mt-1 block font-body/);
    expect(src, 'la deuxième ligne ne pousse pas la pastille à droite').toMatch(
      /mt-1\.5 flex items-center justify-between/,
    );
    // Et la pastille est la PARTAGÉE, pas une forme locale.
    expect(src, 'pastille locale').toContain('CountBadge');
  });
});

describe('aucun relief inventé', () => {
  it('pas d’ombre portée sur un élément du flux', () => {
    const fautifs: string[] = [];
    for (const dossier of DOSSIERS) {
      for (const f of fichiers(dossier)) {
        if (EXEMPTS.has(f)) continue;
        const lignes = sansCommentaires(readFileSync(resolve(RACINE, f), 'utf-8')).split('\n');
        lignes.forEach((ligne, n) => {
          const ombre = /\bshadow-(orqa|lg|xl|md)\b/.test(ligne) || /boxShadow:/.test(ligne);
          if (ombre && !flottant(lignes, n)) {
            fautifs.push(`${f}:${n + 1} — ${ligne.trim().slice(0, 70)}`);
          }
        });
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('aucune bordure de sélection au-delà de 2 px', () => {
    const fautifs: string[] = [];
    for (const dossier of DOSSIERS) {
      for (const f of fichiers(dossier)) {
        const src = sansCommentaires(readFileSync(resolve(RACINE, f), 'utf-8'));
        // `border-4`, `border-[3px]`, `border: '3px …'`
        if (/\bborder-(?:[3-9]|\[[3-9]\d*px\])\b/.test(src)) fautifs.push(`${f} — bordure épaisse`);
        if (/border:\s*['"`]\s*[3-9]px/.test(src)) fautifs.push(`${f} — bordure épaisse`);
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });
});
