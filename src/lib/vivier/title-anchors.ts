/**
 * Ancres de titre (présélection Vivier — Phase 1, Bloc 1 multi-ancres).
 *
 * Un candidat ne se résume pas à son titre déclaré (souvent bruité, ex.
 * « … en reconversion vers le DevOps »). On matche aussi sur ses 2 DERNIERS
 * POSTES, qui sont factuels et spécifiques. Chaque ancre = un intitulé (titre
 * déclaré OU intitulé d'un poste passé), splitté en blocs (`splitTitleIntoBlocks`)
 * et doté de variantes iso-rôle (ajoutées à l'indexation).
 *
 * Le candidat qualifie au Bloc 1 si UNE ancre matche ; on retient la PLUS
 * RÉCENTE qui matche (depth le plus faible) pour le score (décote d'ancienneté)
 * et l'explicabilité. Pur et déterministe (testé).
 *
 *   depth 0 = titre déclaré · 1 = dernier poste · 2 = poste précédent.
 */

import { splitTitleIntoBlocks } from '@/lib/vivier/title-splitting';

/** Profondeur de postes prise en compte (Phase 1 : 2 derniers postes). */
export const MAX_RECENT_POSITIONS = 2;

/** Squelette d'ancre (avant variantes) : produit par la décomposition pure. */
export type AnchorSkeleton = { text: string; depth: number; blocks: string[] };

/** Ancre stockée/évaluée : blocs + variantes fusionnés en `terms`. */
export type TitleAnchor = { text: string; depth: number; terms: string[] };

/** Résultat d'un match d'ancre au Bloc 1. */
export type AnchorMatch = { term: string; depth: number; anchorText: string };

const ANCHOR_LABELS = ['Titre déclaré', 'Dernier poste', 'Poste précédent'];

/** Libellé lisible d'une ancre (explicabilité). */
export function anchorLabel(depth: number): string {
  return ANCHOR_LABELS[depth] ?? `Poste #${depth}`;
}

/** Poids (décote d'ancienneté) d'une ancre : `weights[depth]`, repli sur le dernier. */
export function anchorWeight(depth: number, weights: number[]): number {
  if (weights.length === 0) return 1;
  return weights[Math.min(depth, weights.length - 1)] ?? 1;
}

function dedupKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Construit les squelettes d'ancres : titre déclaré (depth 0) + jusqu'à 2
 * derniers postes (depth 1, 2). Déduplique un poste identique à une ancre déjà
 * présente (poste courant == titre déclaré). Chaque ancre est splittée en blocs.
 * Le `depth` reflète le PALIER de récence, pas l'ordre de sortie (un titre
 * absent ne décale pas les postes vers depth 0).
 */
export function buildAnchorSkeletons(
  title: string | null,
  recentPositions: string[],
  separators?: readonly string[],
): AnchorSkeleton[] {
  const out: AnchorSkeleton[] = [];
  const seen = new Set<string>();
  const add = (text: string, depth: number) => {
    const t = text.trim();
    if (!t) return;
    const k = dedupKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text: t, depth, blocks: splitTitleIntoBlocks(t, separators) });
  };
  if (title) add(title, 0);
  recentPositions.slice(0, MAX_RECENT_POSITIONS).forEach((p, i) => add(p, i + 1));
  return out;
}

/**
 * Première ancre qui matche l'ensemble campagne, par RÉCENCE (depth croissant).
 * `normalize` injecté (= `normalizeTitleTerm` de la présélection) pour aligner
 * la normalisation casse/accents sans créer de dépendance circulaire. null si
 * aucune ancre ne matche.
 */
export function matchAnchors(
  anchors: TitleAnchor[],
  campaignSet: Set<string>,
  normalize: (s: string) => string,
): AnchorMatch | null {
  const byDepth = [...anchors].sort((a, b) => a.depth - b.depth);
  for (const anchor of byDepth) {
    for (const term of anchor.terms) {
      const t = term.trim();
      if (t && campaignSet.has(normalize(t))) {
        return { term: t, depth: anchor.depth, anchorText: anchor.text };
      }
    }
  }
  return null;
}
