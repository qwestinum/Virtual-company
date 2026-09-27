'use client';

/**
 * Hauteur d'un panneau collant = l'espace RÉELLEMENT visible sous son bord
 * haut, jusqu'au bas de la zone qui défile.
 *
 * ⚠️ Remplace une hauteur fixe `calc(100vh - 150px)`, qui ignorait où le
 * panneau commence. Mesuré le 22/09/2026 sur une fenêtre de 900 px : panneau à
 * 330 px du haut, 750 px de haut, donc 250 px sous le pied de page — et les
 * boutons « Retenu / Non retenu », tout en bas, INVISIBLES même le contenu
 * défilé jusqu'au bout. Le panneau collant change de position quand la liste
 * défile : la hauteur se recalcule donc au défilement, pas seulement au
 * montage.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';

/** Plancher : en deçà, le panneau ne montrerait plus rien d'utile. */
const HAUTEUR_MIN = 240;

function zoneQuiDefile(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
    p = p.parentElement;
  }
  return null;
}

export function useVisibleHeight(
  ref: RefObject<HTMLElement | null>,
  actif: boolean,
  /** Marge laissée sous le panneau. */
  marge = 16,
): number | null {
  const [hauteur, setHauteur] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!actif || !el) return;
    const zone = zoneQuiDefile(el);
    const maj = () => {
      const bas = zone ? zone.getBoundingClientRect().bottom : window.innerHeight;
      const haut = el.getBoundingClientRect().top;
      setHauteur(Math.max(HAUTEUR_MIN, Math.floor(bas - haut - marge)));
    };
    maj();
    const cible: HTMLElement | Window = zone ?? window;
    cible.addEventListener('scroll', maj, { passive: true });
    window.addEventListener('resize', maj);
    return () => {
      cible.removeEventListener('scroll', maj);
      window.removeEventListener('resize', maj);
    };
  }, [ref, actif, marge]);

  return actif ? hauteur : null;
}
