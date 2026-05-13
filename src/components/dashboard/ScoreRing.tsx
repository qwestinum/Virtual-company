'use client';

/**
 * Anneau de score SVG animé (Session 6).
 *
 * Cercle de progression avec stroke-dashoffset interpolé par CSS pour
 * un effet de remplissage doux à l'apparition. La couleur dépend du
 * score (≥75 vert, ≥50 orange, sinon rouge) — règle commune à toute la
 * surface dashboard, dérivée des seuils de scoring.
 */

import { useEffect, useRef, useState } from 'react';

import { colorForScore } from './tokens';

export type ScoreRingProps = {
  score: number;
  size?: number;
};

export function ScoreRing({ score, size = 42 }: ScoreRingProps) {
  const safeScore = Math.max(0, Math.min(100, score));
  const r = (size - 7) / 2; // épaisseur de 3.5 de chaque côté
  const circumference = 2 * Math.PI * r;
  const targetOffset = circumference - (safeScore / 100) * circumference;
  const color = colorForScore(safeScore);

  // On démarre à offset = circumference (cercle vide) et on interpole
  // vers `targetOffset` une fois monté pour déclencher la transition CSS.
  const [offset, setOffset] = useState(circumference);
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      const raf = requestAnimationFrame(() => setOffset(targetOffset));
      return () => cancelAnimationFrame(raf);
    }
    setOffset(targetOffset);
  }, [targetOffset]);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        style={{ transform: 'rotate(-90deg)' }}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--dash-border)"
          strokeWidth={3.5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color.solid}
          strokeWidth={3.5}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
          fontSize: 11,
          fontWeight: 700,
          color: color.solid,
        }}
        aria-label={`Score ${safeScore}`}
      >
        {Math.round(safeScore)}
      </div>
    </div>
  );
}
