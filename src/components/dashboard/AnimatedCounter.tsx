'use client';

/**
 * Compteur animé pour les KPIs et mini-stats (Session 6).
 *
 * Anime de 0 (au mount) ou de la valeur précédente (à value change)
 * jusqu'à la valeur cible en `durationMs`, avec un easing ease-out
 * cubic. requestAnimationFrame uniquement — pas de framer-motion pour
 * cet effet seul.
 *
 * `suffix` optionnel pour les pourcentages et l'euro. `format` permet
 * de passer un formateur custom (utilisé pour le coût qui veut 2
 * décimales).
 *
 * ⚠️ `prefers-reduced-motion: reduce` COURT-CIRCUITE l'animation : la valeur
 * s'affiche d'emblée. Un chiffre qui défile pendant une seconde est du mouvement
 * gratuit — inconfortable pour qui y est sensible, et trompeur pour qui lit
 * vite : on relève « 1 » là où il y en a douze.
 */

import { useEffect, useRef, useState } from 'react';

export type AnimatedCounterProps = {
  value: number;
  suffix?: string;
  durationMs?: number;
  format?: (v: number) => string;
  className?: string;
  style?: React.CSSProperties;
};

const DEFAULT_DURATION = 1000;

export function AnimatedCounter({
  value,
  suffix = '',
  durationMs = DEFAULT_DURATION,
  format,
  className,
  style,
}: AnimatedCounterProps) {
  const [displayed, setDisplayed] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    // Mouvement réduit : on pose la valeur, sans une seule frame d'animation.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayed(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // Ease-out cubic — réplique l'effet de la maquette.
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * eased;
      setDisplayed(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  const rendered = format ? format(displayed) : String(Math.round(displayed));
  return (
    <span className={className} style={style}>
      {rendered}
      {suffix}
    </span>
  );
}
